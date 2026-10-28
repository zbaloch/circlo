//! Chunked streaming media encryption: STREAM (BE32) over XChaCha20-Poly1305 (CRYPTO.md section 11).
//!
//! Layout: `version || nonce_prefix:19 || chunk_0 || ... || chunk_last`, 64 KiB plaintext chunks.
//! Memory use is one chunk regardless of file size.

use std::io::{Read, Write};

use chacha20poly1305::aead::generic_array::GenericArray;
use chacha20poly1305::aead::stream::{NewStream, StreamBE32, StreamPrimitive};
use chacha20poly1305::aead::{KeyInit, Payload};
use chacha20poly1305::XChaCha20Poly1305;
use zeroize::Zeroizing;

use crate::error::{invalid, CoreError, Result};
use crate::padding::padme;
use crate::primitives::{aad, random, VERSION};

pub const CHUNK: usize = 65_536;
pub const TAG: usize = 16;
pub const CT_CHUNK: usize = CHUNK + TAG;
pub const PREFIX_LEN: usize = 19;
pub const HEADER_LEN: usize = 1 + PREFIX_LEN;
const LABEL: &str = "circlo/v1/media-chunk";

/// Chunk geometry for a given real content length (identical for encryptor and decryptor).
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub struct Layout {
    pub padded_len: u64,
    pub chunks: u64,
}

impl Layout {
    pub fn for_content_len(content_len: u64) -> Result<Self> {
        let padded_len = padme(content_len);
        let chunks = padded_len.div_ceil(CHUNK as u64).max(1);
        if chunks > u64::from(u32::MAX) {
            return Err(invalid("file too large"));
        }
        Ok(Layout { padded_len, chunks })
    }

    pub fn plain_chunk_len(&self, index: u64) -> usize {
        (self.padded_len - index * CHUNK as u64).min(CHUNK as u64) as usize
    }

    /// Byte offset of chunk `index` in the encrypted object (for HTTP range requests).
    pub fn chunk_offset(index: u64) -> u64 {
        HEADER_LEN as u64 + index * CT_CHUNK as u64
    }

    pub fn encrypted_len(&self) -> u64 {
        HEADER_LEN as u64 + self.padded_len + self.chunks * TAG as u64
    }
}

/// Decrypts individual chunks; built from the 20-byte object header.
pub struct ChunkCipher {
    stream: StreamBE32<XChaCha20Poly1305>,
    aad: Vec<u8>,
}

impl ChunkCipher {
    pub(crate) fn new(file_key: &[u8; 32], object_id: &[u8; 16], prefix: &[u8; PREFIX_LEN]) -> Self {
        let cipher = XChaCha20Poly1305::new(file_key.into());
        ChunkCipher {
            stream: StreamBE32::from_aead(cipher, GenericArray::from_slice(prefix)),
            aad: aad(LABEL, &[object_id]),
        }
    }

    pub fn from_header(file_key: &[u8; 32], object_id: &[u8; 16], header: &[u8]) -> Result<Self> {
        if header.len() != HEADER_LEN {
            return Err(CoreError::Malformed);
        }
        if header[0] != VERSION {
            return Err(CoreError::UnsupportedVersion);
        }
        Ok(Self::new(
            file_key,
            object_id,
            header[1..].try_into().expect("19 bytes"),
        ))
    }

    pub(crate) fn encrypt(&self, index: u64, last: bool, plain: &[u8]) -> Vec<u8> {
        self.stream
            .encrypt(
                index as u32,
                last,
                Payload {
                    msg: plain,
                    aad: &self.aad,
                },
            )
            .expect("chunk encryption cannot fail for valid sizes")
    }

    pub fn decrypt_chunk(&self, index: u64, last: bool, ciphertext: &[u8]) -> Result<Vec<u8>> {
        let index = u32::try_from(index).map_err(|_| CoreError::DecryptionFailed)?;
        if ciphertext.len() < TAG || ciphertext.len() > CT_CHUNK {
            return Err(CoreError::DecryptionFailed);
        }
        self.stream
            .decrypt(
                index,
                last,
                Payload {
                    msg: ciphertext,
                    aad: &self.aad,
                },
            )
            .map_err(|_| CoreError::DecryptionFailed)
    }
}

/// Encrypts exactly `content_len` bytes from `input`, padded with Padmé. Returns bytes written.
pub fn encrypt<R: Read, W: Write>(
    input: &mut R,
    output: &mut W,
    file_key: &[u8; 32],
    object_id: &[u8; 16],
    content_len: u64,
) -> Result<u64> {
    let layout = Layout::for_content_len(content_len)?;
    let prefix: [u8; PREFIX_LEN] = random();
    let cipher = ChunkCipher::new(file_key, object_id, &prefix);
    output.write_all(&[VERSION])?;
    output.write_all(&prefix)?;

    let mut buf = Zeroizing::new(vec![0u8; CHUNK]);
    let mut remaining_content = content_len;
    for i in 0..layout.chunks {
        let len = layout.plain_chunk_len(i);
        let from_content = (remaining_content.min(len as u64)) as usize;
        read_exact_or_short(input, &mut buf[..from_content])?;
        buf[from_content..len].fill(0);
        remaining_content -= from_content as u64;
        output.write_all(&cipher.encrypt(i, i + 1 == layout.chunks, &buf[..len]))?;
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra)? != 0 {
        return Err(invalid("input is longer than content_len"));
    }
    output.flush()?;
    Ok(layout.encrypted_len())
}

/// Decrypts a whole object, writing exactly `content_len` bytes. Fails on any tamper/truncation/extension.
pub fn decrypt<R: Read, W: Write>(
    input: &mut R,
    output: &mut W,
    file_key: &[u8; 32],
    object_id: &[u8; 16],
    content_len: u64,
) -> Result<()> {
    let layout = Layout::for_content_len(content_len)?;
    let mut header = [0u8; HEADER_LEN];
    read_exact_or_fail(input, &mut header)?;
    let cipher = ChunkCipher::from_header(file_key, object_id, &header)?;

    let mut buf = vec![0u8; CT_CHUNK];
    let mut remaining_content = content_len;
    for i in 0..layout.chunks {
        let ct_len = layout.plain_chunk_len(i) + TAG;
        read_exact_or_fail(input, &mut buf[..ct_len])?;
        let plain = Zeroizing::new(cipher.decrypt_chunk(i, i + 1 == layout.chunks, &buf[..ct_len])?);
        let take = remaining_content.min(plain.len() as u64) as usize;
        if plain[take..].iter().any(|&b| b != 0) {
            return Err(CoreError::Malformed);
        }
        output.write_all(&plain[..take])?;
        remaining_content -= take as u64;
    }
    let mut extra = [0u8; 1];
    if input.read(&mut extra)? != 0 {
        return Err(CoreError::DecryptionFailed);
    }
    output.flush()?;
    Ok(())
}

fn read_exact_or_short<R: Read>(r: &mut R, buf: &mut [u8]) -> Result<()> {
    r.read_exact(buf).map_err(|e| match e.kind() {
        std::io::ErrorKind::UnexpectedEof => invalid("input is shorter than content_len"),
        _ => e.into(),
    })
}

fn read_exact_or_fail<R: Read>(r: &mut R, buf: &mut [u8]) -> Result<()> {
    r.read_exact(buf).map_err(|e| match e.kind() {
        std::io::ErrorKind::UnexpectedEof => CoreError::DecryptionFailed,
        _ => e.into(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const KEY: [u8; 32] = [3; 32];
    const OBJ: [u8; 16] = [4; 16];

    fn enc(data: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        let n = encrypt(&mut &data[..], &mut out, &KEY, &OBJ, data.len() as u64).unwrap();
        assert_eq!(n as usize, out.len());
        out
    }

    fn dec(ct: &[u8], len: u64) -> Result<Vec<u8>> {
        let mut out = Vec::new();
        decrypt(&mut &ct[..], &mut out, &KEY, &OBJ, len).map(|_| out)
    }

    #[test]
    fn round_trips_across_chunk_boundaries() {
        for len in [0usize, 1, 100, CHUNK - 1, CHUNK, CHUNK + 1, 3 * CHUNK + 17, 1_000_000] {
            let data: Vec<u8> = (0..len).map(|i| (i * 31 % 251) as u8).collect();
            let ct = enc(&data);
            assert_eq!(
                ct.len() as u64,
                Layout::for_content_len(len as u64).unwrap().encrypted_len()
            );
            assert_eq!(dec(&ct, len as u64).unwrap(), data, "len {len}");
        }
    }

    #[test]
    fn size_is_padded() {
        let ct = enc(&vec![1u8; 1_000_000]);
        assert_eq!(
            ct.len() as u64,
            Layout::for_content_len(1_000_000).unwrap().encrypted_len()
        );
        assert!(Layout::for_content_len(1_000_000).unwrap().padded_len > 1_000_000);
    }

    #[test]
    fn truncation_extension_reorder_and_tamper_fail() {
        let data = vec![7u8; 3 * CHUNK];
        let ct = enc(&data);
        let len = data.len() as u64;
        // Drop the final chunk: the previous chunk lacks the last flag.
        let layout = Layout::for_content_len(len).unwrap();
        let last_off = Layout::chunk_offset(layout.chunks - 1) as usize;
        assert!(dec(&ct[..last_off], len).is_err());
        // Extra trailing bytes.
        let mut ext = ct.clone();
        ext.push(0);
        assert!(dec(&ext, len).is_err());
        // Swap chunks 0 and 1.
        let mut swapped = ct.clone();
        let (a, b) = (Layout::chunk_offset(0) as usize, Layout::chunk_offset(1) as usize);
        let c0 = ct[a..b].to_vec();
        swapped[a..b].copy_from_slice(&ct[b..b + CT_CHUNK]);
        swapped[b..b + CT_CHUNK].copy_from_slice(&c0);
        assert!(dec(&swapped, len).is_err());
        // Wrong object id (AAD) or key.
        assert!(decrypt(&mut &ct[..], &mut Vec::new(), &KEY, &[5; 16], len).is_err());
        assert!(decrypt(&mut &ct[..], &mut Vec::new(), &[9; 32], &OBJ, len).is_err());
        // Wrong declared length.
        assert!(dec(&ct, len - 1).is_err() || dec(&ct, len - 1).unwrap() != data);
        // Bit flips in header, first chunk, last chunk.
        for pos in [0, 5, 25, last_off + 3, ct.len() - 1] {
            let mut t = ct.clone();
            t[pos] ^= 1;
            assert!(dec(&t, len).is_err(), "pos {pos}");
        }
    }

    #[test]
    fn random_access_chunk_decrypt() {
        let data: Vec<u8> = (0..(5 * CHUNK + 100)).map(|i| (i % 256) as u8).collect();
        let ct = enc(&data);
        let layout = Layout::for_content_len(data.len() as u64).unwrap();
        let cipher = ChunkCipher::from_header(&KEY, &OBJ, &ct[..HEADER_LEN]).unwrap();
        let i = 3;
        let off = Layout::chunk_offset(i) as usize;
        let plain = cipher.decrypt_chunk(i, false, &ct[off..off + CT_CHUNK]).unwrap();
        assert_eq!(plain, data[i as usize * CHUNK..(i as usize + 1) * CHUNK]);
        // Claiming the wrong index or last flag fails.
        assert!(cipher.decrypt_chunk(2, false, &ct[off..off + CT_CHUNK]).is_err());
        assert!(cipher.decrypt_chunk(i, true, &ct[off..off + CT_CHUNK]).is_err());
        assert!(layout.chunks > 5);
    }

    #[test]
    fn rejects_input_length_mismatch() {
        let data = [1u8; 100];
        assert!(encrypt(&mut &data[..], &mut Vec::new(), &KEY, &OBJ, 101).is_err());
        assert!(encrypt(&mut &data[..], &mut Vec::new(), &KEY, &OBJ, 99).is_err());
    }
}
