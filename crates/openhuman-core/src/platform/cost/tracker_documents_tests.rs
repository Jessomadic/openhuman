use super::*;
use crate::storage::{MemoryStorage, Scope, StorageBackend};
use chrono::{Duration, Utc};

use super::super::types::TokenUsage;

fn docs_in(storage: &MemoryStorage, scope: &str) -> CostDocs {
    CostDocs::over(&storage.for_scope(&Scope::new(scope).unwrap()).unwrap())
}

fn record(model: &str, cost: f64, secs_ago: i64) -> CostRecord {
    let mut usage = TokenUsage::new(model, 10, 5, 1.0, 2.0);
    usage.cost_usd = cost;
    usage.timestamp = Utc::now() - Duration::seconds(secs_ago);
    CostRecord::new("session", usage)
}

#[test]
fn records_round_trip_oldest_first() {
    let docs = docs_in(&MemoryStorage::new(), "local");
    let newer = record("b/model", 0.5, 1);
    let older = record("a/model", 0.25, 60);
    docs.add(&newer).unwrap();
    docs.add(&older).unwrap();
    let all = docs.all().unwrap();
    assert_eq!(all.len(), 2);
    assert_eq!(all[0].id, older.id);
    assert_eq!(all[1].id, newer.id);
    assert_eq!(all[1].usage.cost_usd, 0.5);
    assert_eq!(all[1].session_id, "session");
}

#[test]
fn a_record_is_written_once() {
    let docs = docs_in(&MemoryStorage::new(), "local");
    let rec = record("a/model", 0.1, 0);
    docs.add(&rec).unwrap();
    assert!(docs.add(&rec).is_err());
    assert_eq!(docs.all().unwrap().len(), 1);
}

#[test]
fn scopes_do_not_see_each_others_costs() {
    let storage = MemoryStorage::new();
    let alice = docs_in(&storage, "alice");
    let bob = docs_in(&storage, "bob");
    alice.add(&record("a/model", 1.0, 0)).unwrap();
    assert_eq!(alice.all().unwrap().len(), 1);
    assert!(bob.all().unwrap().is_empty());
}

#[test]
fn a_legacy_jsonl_ledger_is_imported_once_and_set_aside() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("costs.jsonl");
    let first = record("a/model", 0.5, 30);
    let second = record("b/model", 0.25, 10);
    std::fs::write(
        &path,
        format!(
            "{}\n\nnot json\n{}\n",
            serde_json::to_string(&first).unwrap(),
            serde_json::to_string(&second).unwrap()
        ),
    )
    .unwrap();
    let docs = docs_in(&MemoryStorage::new(), "local");
    assert_eq!(docs.import_legacy(&path).unwrap(), 2);
    assert_eq!(docs.all().unwrap().len(), 2);
    assert!(!path.exists());
    assert!(dir.path().join("costs.jsonl.migrated").exists());
    // Nothing left to import.
    assert_eq!(docs.import_legacy(&path).unwrap(), 0);
}

#[test]
fn a_legacy_import_skips_ids_already_stored_or_repeated() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("costs.jsonl");
    let first = record("a/model", 0.5, 30);
    let second = record("b/model", 0.25, 10);
    let line = |r: &CostRecord| serde_json::to_string(r).unwrap();
    // `second` repeats in the file; `first` was stored by another core.
    std::fs::write(
        &path,
        format!("{}\n{}\n{}\n", line(&first), line(&second), line(&second)),
    )
    .unwrap();
    let docs = docs_in(&MemoryStorage::new(), "local");
    docs.add(&first).unwrap();
    assert_eq!(docs.import_legacy(&path).unwrap(), 1);
    assert_eq!(docs.all().unwrap().len(), 2);
}

#[test]
fn a_failed_rename_fails_the_import_and_a_retry_creates_nothing_twice() {
    let dir = tempfile::tempdir().unwrap();
    let path = dir.path().join("costs.jsonl");
    let rec = record("a/model", 0.5, 30);
    std::fs::write(&path, format!("{}\n", serde_json::to_string(&rec).unwrap())).unwrap();
    // A non-empty directory where the rename target goes blocks the rename.
    let blocker = dir.path().join("costs.jsonl.migrated");
    std::fs::create_dir_all(blocker.join("x")).unwrap();
    let docs = docs_in(&MemoryStorage::new(), "local");
    assert!(docs.import_legacy(&path).is_err());
    assert!(path.exists(), "the ledger stays for a retry");
    std::fs::remove_dir_all(&blocker).unwrap();
    assert_eq!(docs.import_legacy(&path).unwrap(), 0);
    assert_eq!(docs.all().unwrap().len(), 1);
    assert!(!path.exists());
}
