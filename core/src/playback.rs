//! Progressive playback of encrypted video (PLAN.md Phase 7: "video plays progressively while chunks decrypt").
//!
//! Platform players can't read the chunked format, so the core runs a loopback-only HTTP server that decrypts the
//! chunk ranges the player asks for. The app downloads ciphertext pieces and hands them to [`Session::supply`]; the
//! core writes them to a local ciphertext file and tells the downloader which piece the player needs next
//! ([`Session::next_range`]), so seeking and MP4s with the index at the end still start quickly.
//!
//! Security: the listener binds 127.0.0.1 only; every session URL carries a fresh 256-bit token; plaintext exists only
//! in memory, one chunk at a time, and in the player's buffers. Ciphertext on disk is never decrypted to a file.

use std::collections::HashMap;
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Read, Seek, SeekFrom, Write};
use std::net::{Ipv4Addr, TcpListener, TcpStream};
use std::path::PathBuf;
use std::sync::{Arc, Condvar, Mutex};
use std::time::{Duration, Instant};

use zeroize::Zeroizing;

use crate::error::{invalid, CoreError, Result};
use crate::primitives::random;
use crate::stream::{ChunkCipher, Layout, CHUNK, HEADER_LEN, TAG};

/// Download granularity: 1 MiB of the encrypted object.
pub const PIECE: u64 = 1 << 20;
const WAIT: Duration = Duration::from_secs(60);
const MAX_HEAD: usize = 16 * 1024;

struct State {
    have: Vec<bool>,
    /// Encrypted-object offset the player most recently needed (download priority).
    want: u64,
    cipher: Option<Arc<ChunkCipher>>,
    closed: bool,
}

/// One video being played: its ciphertext file, key and download state.
pub struct Session {
    path: PathBuf,
    file_key: Zeroizing<[u8; 32]>,
    object_id: [u8; 16],
    layout: Layout,
    content_len: u64,
    total: u64,
    mime: String,
    state: Mutex<State>,
    cv: Condvar,
}

impl Session {
    pub fn new(path: PathBuf, file_key: [u8; 32], object_id: [u8; 16], content_len: u64, mime: &str) -> Result<Self> {
        if mime.is_empty()
            || mime.len() > 100
            || !mime.bytes().all(|b| b.is_ascii_alphanumeric() || b"/.+-".contains(&b))
        {
            return Err(invalid("bad mime type"));
        }
        let layout = Layout::for_content_len(content_len)?;
        let total = layout.encrypted_len();
        let file = OpenOptions::new().create(true).write(true).truncate(true).open(&path)?;
        file.set_len(total)?;
        Ok(Session {
            path,
            file_key: Zeroizing::new(file_key),
            object_id,
            layout,
            content_len,
            total,
            mime: mime.to_owned(),
            state: Mutex::new(State {
                have: vec![false; total.div_ceil(PIECE) as usize],
                want: 0,
                cipher: None,
                closed: false,
            }),
            cv: Condvar::new(),
        })
    }

    pub fn encrypted_len(&self) -> u64 {
        self.total
    }

    fn piece_range(&self, index: u64) -> (u64, u64) {
        (index * PIECE, ((index + 1) * PIECE).min(self.total))
    }

    /// The next encrypted byte range to download (end exclusive), nearest to what the player needs; `None` when done.
    pub fn next_range(&self) -> Option<(u64, u64)> {
        let st = self.state.lock().unwrap();
        let from = (st.want / PIECE) as usize;
        let idx = (from..st.have.len()).chain(0..from).find(|&i| !st.have[i])?;
        Some(self.piece_range(idx as u64))
    }

    /// Stores one downloaded piece. `offset` and length must be exactly one piece from [`Self::next_range`].
    pub fn supply(&self, offset: u64, bytes: &[u8]) -> Result<()> {
        if offset % PIECE != 0 || offset >= self.total {
            return Err(invalid("offset is not a piece boundary"));
        }
        let index = offset / PIECE;
        let (start, end) = self.piece_range(index);
        if bytes.len() as u64 != end - start {
            return Err(invalid("wrong piece length"));
        }
        let cipher = if index == 0 {
            Some(Arc::new(ChunkCipher::from_header(
                &self.file_key,
                &self.object_id,
                &bytes[..HEADER_LEN],
            )?))
        } else {
            None
        };
        let mut file = OpenOptions::new().write(true).open(&self.path)?;
        file.seek(SeekFrom::Start(offset))?;
        file.write_all(bytes)?;
        let mut st = self.state.lock().unwrap();
        st.have[index as usize] = true;
        if cipher.is_some() {
            st.cipher = cipher;
        }
        self.cv.notify_all();
        Ok(())
    }

    pub fn is_complete(&self) -> bool {
        self.state.lock().unwrap().have.iter().all(|&h| h)
    }

    pub fn close(&self) {
        self.state.lock().unwrap().closed = true;
        self.cv.notify_all();
    }

    /// Waits until encrypted bytes `[start, end)` and the header are present; returns the chunk cipher.
    fn wait_for(&self, start: u64, end: u64) -> Result<Arc<ChunkCipher>> {
        let deadline = Instant::now() + WAIT;
        let mut st = self.state.lock().unwrap();
        st.want = start;
        loop {
            if st.closed {
                return Err(invalid("session closed"));
            }
            let ready = (start / PIECE..end.div_ceil(PIECE)).all(|i| st.have[i as usize]);
            if let (true, Some(c)) = (ready, &st.cipher) {
                return Ok(c.clone());
            }
            let now = Instant::now();
            if now >= deadline {
                return Err(CoreError::Io {
                    reason: "timed out waiting for download".into(),
                });
            }
            st = self.cv.wait_timeout(st, deadline - now).unwrap().0;
        }
    }

    /// Decrypted content of chunk `index`, without padding.
    pub fn chunk(&self, index: u64) -> Result<Zeroizing<Vec<u8>>> {
        if index >= self.layout.chunks {
            return Err(CoreError::DecryptionFailed);
        }
        let ct_len = self.layout.plain_chunk_len(index) + TAG;
        let offset = Layout::chunk_offset(index);
        let cipher = self.wait_for(offset, offset + ct_len as u64)?;
        let mut ct = vec![0u8; ct_len];
        let mut file = File::open(&self.path)?;
        file.seek(SeekFrom::Start(offset))?;
        file.read_exact(&mut ct)?;
        let mut plain = Zeroizing::new(cipher.decrypt_chunk(index, index + 1 == self.layout.chunks, &ct)?);
        let content_end = self
            .content_len
            .saturating_sub(index * CHUNK as u64)
            .min(plain.len() as u64);
        plain.truncate(content_end as usize);
        Ok(plain)
    }
}

/// The process-wide loopback server; started on first use, lives until the process exits.
pub struct Server {
    port: u16,
    sessions: Mutex<HashMap<String, Arc<Session>>>,
}

static SERVER: Mutex<Option<Arc<Server>>> = Mutex::new(None);

impl Server {
    pub fn shared() -> Result<Arc<Server>> {
        let mut guard = SERVER.lock().unwrap();
        if let Some(s) = guard.as_ref() {
            return Ok(s.clone());
        }
        let listener = TcpListener::bind((Ipv4Addr::LOCALHOST, 0))?;
        let server = Arc::new(Server {
            port: listener.local_addr()?.port(),
            sessions: Mutex::new(HashMap::new()),
        });
        let s = server.clone();
        std::thread::Builder::new()
            .name("circlo-playback".into())
            .spawn(move || {
                for conn in listener.incoming().flatten() {
                    let s = s.clone();
                    let _ = std::thread::Builder::new()
                        .name("circlo-playback-conn".into())
                        .spawn(move || {
                            let _ = s.handle(conn);
                        });
                }
            })?;
        *guard = Some(server.clone());
        Ok(server)
    }

    /// Registers a session and returns its URL (`http://127.0.0.1:<port>/<token>`).
    pub fn register(&self, session: Arc<Session>) -> (String, String) {
        let token: String = random::<32>().iter().map(|b| format!("{b:02x}")).collect();
        self.sessions.lock().unwrap().insert(token.clone(), session);
        (format!("http://127.0.0.1:{}/{token}", self.port), token)
    }

    pub fn unregister(&self, token: &str) {
        if let Some(s) = self.sessions.lock().unwrap().remove(token) {
            s.close();
        }
    }

    fn handle(&self, stream: TcpStream) -> std::io::Result<()> {
        stream.set_read_timeout(Some(Duration::from_secs(30)))?;
        let mut reader = BufReader::new(stream.try_clone()?);
        let mut out = stream;
        let mut head = Vec::new();
        let (mut method, mut path, mut range) = (String::new(), String::new(), None);
        loop {
            let mut line = String::new();
            if reader.read_line(&mut line)? == 0 {
                return Ok(());
            }
            head.extend_from_slice(line.as_bytes());
            if head.len() > MAX_HEAD {
                return respond(&mut out, "431 Request Header Fields Too Large", &[]);
            }
            let line = line.trim_end();
            if line.is_empty() {
                break;
            }
            if method.is_empty() {
                let mut parts = line.split(' ');
                method = parts.next().unwrap_or_default().to_owned();
                path = parts.next().unwrap_or_default().to_owned();
            } else if let Some((k, v)) = line.split_once(':') {
                if k.eq_ignore_ascii_case("range") {
                    range = Some(v.trim().to_owned());
                }
            }
        }
        if method != "GET" && method != "HEAD" {
            return respond(&mut out, "405 Method Not Allowed", &[]);
        }
        let token = path.strip_prefix('/').unwrap_or_default();
        let Some(session) = self.sessions.lock().unwrap().get(token).cloned() else {
            return respond(&mut out, "404 Not Found", &[]);
        };
        let len = session.content_len;
        let (start, end, partial) = match range.as_deref().map(|r| parse_range(r, len)) {
            None => (0, len, false),
            Some(Some((s, e))) => (s, e, true),
            Some(None) => {
                return respond(
                    &mut out,
                    "416 Range Not Satisfiable",
                    &[("Content-Range", format!("bytes */{len}"))],
                )
            }
        };
        let mut headers = vec![
            ("Content-Type", session.mime.clone()),
            ("Content-Length", (end - start).to_string()),
            ("Accept-Ranges", "bytes".to_owned()),
            ("Cache-Control", "no-store".to_owned()),
        ];
        if partial {
            headers.push(("Content-Range", format!("bytes {start}-{}/{len}", end - 1)));
        }
        respond(
            &mut out,
            if partial { "206 Partial Content" } else { "200 OK" },
            &headers,
        )?;
        if method == "HEAD" || start == end {
            return Ok(());
        }
        let chunk = CHUNK as u64;
        for index in start / chunk..end.div_ceil(chunk) {
            let plain = session
                .chunk(index)
                .map_err(|_| std::io::Error::other("chunk unavailable"))?;
            let base = index * chunk;
            let from = start.saturating_sub(base) as usize;
            let to = ((end - base) as usize).min(plain.len());
            out.write_all(&plain[from..to])?;
        }
        out.flush()
    }
}

fn respond(out: &mut TcpStream, status: &str, headers: &[(&str, String)]) -> std::io::Result<()> {
    let mut head = format!("HTTP/1.1 {status}\r\nConnection: close\r\n");
    for (k, v) in headers {
        head.push_str(&format!("{k}: {v}\r\n"));
    }
    if !headers.iter().any(|(k, _)| *k == "Content-Length") {
        head.push_str("Content-Length: 0\r\n");
    }
    head.push_str("\r\n");
    out.write_all(head.as_bytes())
}

/// Parses a single `bytes=` range against `len`; returns `[start, end)` or `None` if unsatisfiable.
pub(crate) fn parse_range(header: &str, len: u64) -> Option<(u64, u64)> {
    let spec = header.strip_prefix("bytes=")?;
    if spec.contains(',') {
        return None;
    }
    let (a, b) = spec.split_once('-')?;
    let (start, end) = match (a.trim(), b.trim()) {
        ("", suffix) => {
            let n: u64 = suffix.parse().ok()?;
            (len.saturating_sub(n), len)
        }
        (s, "") => (s.parse().ok()?, len),
        (s, e) => (s.parse().ok()?, e.parse::<u64>().ok()?.saturating_add(1).min(len)),
    };
    (start < end && start < len).then_some((start, end))
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::stream;
    use std::io::Cursor;

    const KEY: [u8; 32] = [9; 32];
    const OID: [u8; 16] = [4; 16];

    fn encrypted(content: &[u8]) -> Vec<u8> {
        let mut out = Vec::new();
        stream::encrypt(&mut Cursor::new(content), &mut out, &KEY, &OID, content.len() as u64).unwrap();
        out
    }

    fn get(url: &str, range: Option<&str>) -> (String, Vec<u8>) {
        let rest = url.strip_prefix("http://").unwrap();
        let (host, path) = rest.split_once('/').unwrap();
        let mut s = TcpStream::connect(host).unwrap();
        let mut req = format!("GET /{path} HTTP/1.1\r\nHost: {host}\r\n");
        if let Some(r) = range {
            req.push_str(&format!("Range: {r}\r\n"));
        }
        req.push_str("\r\n");
        s.write_all(req.as_bytes()).unwrap();
        let mut resp = Vec::new();
        s.read_to_end(&mut resp).unwrap();
        let split = resp.windows(4).position(|w| w == b"\r\n\r\n").unwrap();
        (
            String::from_utf8(resp[..split].to_vec()).unwrap(),
            resp[split + 4..].to_vec(),
        )
    }

    #[test]
    fn ranges() {
        assert_eq!(parse_range("bytes=0-99", 1000), Some((0, 100)));
        assert_eq!(parse_range("bytes=900-", 1000), Some((900, 1000)));
        assert_eq!(parse_range("bytes=-100", 1000), Some((900, 1000)));
        assert_eq!(parse_range("bytes=990-5000", 1000), Some((990, 1000)));
        assert_eq!(parse_range("bytes=1000-", 1000), None);
        assert_eq!(parse_range("bytes=0-1,5-6", 1000), None);
        assert_eq!(parse_range("items=0-1", 1000), None);
    }

    #[test]
    fn serves_decrypted_ranges_while_downloading_out_of_order() {
        let content: Vec<u8> = (0..3_500_000u32).map(|i| (i * 7 % 251) as u8).collect();
        let ct = encrypted(&content);
        let dir = tempfile::tempdir().unwrap();
        let session =
            Arc::new(Session::new(dir.path().join("v.enc"), KEY, OID, content.len() as u64, "video/mp4").unwrap());
        assert_eq!(session.encrypted_len(), ct.len() as u64);
        let server = Server::shared().unwrap();
        let (url, token) = server.register(session.clone());
        assert!(url.starts_with("http://127.0.0.1:"));

        // A downloader that follows next_range, slowly, as the app does.
        let dl = {
            let (session, ct) = (session.clone(), ct.clone());
            std::thread::spawn(move || {
                while let Some((s, e)) = session.next_range() {
                    std::thread::sleep(Duration::from_millis(20));
                    session.supply(s, &ct[s as usize..e as usize]).unwrap();
                }
            })
        };

        // Player asks for the end first (MP4 index at the end), then the start, then the whole file.
        let (h, body) = get(&url, Some("bytes=-1000"));
        assert!(h.starts_with("HTTP/1.1 206"), "{h}");
        assert!(h.contains(&format!(
            "Content-Range: bytes {}-{}/{}",
            content.len() - 1000,
            content.len() - 1,
            content.len()
        )));
        assert_eq!(body, &content[content.len() - 1000..]);
        let (_, body) = get(&url, Some("bytes=65530-200000"));
        assert_eq!(body, &content[65530..200001]);
        let (h, body) = get(&url, None);
        assert!(h.starts_with("HTTP/1.1 200"));
        assert_eq!(body, content);
        dl.join().unwrap();
        assert!(session.is_complete());

        // Wrong token and unsatisfiable ranges.
        let bad = format!("{}{}", &url[..url.len() - 64], "0".repeat(64));
        assert!(get(&bad, None).0.starts_with("HTTP/1.1 404"));
        assert!(get(&url, Some("bytes=99999999-")).0.starts_with("HTTP/1.1 416"));
        server.unregister(&token);
        assert!(get(&url, None).0.starts_with("HTTP/1.1 404"));
    }

    #[test]
    fn rejects_bad_pieces_and_tampered_ciphertext() {
        let content = vec![1u8; 200_000];
        let mut ct = encrypted(&content);
        let dir = tempfile::tempdir().unwrap();
        let session = Session::new(dir.path().join("v.enc"), KEY, OID, content.len() as u64, "video/mp4").unwrap();
        assert!(session.supply(1, &ct[1..]).is_err());
        assert!(session.supply(0, &ct[..100]).is_err());
        assert!(Session::new(dir.path().join("x"), KEY, OID, 10, "video/mp4\r\nX: y").is_err());
        ct[HEADER_LEN + 5] ^= 1;
        session.supply(0, &ct).unwrap();
        assert_eq!(session.chunk(0).unwrap_err(), CoreError::DecryptionFailed);
        assert_eq!(session.chunk(1).unwrap().len(), CHUNK);
    }
}
