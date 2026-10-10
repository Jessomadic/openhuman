//! Where a config's TOML text lives: the [`ConfigSource`] port.
//!
//! The loader and `Config::save` work on TOML *text*; this port is the only
//! thing that knows where that text is kept, so the codec, the migrations, the
//! secret encryption and the corruption recovery are one code path for every
//! deployment.
//!
//! | Source | Where | Used |
//! | --- | --- | --- |
//! | [`FileConfigSource`] | `config.toml`, replaced atomically (`atomic_commit`) with a `.bak` | desktop, CLI, and always at boot |
//! | [`DocumentConfigSource`] | the `config/{scope}` document on the storage backend | a shared (multi-tenant) backend, for saves and snapshot reloads |
//!
//! # Bootstrap config never comes from storage
//!
//! The `[storage]` table decides which backend exists, so it cannot be read
//! from one (and its URL can carry a database password). [`BOOTSTRAP_TABLES`]
//! are therefore stripped before a document is written and re-applied from the
//! file on every document read. The first load of a process (`load_or_init`)
//! always reads the file: it runs before any backend is installed.
//!
//! # Why text, not a JSON tree
//!
//! A document holds the TOML body as one string field. That is lossless
//! (a JSON tree would not round-trip every TOML value), keeps one parser, and
//! keeps the file hand-editable on desktop. The desktop file source keeps
//! `atomic_commit` and its `.bak`, `0600` and fsync guarantees, which the file
//! driver's blob API does not offer.

mod document;
mod file;

use anyhow::Result;
use async_trait::async_trait;
use std::path::Path;

pub(crate) use document::DocumentConfigSource;
pub(crate) use file::FileConfigSource;

/// Top-level TOML tables that are bootstrap configuration: always read from
/// the file or environment, never stored in (or read from) a storage backend.
pub(crate) const BOOTSTRAP_TABLES: &[&str] = &["storage"];

/// What a source read returned.
#[derive(Debug, Clone, PartialEq, Eq)]
pub(crate) struct ConfigRead {
    /// The TOML text. Empty when the content was unreadable and recovery found
    /// nothing (the caller then falls back to defaults).
    pub contents: String,
    /// The source recovered from corruption (a `.bak`, or defaults).
    pub recovered: bool,
}

/// A place a config's TOML text is read from and written to.
#[async_trait]
pub(crate) trait ConfigSource: Send + Sync {
    /// A short, stable name for logs: `file` or `document`.
    fn label(&self) -> &'static str;

    /// Whether the source holds a config at all.
    async fn exists(&self) -> bool;

    /// Read the config text, recovering from corruption where the source can.
    async fn read(&self) -> Result<ConfigRead>;

    /// Replace the config text. Returns `Err` only while the previous config is
    /// still the live one, so callers may roll back in-memory state on `Err`.
    async fn write(&self, toml: &str) -> Result<()>;
}

/// The source for the config at `config_path`.
///
/// The document source when the host installed a shared (multi-tenant)
/// backend and the current scope resolves; the file otherwise, which includes
/// every desktop build and SaaS calls with no resolvable scope.
pub(crate) fn for_config(config_path: &Path) -> Box<dyn ConfigSource> {
    let file = FileConfigSource::new(config_path);
    #[cfg(test)]
    if let Some((scoped, scope)) = tests_support::forced_document_scope() {
        return Box::new(DocumentConfigSource::new(
            std::sync::Arc::clone(scoped.documents()),
            scope,
            file,
        ));
    }
    if !crate::storage::installed_is_shared() {
        return Box::new(file);
    }
    match crate::storage::current_scoped().and_then(|scoped| {
        let scope = crate::storage::current_scope()?;
        Ok(scoped.map(|scoped| (scoped, scope)))
    }) {
        Ok(Some((scoped, scope))) => Box::new(DocumentConfigSource::new(
            std::sync::Arc::clone(scoped.documents()),
            scope.as_str().to_string(),
            file,
        )),
        Ok(None) => Box::new(file),
        Err(error) => {
            tracing::debug!(
                error = %error,
                "[config] no storage scope for the config document; using the file"
            );
            Box::new(file)
        }
    }
}

/// `toml` without its [`BOOTSTRAP_TABLES`].
pub(crate) fn strip_bootstrap(toml_text: &str) -> Result<String> {
    let mut table: toml::Table = toml::from_str(toml_text)?;
    for name in BOOTSTRAP_TABLES {
        table.remove(*name);
    }
    Ok(toml::to_string_pretty(&table)?)
}

/// `stored` with its bootstrap tables replaced by those of `bootstrap_text`
/// (the file's), or removed when the file has none.
pub(crate) fn apply_bootstrap(stored: &str, bootstrap_text: Option<&str>) -> Result<String> {
    let mut table: toml::Table = toml::from_str(stored)?;
    let bootstrap: toml::Table = bootstrap_text
        .and_then(|text| toml::from_str(text).ok())
        .unwrap_or_default();
    for name in BOOTSTRAP_TABLES {
        table.remove(*name);
        if let Some(value) = bootstrap.get(*name) {
            table.insert((*name).to_string(), value.clone());
        }
    }
    Ok(toml::to_string_pretty(&table)?)
}

#[cfg(test)]
pub(crate) mod tests_support;

#[cfg(test)]
#[path = "mod_tests.rs"]
mod tests;
