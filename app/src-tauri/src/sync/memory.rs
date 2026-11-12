//! In-memory transport for deterministic multi-device tests. It can drop, duplicate and reorder
//! deliveries and hide blobs, to exercise the engine's idempotence and hold/retry paths.
use super::engine::{Transport, TransportError};
use super::model::Batch;
use std::cell::RefCell;
use std::collections::BTreeMap;
use std::rc::Rc;

#[derive(Default)]
pub struct Remote {
    pub batches: Vec<Batch>,
    pub blobs: BTreeMap<String, Vec<u8>>,
    /// Blobs uploaded but not yet "visible" (eventual consistency).
    pub hidden: Vec<String>,
    pub offline: bool,
    pub reverse: bool,
}

#[derive(Clone)]
pub struct MemoryTransport {
    pub remote: Rc<RefCell<Remote>>,
}

impl MemoryTransport {
    pub fn new(remote: &Rc<RefCell<Remote>>) -> Self {
        MemoryTransport { remote: remote.clone() }
    }

    fn check(&self) -> Result<(), TransportError> {
        if self.remote.borrow().offline {
            Err(TransportError::Offline("test network down".into()))
        } else {
            Ok(())
        }
    }
}

impl Transport for MemoryTransport {
    fn id(&self) -> &'static str {
        "drive"
    }
    fn has_blob(&mut self, _p: &str, sha: &str) -> Result<bool, TransportError> {
        self.check()?;
        Ok(self.remote.borrow().blobs.contains_key(sha))
    }
    fn put_blob(&mut self, _p: &str, sha: &str, bytes: &[u8]) -> Result<(), TransportError> {
        self.check()?;
        self.remote.borrow_mut().blobs.insert(sha.into(), bytes.to_vec());
        Ok(())
    }
    fn get_blob(&mut self, _p: &str, sha: &str) -> Result<Option<Vec<u8>>, TransportError> {
        self.check()?;
        let r = self.remote.borrow();
        if r.hidden.iter().any(|h| h == sha) {
            return Ok(None);
        }
        Ok(r.blobs.get(sha).cloned())
    }
    fn put_batch(&mut self, batch: &Batch) -> Result<(), TransportError> {
        self.check()?;
        // Duplicate uploads (a retry after a lost reply) are kept, like duplicate Drive files.
        self.remote.borrow_mut().batches.push(batch.clone());
        Ok(())
    }
    fn pull(&mut self, project_id: &str, seen: &dyn Fn(&str, u64) -> bool) -> Result<Vec<Batch>, TransportError> {
        self.check()?;
        let r = self.remote.borrow();
        let mut out: Vec<Batch> = r
            .batches
            .iter()
            .filter(|b| b.project_id == project_id && !seen(&b.device_id, b.seq))
            .cloned()
            .collect();
        if r.reverse {
            out.reverse();
        }
        Ok(out)
    }
}
