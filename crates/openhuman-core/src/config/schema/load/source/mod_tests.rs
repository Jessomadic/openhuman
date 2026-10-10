use super::tests_support::ForcedDocumentSource;
use super::*;
use crate::config::Config;
use crate::storage::{MemoryStorage, Scope, ScopedStorage, StorageBackend};
use std::sync::Arc;

fn scoped(storage: &MemoryStorage, scope: &str) -> ScopedStorage {
    storage.for_scope(&Scope::new(scope).unwrap()).unwrap()
}

fn document_source(storage: &MemoryStorage, scope: &str, file: &Path) -> DocumentConfigSource {
    DocumentConfigSource::new(
        Arc::clone(scoped(storage, scope).documents()),
        scope.to_string(),
        FileConfigSource::new(file),
    )
}

fn config_at(dir: &Path, model: &str) -> Config {
    Config {
        config_path: dir.join("config.toml"),
        workspace_dir: dir.join("workspace"),
        default_model: Some(model.to_string()),
        ..Default::default()
    }
}

// ── File source ──────────────────────────────────────────────────────────────

#[tokio::test]
async fn the_file_source_round_trips_hand_edits_and_commits_atomically() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("config.toml");
    let source = FileConfigSource::new(&path);
    assert!(!source.exists().await);

    source.write("default_model = \"one\"\n").await.unwrap();
    assert!(source.exists().await);

    // A hand edit (with a comment) is read back verbatim.
    std::fs::write(&path, "# my note\ndefault_model = \"hand-edited\"\n").unwrap();
    let read = source.read().await.unwrap();
    assert_eq!(
        read.contents,
        "# my note\ndefault_model = \"hand-edited\"\n"
    );
    assert!(!read.recovered);

    // The next write replaces it atomically: the previous bytes become `.bak`
    // and no staged temp file is left behind.
    source.write("default_model = \"two\"\n").await.unwrap();
    assert_eq!(
        std::fs::read_to_string(tmp.path().join("config.toml.bak")).unwrap(),
        "# my note\ndefault_model = \"hand-edited\"\n"
    );
    let leftovers: Vec<_> = std::fs::read_dir(tmp.path())
        .unwrap()
        .filter_map(|e| e.ok()?.file_name().into_string().ok())
        .filter(|name| name.contains(".tmp-"))
        .collect();
    assert!(leftovers.is_empty(), "{leftovers:?}");
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        let mode = std::fs::metadata(&path).unwrap().permissions().mode() & 0o777;
        assert_eq!(mode, 0o600);
    }
}

#[tokio::test]
async fn a_save_keeps_hand_edits_but_not_comments() {
    // Pins today's behaviour: `Config::save` re-serialises the whole config,
    // so a hand edit to a value survives and a comment does not.
    let tmp = tempfile::tempdir().unwrap();
    let config = config_at(tmp.path(), "before");
    config.save().await.unwrap();
    let edited = std::fs::read_to_string(&config.config_path)
        .unwrap()
        .replace("before", "hand-edited");
    std::fs::write(&config.config_path, format!("# keep me?\n{edited}")).unwrap();

    let reloaded = Config::load_from_config_path(&config.config_path, &config.workspace_dir)
        .await
        .unwrap();
    assert_eq!(reloaded.default_model.as_deref(), Some("hand-edited"));
    reloaded.save().await.unwrap();
    let saved = std::fs::read_to_string(&config.config_path).unwrap();
    assert!(saved.contains("hand-edited"));
    assert!(!saved.contains("keep me?"), "comments are not preserved");
}

// ── Document source ──────────────────────────────────────────────────────────

#[tokio::test]
async fn a_document_never_holds_the_bootstrap_tables() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("config.toml");
    let storage = MemoryStorage::new();
    let source = document_source(&storage, "alice", &file);

    source
        .write("default_model = \"m\"\n[storage]\nurl = \"mongodb://u:pw@db/x\"\n")
        .await
        .unwrap();

    let docs = Arc::clone(scoped(&storage, "alice").documents());
    let stored = docs.get("config", "alice").await.unwrap().unwrap();
    let body = stored.doc["toml"].as_str().unwrap().to_string();
    assert!(body.contains("default_model"));
    assert!(
        !body.contains("mongodb") && !body.contains("[storage]"),
        "{body}"
    );
}

#[tokio::test]
async fn a_document_read_takes_its_bootstrap_tables_from_the_file() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("config.toml");
    std::fs::write(&file, "[storage]\nurl = \"sqlite:/data\"\n").unwrap();
    let storage = MemoryStorage::new();
    let source = document_source(&storage, "alice", &file);
    source.write("default_model = \"m\"\n").await.unwrap();

    let read = source.read().await.unwrap();
    let table: toml::Table = toml::from_str(&read.contents).unwrap();
    assert_eq!(table["default_model"].as_str(), Some("m"));
    assert_eq!(table["storage"]["url"].as_str(), Some("sqlite:/data"));

    // Even a document that somehow carries a [storage] table is overruled.
    let docs = Arc::clone(scoped(&storage, "alice").documents());
    docs.put(
        "config",
        "alice",
        serde_json::json!({"toml": "[storage]\nurl = \"evil\"\n"}),
        tinystoragedrivers::Precondition::None,
    )
    .await
    .unwrap();
    let read = source.read().await.unwrap();
    assert!(!read.contents.contains("evil"), "{}", read.contents);
    assert!(read.contents.contains("sqlite:/data"));
}

#[tokio::test]
async fn without_a_document_the_source_reads_the_file() {
    let tmp = tempfile::tempdir().unwrap();
    let file = tmp.path().join("config.toml");
    let storage = MemoryStorage::new();
    let source = document_source(&storage, "alice", &file);
    assert!(!source.exists().await);

    std::fs::write(&file, "default_model = \"from-file\"\n").unwrap();
    assert!(source.exists().await);
    assert_eq!(
        source.read().await.unwrap().contents,
        "default_model = \"from-file\"\n"
    );
    assert_eq!(source.label(), "document");
}

#[tokio::test]
async fn two_scopes_keep_their_config_apart() {
    let tmp = tempfile::tempdir().unwrap();
    let storage = MemoryStorage::new();
    let alice = document_source(&storage, "alice", &tmp.path().join("a.toml"));
    let bob = document_source(&storage, "bob", &tmp.path().join("b.toml"));

    alice
        .write("default_model = \"alice-model\"\n")
        .await
        .unwrap();
    assert!(alice.exists().await);
    assert!(!bob.exists().await, "bob sees nothing of alice's config");

    bob.write("default_model = \"bob-model\"\n").await.unwrap();
    assert!(alice.read().await.unwrap().contents.contains("alice-model"));
    assert!(bob.read().await.unwrap().contents.contains("bob-model"));
    assert!(!bob.read().await.unwrap().contents.contains("alice-model"));
}

// ── Through Config ───────────────────────────────────────────────────────────

#[tokio::test]
async fn config_save_and_reload_use_the_document_on_a_shared_backend() {
    let tmp = tempfile::tempdir().unwrap();
    let storage = MemoryStorage::new();
    let _forced = ForcedDocumentSource::new(scoped(&storage, "tenant-a"), "tenant-a");

    let mut config = config_at(tmp.path(), "doc-model");
    config.storage.url = Some("sqlite:/bootstrap".to_string());
    config.save().await.unwrap();
    assert!(
        !config.config_path.exists(),
        "a document-backed save does not touch the file"
    );

    // The bootstrap table comes from the file, which is the only place it lives.
    std::fs::write(
        &config.config_path,
        "[storage]\nurl = \"sqlite:/bootstrap\"\n",
    )
    .unwrap();
    let reloaded = Config::load_from_config_path(&config.config_path, &config.workspace_dir)
        .await
        .unwrap();
    assert_eq!(reloaded.default_model.as_deref(), Some("doc-model"));
    assert_eq!(reloaded.storage.url.as_deref(), Some("sqlite:/bootstrap"));
}

#[tokio::test]
async fn without_a_shared_backend_config_stays_on_the_file() {
    // No forced scope and no installed backend: the file source.
    let tmp = tempfile::tempdir().unwrap();
    let config = config_at(tmp.path(), "file-model");
    config.save().await.unwrap();
    assert!(config.config_path.exists());
    assert_eq!(for_config(&config.config_path).label(), "file");
}
