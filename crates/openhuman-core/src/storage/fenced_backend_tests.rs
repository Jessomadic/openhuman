//! Node A loses a profile's lease to node B; A's writes through its fenced
//! view of the shared backend are refused while B's succeed.

use super::*;
use crate::storage::fence::{fence_error, FenceError, LeaseFence, ScopeMatch};
use crate::storage::lease::{DocumentLeases, LeaseGrant, LeaseStore, LocalLeases};
use crate::storage::MemoryStorage;
use serde_json::json;
use std::sync::atomic::{AtomicU64, Ordering};
use std::time::Duration;

const TTL: Duration = Duration::from_secs(30);
const MARGIN_MS: u64 = 5_000;

/// One node: its clock, its lease store and fence registry, and its fenced
/// view of the shared backend.
struct Node {
    name: &'static str,
    clock: Arc<AtomicU64>,
    leases: Arc<dyn LeaseStore>,
    fences: Arc<FenceRegistry>,
    storage: FencedBackend,
}

impl Node {
    fn new(name: &'static str, shared: &Arc<dyn StorageBackend>) -> Self {
        let clock = Arc::new(AtomicU64::new(0));
        let reading = Arc::clone(&clock);
        let fences = Arc::new(FenceRegistry::new(move || reading.load(Ordering::SeqCst)));
        Self {
            name,
            leases: Arc::new(DocumentLeases::cluster(shared.as_ref(), name, None, TTL).unwrap()),
            storage: FencedBackend::new(Arc::clone(shared), Arc::clone(&fences)),
            fences,
            clock,
        }
    }

    fn set_clock(&self, ms: u64) {
        self.clock.store(ms, Ordering::SeqCst);
    }

    async fn take(&self, key: &str) -> LeaseGrant {
        let grant = self
            .leases
            .acquire(key, self.clock.load(Ordering::SeqCst))
            .await
            .unwrap();
        self.fences.register(Arc::new(LeaseFence::new(
            Arc::clone(&self.leases),
            key,
            self.name,
            grant.epoch,
            grant.expires_at_ms,
            MARGIN_MS,
            vec![
                ScopeMatch::Exact(format!("profile:{key}")),
                ScopeMatch::Prefix(format!("{key}~")),
            ],
        )));
        grant
    }

    fn scoped(&self, scope: &str) -> ScopedStorage {
        self.storage.for_scope(&Scope::new(scope).unwrap()).unwrap()
    }

    async fn put(&self, scope: &str, id: &str) -> Result<Version> {
        self.scoped(scope)
            .documents()
            .put("notes", id, json!({"by": self.name}), Precondition::None)
            .await
    }
}

fn shared() -> Arc<dyn StorageBackend> {
    Arc::new(MemoryStorage::new())
}

#[tokio::test]
async fn a_node_that_lost_the_lease_cannot_write_and_the_new_holder_can() {
    let backend = shared();
    let (a, b) = (Node::new("node-a", &backend), Node::new("node-b", &backend));

    a.take("alice").await;
    a.put("profile:alice", "n1").await.unwrap();
    a.put("alice~default", "n1").await.unwrap();

    // Node B's clock passes A's expiry and takes the profile over. Node A's
    // clock is still early (it was paused, or runs behind): its local check
    // passes, so the stored record is what stops it.
    b.set_clock(TTL.as_millis() as u64 + 1);
    let stolen = b.take("alice").await;
    assert!(stolen.previous_unclean);
    a.set_clock(1_000);

    let refused = a.put("profile:alice", "n2").await.unwrap_err();
    assert!(matches!(
        fence_error(&refused),
        Some(FenceError::Superseded {
            held: 1,
            stored: Some(2)
        })
    ));
    // Every write port, and every session scope of the profile, is fenced.
    let session = a.scoped("alice~default");
    assert!(session.streams().append("log", json!(1)).await.is_err());
    assert!(session.blobs().put("k", b"x".to_vec(), None).await.is_err());
    assert!(session
        .documents()
        .delete("notes", "n1", Precondition::None)
        .await
        .is_err());
    // Reads are not.
    assert!(session
        .documents()
        .get("notes", "n1")
        .await
        .unwrap()
        .is_some());
    // Other profiles' scopes are untouched.
    a.put("profile:bob", "n1").await.unwrap();

    // The new holder writes, and its write is the one that stands.
    b.put("profile:alice", "n2").await.unwrap();
    let stored = backend
        .for_scope(&Scope::new("profile:alice").unwrap())
        .unwrap()
        .documents()
        .get("notes", "n2")
        .await
        .unwrap()
        .unwrap();
    assert_eq!(stored.doc["by"], "node-b");
}

#[tokio::test]
async fn a_paused_node_refuses_its_own_writes_once_its_grant_runs_out() {
    let backend = shared();
    let a = Node::new("node-a", &backend);
    a.take("alice").await;

    // Nobody took over yet, but node A's renewals stopped landing: inside
    // the skew margin it already refuses, with no I/O.
    a.set_clock(TTL.as_millis() as u64 - MARGIN_MS);
    let refused = a.put("profile:alice", "n").await.unwrap_err();
    assert_eq!(
        fence_error(&refused),
        Some(&FenceError::Expired { epoch: 1 })
    );
}

#[tokio::test]
async fn a_renewed_grant_keeps_admitting_writes() {
    let backend = shared();
    let a = Node::new("node-a", &backend);
    let grant = a.take("alice").await;
    a.set_clock(20_000);
    let renewed = a.leases.renew(&grant, 20_000).await.unwrap();
    a.fences
        .lookup("profile:alice")
        .unwrap()
        .renewed(renewed.expires_at_ms);
    a.set_clock(40_000);
    a.put("profile:alice", "n").await.unwrap();
}

#[tokio::test]
async fn named_databases_are_fenced_too() {
    let backend = shared();
    let (a, b) = (Node::new("node-a", &backend), Node::new("node-b", &backend));
    a.take("alice").await;
    b.set_clock(TTL.as_millis() as u64 + 1);
    b.take("alice").await;
    let sessions = a.storage.database("sessions").unwrap();
    let scoped = sessions
        .for_scope(&Scope::new("alice~default").unwrap())
        .unwrap();
    assert!(scoped
        .documents()
        .put("t", "x", json!({}), Precondition::None)
        .await
        .is_err());
}

/// File leases (`LocalLeases`, hosts without a backend) cannot be lost while
/// the process lives, so a fence over one admits writes until the holder
/// releases it.
#[tokio::test]
async fn a_fence_over_file_leases_admits_until_release() {
    let tmp = tempfile::tempdir().unwrap();
    let leases: Arc<dyn LeaseStore> = Arc::new(LocalLeases::new(tmp.path(), "node-a"));
    let grant = leases.acquire("alice", 0).await.unwrap();
    assert_eq!(grant.expires_at_ms, u64::MAX, "file leases never expire");
    let fence = LeaseFence::new(
        Arc::clone(&leases),
        "alice",
        "node-a",
        grant.epoch,
        grant.expires_at_ms,
        MARGIN_MS,
        vec![ScopeMatch::Exact("profile:alice".into())],
    );
    assert_eq!(fence.check(u64::MAX / 2).await, Ok(()));
    leases.release(grant).await.unwrap();
    assert!(matches!(
        fence.check(1).await,
        Err(FenceError::Superseded { .. })
    ));
}
