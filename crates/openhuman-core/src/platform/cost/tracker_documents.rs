//! The cost ledger on the `tinystoragedrivers` document port.
//!
//! Used instead of `state/costs.jsonl` when the host configured a storage
//! backend ([`crate::storage`]); `CostStorage` in `tracker.rs` picks it per
//! call, so records live under the acting agent's storage scope (`local` on a
//! single-user host). Without a backend the JSONL file at today's path is
//! used unchanged.
//!
//! # Layout
//!
//! | Collection | Document id | Holds |
//! | --- | --- | --- |
//! | `cost_records` | record id | one [`CostRecord`], plus `ts_ms` (epoch ms) for ordering |
//!
//! The JSONL ledger is append-only, so a record is written once
//! (`Precondition::Absent`) and never edited. Readers get the records oldest
//! first, the order the file kept them in.

use anyhow::{Context, Result};
use serde_json::Value;
use tinystoragedrivers::{CollectionSpec, IndexSpec, Precondition, Query, Sort};

use super::types::CostRecord;
use crate::storage::documents::Repo;
use crate::storage::DocumentStoreExt;

const RECORDS: &str = "cost_records";
const DOMAIN: &str = "cost::tracker";

fn collections() -> Vec<CollectionSpec> {
    vec![CollectionSpec::new(RECORDS).index(IndexSpec::new("by_time", ["ts_ms"]))]
}

/// The document store for this call, when the host configured one.
pub(super) fn current() -> Result<Option<CostDocs>> {
    #[cfg(test)]
    if let Some(docs) = TEST_OVERRIDE.with(|slot| slot.borrow().clone()) {
        return Ok(Some(docs));
    }
    Ok(Repo::current(DOMAIN, collections)?.map(CostDocs))
}

/// Runs `f` with `docs` standing in for the installed backend, on this thread
/// only, so tests exercise the dispatch without the process-wide slot.
#[cfg(test)]
pub(super) fn with_override<T>(docs: CostDocs, f: impl FnOnce() -> T) -> T {
    TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = Some(docs));
    let out = f();
    TEST_OVERRIDE.with(|slot| *slot.borrow_mut() = None);
    out
}

#[cfg(test)]
thread_local! {
    static TEST_OVERRIDE: std::cell::RefCell<Option<CostDocs>> = const { std::cell::RefCell::new(None) };
}

/// The cost ledger over one scoped document handle.
#[derive(Clone)]
pub(super) struct CostDocs(Repo);

impl CostDocs {
    #[cfg(test)]
    pub(super) fn over(scoped: &crate::storage::ScopedStorage) -> Self {
        Self(Repo::over(scoped, DOMAIN, collections))
    }

    /// Appends one record.
    pub(super) fn add(&self, record: &CostRecord) -> Result<()> {
        let mut doc = serde_json::to_value(record).context("serialize cost record")?;
        doc["ts_ms"] = Value::from(record.usage.timestamp.timestamp_millis());
        let id = record.id.clone();
        log::trace!("[cost::tracker] document add id={id}");
        self.0.run(|docs| async move {
            docs.put(RECORDS, &id, doc, Precondition::Absent)
                .await
                .map(|_| ())
        })
    }

    /// Imports a legacy `state/costs.jsonl` into an empty ledger, then renames
    /// it to `costs.jsonl.migrated` so it is not read twice. Returns how many
    /// records were imported. Malformed lines are skipped, as readers skip them.
    pub(super) fn import_legacy(&self, path: &std::path::Path) -> Result<usize> {
        if !path.exists() {
            return Ok(0);
        }
        let existing: std::collections::HashSet<String> =
            self.all()?.into_iter().map(|record| record.id).collect();
        let raw = std::fs::read_to_string(path)
            .with_context(|| format!("read legacy cost ledger {}", path.display()))?;
        let mut imported = 0;
        for line in raw.lines().map(str::trim).filter(|line| !line.is_empty()) {
            match serde_json::from_str::<CostRecord>(line) {
                Ok(record) if existing.contains(&record.id) => {
                    let _ = record;
                }
                Ok(record) => {
                    self.add(&record)?;
                    imported += 1;
                }
                Err(error) => log::warn!("[cost::tracker] legacy import: skipping line: {error}"),
            }
        }
        let migrated = path.with_extension("jsonl.migrated");
        if let Err(error) = std::fs::rename(path, &migrated) {
            log::warn!("[cost::tracker] legacy import: could not rename ledger: {error}");
        }
        log::debug!("[cost::tracker] legacy import: imported={imported}");
        Ok(imported)
    }

    /// Every record, oldest first. Documents that no longer parse are skipped
    /// with a warning, as malformed ledger lines are.
    pub(super) fn all(&self) -> Result<Vec<CostRecord>> {
        let stored = self.0.run(|docs| async move {
            docs.query_all(
                RECORDS,
                &Query::all().sort(Sort::asc("ts_ms")).sort(Sort::asc("_id")),
            )
            .await
        })?;
        Ok(stored
            .into_iter()
            .filter_map(|item| match serde_json::from_value(item.doc) {
                Ok(record) => Some(record),
                Err(error) => {
                    log::warn!(
                        "[cost::tracker] skipping malformed cost document id={} error={error}",
                        item.id
                    );
                    None
                }
            })
            .collect())
    }
}

#[cfg(test)]
#[path = "tracker_documents_tests.rs"]
mod tests;
