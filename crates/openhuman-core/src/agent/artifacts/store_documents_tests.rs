use super::*;
use crate::agent::artifacts::store::{
    delete_artifact, get_artifact, list_artifacts, read_artifact_args, save_artifact_args,
    save_artifact_meta,
};
use crate::agent::artifacts::types::{ArtifactKind, ArtifactStatus};
use crate::agent::artifacts::FileRoots;
use crate::storage::{MemoryStorage, Scope, StorageBackend};
use chrono::{TimeZone, Utc};

fn docs_in(storage: &MemoryStorage, scope: &str) -> Docs {
    Docs::over(&storage.for_scope(&Scope::new(scope).unwrap()).unwrap())
}

fn meta(id: &str, month: u32, thread: Option<&str>) -> ArtifactMeta {
    ArtifactMeta {
        id: id.to_string(),
        kind: ArtifactKind::Document,
        title: format!("title {id}"),
        path: format!("{id}.txt"),
        file: None,
        file_root: None,
        size_bytes: 10,
        status: ArtifactStatus::Ready,
        created_at: Utc.with_ymd_and_hms(2025, month, 1, 0, 0, 0).unwrap(),
        error: None,
        thread_id: thread.map(str::to_string),
        tool_call_id: None,
    }
}

#[test]
fn records_round_trip_newest_first() {
    let docs = docs_in(&MemoryStorage::new(), "local");
    docs.put_meta(&meta("a", 1, None)).unwrap();
    docs.put_meta(&meta("c", 3, None)).unwrap();
    docs.put_meta(&meta("b", 2, None)).unwrap();
    let ids: Vec<_> = docs
        .list_meta()
        .unwrap()
        .into_iter()
        .map(|m| m.id)
        .collect();
    assert_eq!(ids, ["c", "b", "a"]);
    assert_eq!(docs.get_meta("b").unwrap().unwrap().title, "title b");
    assert!(docs.get_meta("missing").unwrap().is_none());
}

#[test]
fn args_and_delete() {
    let docs = docs_in(&MemoryStorage::new(), "local");
    docs.put_meta(&meta("a", 1, None)).unwrap();
    docs.put_args("a", &serde_json::json!({ "k": 1 })).unwrap();
    assert_eq!(docs.get_args("a").unwrap().unwrap()["k"], 1);
    assert!(docs.delete("a").unwrap());
    assert!(docs.get_meta("a").unwrap().is_none());
    assert!(docs.get_args("a").unwrap().is_none());
    assert!(!docs.delete("a").unwrap());
}

#[test]
fn scopes_do_not_see_each_others_artifacts() {
    let storage = MemoryStorage::new();
    docs_in(&storage, "alice")
        .put_meta(&meta("a", 1, None))
        .unwrap();
    assert!(docs_in(&storage, "bob").list_meta().unwrap().is_empty());
    assert_eq!(docs_in(&storage, "alice").list_meta().unwrap().len(), 1);
}

#[test]
fn the_legacy_files_are_imported_once_into_an_empty_collection() {
    let dir = tempfile::tempdir().unwrap();
    let a = dir.path().join("a");
    std::fs::create_dir_all(&a).unwrap();
    std::fs::write(
        a.join("meta.json"),
        serde_json::to_string(&meta("a", 1, Some("t"))).unwrap(),
    )
    .unwrap();
    std::fs::write(a.join("args.json"), r#"{"x":2}"#).unwrap();
    let bad = dir.path().join("bad");
    std::fs::create_dir_all(&bad).unwrap();
    std::fs::write(bad.join("meta.json"), "{nope").unwrap();

    let docs = docs_in(&MemoryStorage::new(), "local");
    assert_eq!(docs.import_legacy(dir.path()).unwrap(), 1);
    assert_eq!(
        docs.get_meta("a").unwrap().unwrap().thread_id.as_deref(),
        Some("t")
    );
    assert_eq!(docs.get_args("a").unwrap().unwrap()["x"], 2);
    // A non-empty collection is not imported over.
    assert_eq!(docs.import_legacy(dir.path()).unwrap(), 0);
    assert_eq!(docs.import_legacy(&dir.path().join("none")).unwrap(), 0);
}

#[tokio::test]
async fn the_store_dispatches_to_documents_when_a_backend_is_pinned() {
    let storage = MemoryStorage::new();
    let docs = docs_in(&storage, "local");
    let workspace = tempfile::tempdir().unwrap();
    let ws = workspace.path();
    store_documents::TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = Some(docs.clone()));

    save_artifact_meta(ws, &meta("a", 1, Some("t1")))
        .await
        .unwrap();
    save_artifact_meta(ws, &meta("b", 2, Some("t2")))
        .await
        .unwrap();
    assert_eq!(get_artifact(ws, "a").await.unwrap().id, "a");
    assert!(get_artifact(ws, "zz").await.is_err());
    let (page, total) = list_artifacts(ws, 0, 10, Some("t1")).await.unwrap();
    assert_eq!((page.len(), total), (1, 1));
    let (all, _) = list_artifacts(ws, 0, 10, None).await.unwrap();
    assert_eq!(all[0].id, "b");

    save_artifact_args(ws, "a", &serde_json::json!({ "n": 1 }))
        .await
        .unwrap();
    assert_eq!(read_artifact_args(ws, "a").await.unwrap()["n"], 1);
    assert!(read_artifact_args(ws, "b").await.is_err());

    delete_artifact(ws, FileRoots::from(ws.to_path_buf()), "a")
        .await
        .unwrap();
    store_documents::TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = None);

    assert!(docs.get_meta("a").unwrap().is_none());
    assert!(docs.get_meta("b").unwrap().is_some());
    assert!(!ws.join("artifacts/a/meta.json").exists());
}
