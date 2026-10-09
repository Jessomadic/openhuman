//! The default layout for the small stores: SQLite document tables inside the
//! database file each store already had.
//!
//! Approvals, devices, notifications and task sources each keep one `.db`
//! file (`<workspace>/approval/approval.db`, `devices/devices.db`,
//! `notifications/notifications.db`, `task_sources/sources.db`). With no
//! storage URL configured ([`super::config::StorageMode::Default`]) a store's
//! first call opens that file with the SQLite storage driver, so its records
//! live in the driver's generic document tables beside the old ones, and
//! [`open`] runs a one-shot import of the old tables' rows.
//!
//! # The import
//!
//! A store describes its old tables with an [`ImportPlan`]: the table names
//! and a reader that turns their rows into documents shaped exactly as the
//! store's own document code writes them. [`open`] then
//!
//! 1. does nothing unless one of the plan's tables exists in the file;
//! 2. reads the rows (through the store's own legacy open path, so an old
//!    schema is migrated forward first);
//! 3. writes each as a document that must not already exist, so a re-run
//!    after a crash never overwrites a record the new code has since changed;
//! 4. renames every old table to `_legacy_<name>`, keeping its rows for one
//!    release, which is also what makes a second open a no-op.
//!
//! The writes and the rename are separate statements (the driver owns its
//! own connection), so the import is resumable rather than a single
//! transaction: a crash between 3 and 4 repeats 3 harmlessly.
//!
//! Records land under [`Scope::local`]: the file already belongs to one
//! workspace, so the scope inside it carries no isolation.
//!
//! Nothing here runs when a backend is installed (the host's explicit URL; the
//! store uses that backend and its scope as before), when the process opted
//! out ([`super::config::CLASSIC`]), in SaaS mode, or in a build without
//! `storage-sqlite`: those keep the legacy tables.

use std::path::Path;
use std::sync::Arc;
#[cfg(feature = "storage-sqlite")]
use std::{
    collections::HashMap,
    path::PathBuf,
    sync::{LazyLock, Mutex, PoisonError},
};

use anyhow::{anyhow, Context, Result};
use rusqlite::Connection;
use serde_json::Value;
use tinystoragedrivers::{CollectionSpec, Precondition};

use super::config::{mode, StorageMode};
use super::documents::Repo;
use super::{current_scope, installed, Scope, ScopedStorage, StorageBackend};
use crate::config::Config;

/// One legacy row as a document of the new layout.
#[derive(Debug, Clone, PartialEq)]
pub struct ImportDoc {
    /// The collection the store keeps it in.
    pub collection: &'static str,
    /// The document id.
    pub id: String,
    /// The document body.
    pub doc: Value,
}

/// What a store brings from its old tables.
pub struct ImportPlan<'a> {
    /// Log prefix, e.g. `approval::store`.
    pub domain: &'static str,
    /// The old tables. Each present one is renamed to `_legacy_<name>` after
    /// the rows are copied.
    pub tables: &'static [&'static str],
    /// Reads the old rows. Called only when one of `tables` exists.
    pub read: &'a dyn Fn() -> Result<Vec<ImportDoc>>,
}

/// A backend and the scope a store's records live under in it.
#[derive(Clone)]
pub struct Opened {
    /// The storage backend.
    pub backend: Arc<dyn StorageBackend>,
    /// The scope within it.
    pub scope: Scope,
}

impl Opened {
    /// The backend bound to the scope.
    ///
    /// # Errors
    ///
    /// When the backend refuses the scope.
    pub fn scoped(&self) -> Result<ScopedStorage> {
        self.backend
            .for_scope(&self.scope)
            .map_err(|error| anyhow!("open the storage scope: {error}"))
    }
}

/// Databases already opened (and imported) by this process.
#[cfg(feature = "storage-sqlite")]
static OPENED: LazyLock<Mutex<HashMap<PathBuf, Arc<dyn StorageBackend>>>> =
    LazyLock::new(Mutex::default);

/// The storage a small store uses for this call, or `None` for its legacy
/// tables.
///
/// With a backend installed that is the backend, under the acting agent's
/// scope. Otherwise, in [`StorageMode::Default`], it is the SQLite file at
/// `db_path` (opened once per process, its old tables imported first) under
/// [`Scope::local`].
///
/// # Errors
///
/// When the scope cannot be resolved (SaaS mode with no acting agent), the
/// file cannot be opened, or a configured import fails to read its source.
pub fn open(
    config: &Config,
    db_path: &Path,
    collections: fn() -> Vec<CollectionSpec>,
    plan: &ImportPlan<'_>,
) -> Result<Option<Opened>> {
    if let Some(backend) = installed() {
        let scope = current_scope()
            .with_context(|| format!("[{}] resolve the storage scope", plan.domain))?;
        return Ok(Some(Opened { backend, scope }));
    }
    if mode(config) != StorageMode::Default {
        return Ok(None);
    }
    open_default(db_path, collections, plan)
}

/// [`open`] as a [`Repo`] for the stores built on one.
///
/// # Errors
///
/// As [`open`].
pub fn repo(
    config: &Config,
    db_path: &Path,
    domain: &'static str,
    collections: fn() -> Vec<CollectionSpec>,
    plan: &ImportPlan<'_>,
) -> Result<Option<Repo>> {
    open(config, db_path, collections, plan)?
        .map(|opened| Repo::on(&opened.backend, &opened.scope, domain, collections))
        .transpose()
}

#[cfg(not(feature = "storage-sqlite"))]
fn open_default(
    _db_path: &Path,
    _collections: fn() -> Vec<CollectionSpec>,
    plan: &ImportPlan<'_>,
) -> Result<Option<Opened>> {
    tracing::debug!(
        domain = plan.domain,
        "[storage::local] built without storage-sqlite; keeping the legacy tables"
    );
    Ok(None)
}

#[cfg(feature = "storage-sqlite")]
fn open_default(
    db_path: &Path,
    collections: fn() -> Vec<CollectionSpec>,
    plan: &ImportPlan<'_>,
) -> Result<Option<Opened>> {
    // Held across the import so two threads never both import one file.
    let mut opened = OPENED.lock().unwrap_or_else(PoisonError::into_inner);
    if let Some(backend) = opened.get(db_path) {
        return Ok(Some(Opened {
            backend: Arc::clone(backend),
            scope: Scope::local(),
        }));
    }
    if let Some(parent) = db_path.parent() {
        std::fs::create_dir_all(parent).with_context(|| {
            format!(
                "[{}] create the directory {}",
                plan.domain,
                parent.display()
            )
        })?;
    }
    let url = tinystoragedrivers::StorageConfig::parse(&format!("sqlite:{}", db_path.display()))
        .map_err(|error| anyhow!("[{}] storage url: {error}", plan.domain))?;
    let backend = super::block_on(async move { tinystoragedrivers::open(&url).await })
        .map_err(|error| anyhow!("[{}] open {}: {error}", plan.domain, db_path.display()))?;
    let handle = Opened {
        backend,
        scope: Scope::local(),
    };
    match import(db_path, &handle, collections, plan) {
        Ok(count) => {
            tracing::debug!(
                domain = plan.domain,
                path = %db_path.display(),
                imported = count,
                "[storage::local] opened the default store"
            );
            opened.insert(db_path.to_path_buf(), Arc::clone(&handle.backend));
        }
        // Not remembered, so the next call retries; the import is resumable.
        Err(error) => tracing::error!(
            domain = plan.domain,
            path = %db_path.display(),
            "[storage::local] importing the legacy tables failed, will retry: {error:#}"
        ),
    }
    Ok(Some(handle))
}

/// Copies `plan`'s old rows into `handle` and retires the old tables.
/// Returns how many documents were written.
#[cfg(feature = "storage-sqlite")]
fn import(
    db_path: &Path,
    handle: &Opened,
    collections: fn() -> Vec<CollectionSpec>,
    plan: &ImportPlan<'_>,
) -> Result<usize> {
    if !db_path.exists() {
        return Ok(0);
    }
    let present = present_tables(db_path, plan.tables)?;
    if present.is_empty() {
        return Ok(0);
    }
    let rows = (plan.read)().with_context(|| format!("[{}] read the legacy rows", plan.domain))?;
    let total = rows.len();
    let repo = Repo::on(&handle.backend, &handle.scope, plan.domain, collections)?;
    let written = repo.run(|docs| async move {
        let mut written = 0usize;
        for row in rows {
            match docs
                .put(row.collection, &row.id, row.doc, Precondition::Absent)
                .await
            {
                Ok(_) => written += 1,
                // Already there (a resumed import, or newer than the row).
                Err(error) if error.kind() == tinystoragedrivers::ErrorKind::Conflict => {}
                Err(error) => return Err(error),
            }
        }
        Ok(written)
    })?;
    retire_tables(db_path, &present)?;
    tracing::info!(
        domain = plan.domain,
        rows = total,
        written,
        tables = ?present,
        "[storage::local] imported the legacy tables; kept as _legacy_<name>"
    );
    Ok(written)
}

/// Forgets that `db_path` was opened, so the next call opens (and imports)
/// it afresh: how a test models a restart.
#[cfg(all(test, feature = "storage-sqlite"))]
pub(crate) fn forget(db_path: &Path) {
    OPENED
        .lock()
        .unwrap_or_else(PoisonError::into_inner)
        .remove(db_path);
}

/// The names of `db_path`'s tables, sorted (test inspection).
#[cfg(test)]
pub(crate) fn table_names(db_path: &Path) -> Vec<String> {
    let conn = Connection::open(db_path).unwrap();
    let mut stmt = conn
        .prepare("SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name")
        .unwrap();
    stmt.query_map([], |row| row.get(0))
        .unwrap()
        .map(Result::unwrap)
        .collect()
}

/// Whether `table` exists on `conn`.
pub fn table_exists(conn: &Connection, table: &str) -> rusqlite::Result<bool> {
    conn.query_row(
        "SELECT EXISTS(SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = ?1)",
        [table],
        |row| row.get(0),
    )
}

#[cfg(feature = "storage-sqlite")]
fn present_tables(db_path: &Path, tables: &[&'static str]) -> Result<Vec<&'static str>> {
    let conn = Connection::open(db_path)
        .with_context(|| format!("open {} to look for legacy tables", db_path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let mut present = Vec::new();
    for table in tables {
        if table_exists(&conn, table)? {
            present.push(*table);
        }
    }
    Ok(present)
}

/// Renames each table to `_legacy_<name>` (a numeric suffix if that name is
/// taken, so an earlier retired copy is never overwritten).
#[cfg(feature = "storage-sqlite")]
fn retire_tables(db_path: &Path, tables: &[&str]) -> Result<()> {
    let mut conn = Connection::open(db_path)
        .with_context(|| format!("open {} to retire legacy tables", db_path.display()))?;
    conn.busy_timeout(std::time::Duration::from_secs(5))?;
    let tx = conn.transaction()?;
    for table in tables {
        let mut target = format!("_legacy_{table}");
        let mut n = 1;
        while table_exists(&tx, &target)? {
            n += 1;
            target = format!("_legacy_{table}_{n}");
        }
        tx.execute_batch(&format!("ALTER TABLE \"{table}\" RENAME TO \"{target}\""))
            .with_context(|| format!("rename {table} to {target}"))?;
    }
    tx.commit()?;
    Ok(())
}

#[cfg(test)]
#[path = "local_tests.rs"]
mod tests;
