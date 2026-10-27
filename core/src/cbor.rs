//! Strict CBOR helpers: integer-keyed maps, canonical encoding enforced by re-encoding on decode.

use ciborium::Value;

use crate::error::{CoreError, Result};

pub const MAX_INPUT: usize = 1 << 20;

pub fn encode(v: &Value) -> Vec<u8> {
    let mut out = Vec::new();
    ciborium::into_writer(v, &mut out).expect("writing CBOR to a Vec cannot fail");
    out
}

pub fn decode(bytes: &[u8]) -> Result<Value> {
    if bytes.len() > MAX_INPUT {
        return Err(CoreError::Malformed);
    }
    ciborium::from_reader(bytes).map_err(|_| CoreError::Malformed)
}

/// Builds `{k: v, ...}` from (key, value) pairs; keys must be given in ascending order.
pub fn map(entries: Vec<(u64, Value)>) -> Value {
    Value::Map(
        entries
            .into_iter()
            .map(|(k, v)| (Value::Integer(k.into()), v))
            .collect(),
    )
}

pub fn bytes(b: &[u8]) -> Value {
    Value::Bytes(b.to_vec())
}

pub fn uint(n: u64) -> Value {
    Value::Integer(n.into())
}

/// Reads an integer-keyed map with exactly the expected keys, in ascending order.
pub struct Fields(Vec<(u64, Value)>);

impl Fields {
    pub fn parse(v: Value, expected_keys: &[u64]) -> Result<Self> {
        let Value::Map(entries) = v else {
            return Err(CoreError::Malformed);
        };
        let mut out = Vec::with_capacity(entries.len());
        for (k, v) in entries {
            let Value::Integer(i) = k else {
                return Err(CoreError::Malformed);
            };
            out.push((u64::try_from(i).map_err(|_| CoreError::Malformed)?, v));
        }
        if out.iter().map(|(k, _)| *k).ne(expected_keys.iter().copied()) {
            return Err(CoreError::Malformed);
        }
        Ok(Fields(out))
    }

    pub fn take(&mut self, key: u64) -> Result<Value> {
        let pos = self.0.iter().position(|(k, _)| *k == key).ok_or(CoreError::Malformed)?;
        Ok(std::mem::replace(&mut self.0[pos].1, Value::Null))
    }

    pub fn text(&mut self, key: u64, max_bytes: usize) -> Result<String> {
        match self.take(key)? {
            Value::Text(s) if s.len() <= max_bytes => Ok(s),
            _ => Err(CoreError::Malformed),
        }
    }

    pub fn uint(&mut self, key: u64) -> Result<u64> {
        match self.take(key)? {
            Value::Integer(i) => u64::try_from(i).map_err(|_| CoreError::Malformed),
            _ => Err(CoreError::Malformed),
        }
    }

    pub fn fixed<const N: usize>(&mut self, key: u64) -> Result<[u8; N]> {
        match self.take(key)? {
            Value::Bytes(b) => b.as_slice().try_into().map_err(|_| CoreError::Malformed),
            _ => Err(CoreError::Malformed),
        }
    }

    pub fn array(&mut self, key: u64, max_len: usize) -> Result<Vec<Value>> {
        match self.take(key)? {
            Value::Array(a) if a.len() <= max_len => Ok(a),
            _ => Err(CoreError::Malformed),
        }
    }
}
