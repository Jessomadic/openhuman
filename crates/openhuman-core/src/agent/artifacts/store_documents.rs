//! Artifact records on the `tinystoragedrivers` document port.
//!
//! Used instead of `<workspace>/artifacts/<id>/meta.json` and `args.json`
//! when the host configured a storage backend ([`crate::storage`]);
//! `store.rs` picks it per call, so the records live under the acting agent's
//! storage scope (`local` on a single-user host).
//!
//! # Layout
//!
//! | Collection | Document id | Holds |
//! | --- | --- | --- |
//! | `artifacts` | artifact id | the [`ArtifactMeta`] fields, plus `created_ms` for ordering |
//! | `artifact_args` | artifact id | `args`: the producer-tool arguments (the `args.json` sidecar) |
//!
//! # Content files
//!
//! Only the records move. An artifact's bytes are a file in the visible files
//! folder (`ArtifactMeta::file`), which the user opens, edits and deletes
//! outside OpenHuman; the port has no blob store for that, so the file stays
//! where it is on every backend and the record names it. A shared database
//! therefore shares the list, the status and the regenerate arguments, not the
//! bytes.
//!
//! The first time document mode finds an empty `artifacts` collection it
//! imports the legacy `meta.json` / `args.json` files of the workspace
//! ([`Docs::import_legacy`]); the files are left in place.

use std::path::Path;

use anyhow::{Context, Result};
use serde_json::{json, Value};
use tinystoragedrivers::{CollectionSpec, Precondition, Query, Sort};

use super::types::ArtifactMeta;
use crate::storage::documents::Repo;
use crate::storage::DocumentStoreExt;

const ARTIFACTS: &str = "artifacts";
const ARGS: &str = "artifact_args";
const DOMAIN: &str = "artifacts::store";

fn collections() -> Vec<CollectionSpec> {
    vec![CollectionSpec::new(ARTIFACTS), CollectionSpec::new(ARGS)]
}

/// The document store for this call, when the host configured one.
pub(super) fn current() -> Result<Option<Docs>> {
    #[cfg(test)]
    if let Some(docs) = TEST_OVERRIDE.with(|slot| slot.borrow().clone()) {
        return Ok(Some(docs));
    }
    Ok(Repo::current(DOMAIN, collections)?.map(Docs))
}

/// Runs `f` with `docs` standing in for the installed backend, on this thread
/// only, so tests exercise the dispatch without the process-wide slot.
#[cfg(test)]
pub(super) fn with_override<T>(docs: Docs, f: impl FnOnce() -> T) -> T {
    TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = Some(docs));
    let out = f();
    TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = None);
    out
}

#[cfg(test)]
thread_local! {
    static TEST_OVERRIDE: std::cell::RefCell<Option<Docs>> = const { std::cell::RefCell::new(None) };
}

/// The artifact records over one scoped document handle.
#[derive(Clone)]
pub(super) struct Docs(Repo);

impl Docs {
    #[cfg(test)]
    pub(super) fn over(scoped: &crate::storage::ScopedStorage) -> Self {
        Self(Repo::over(scoped, DOMAIN, collections))
    }

    pub(super) fn put_meta(&self, meta: &ArtifactMeta) -> Result<()> {
        let mut doc = serde_json::to_value(meta).context("serialize artifact meta")?;
        doc["created_ms"] = Value::from(meta.created_at.timestamp_millis());
        let id = meta.id.clone();
        self.0.run(|docs| async move {
            docs.put(ARTIFACTS, &id, doc, Precondition::None)
                .await
                .map(|_| ())
        })
    }

    pub(super) fn get_meta(&self, id: &str) -> Result<Option<ArtifactMeta>> {
        let id = id.to_string();
        let stored = self
            .0
            .run(|docs| async move { docs.get(ARTIFACTS, &id).await })?;
        stored
            .map(|stored| serde_json::from_value(stored.doc).context("parse artifact meta"))
            .transpose()
    }

    /// Every record, newest first. A document that no longer parses is skipped
    /// with a warning, as a corrupt `meta.json` is.
    pub(super) fn list_meta(&self) -> Result<Vec<ArtifactMeta>> {
        let stored = self.0.run(|docs| async move {
            docs.query_all(
                ARTIFACTS,
                &Query::all()
                    .sort(Sort::desc("created_ms"))
                    .sort(Sort::asc("_id")),
            )
            .await
        })?;
        Ok(stored
            .into_iter()
            .filter_map(|item| match serde_json::from_value(item.doc) {
                Ok(meta) => Some(meta),
                Err(error) => {
                    log::warn!(
                        "[artifacts] skipping artifact document id={} error={error}",
                        item.id
                    );
                    None
                }
            })
            .collect())
    }

    pub(super) fn put_args(&self, id: &str, args: &Value) -> Result<()> {
        let id = id.to_string();
        let doc = json!({ "args": args });
        self.0.run(|docs| async move {
            docs.put(ARGS, &id, doc, Precondition::None)
                .await
                .map(|_| ())
        })
    }

    pub(super) fn get_args(&self, id: &str) -> Result<Option<Value>> {
        let id = id.to_string();
        let stored = self.0.run(|docs| async move { docs.get(ARGS, &id).await })?;
        Ok(stored.and_then(|stored| stored.doc.get("args").cloned()))
    }

    /// Removes the record and its arguments; `false` when there was no record.
    pub(super) fn delete(&self, id: &str) -> Result<bool> {
        let id = id.to_string();
        self.0.run(|docs| async move {
            docs.delete(ARGS, &id, Precondition::None).await?;
            docs.delete(ARTIFACTS, &id, Precondition::None).await
        })
    }

    /// Imports the workspace's legacy `meta.json` / `args.json` files when the
    /// collection is still empty. Returns how many records were imported.
    pub(super) fn import_legacy(&self, artifacts_dir: &Path) -> Result<usize> {
        if !self.list_meta()?.is_empty() {
            return Ok(0);
        }
        let Ok(entries) = std::fs::read_dir(artifacts_dir) else {
            return Ok(0);
        };
        let mut imported = 0;
        for entry in entries.flatten().filter(|entry| entry.path().is_dir()) {
            let Ok(raw) = std::fs::read_to_string(entry.path().join("meta.json")) else {
                continue;
            };
            let Ok(meta) = serde_json::from_str::<ArtifactMeta>(&raw) else {
                log::warn!(
                    "[artifacts] legacy import: skipping corrupt meta.json in {}",
                    entry.path().display()
                );
                continue;
            };
            self.put_meta(&meta)?;
            if let Some(args) = std::fs::read_to_string(entry.path().join("args.json"))
                .ok()
                .and_then(|raw| serde_json::from_str::<Value>(&raw).ok())
            {
                self.put_args(&meta.id, &args)?;
            }
            imported += 1;
        }
        log::debug!("[artifacts] legacy import: imported={imported}");
        Ok(imported)
    }
}

#[cfg(test)]
#[path = "store_documents_tests.rs"]
mod tests;
