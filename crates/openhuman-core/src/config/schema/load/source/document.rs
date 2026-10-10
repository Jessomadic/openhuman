//! [`DocumentConfigSource`]: the config as the `config/{scope}` document.

use std::sync::Arc;

use anyhow::{Context, Result};
use async_trait::async_trait;
use serde_json::json;
use tinystoragedrivers::{CollectionSpec, DocumentStore, Precondition};

use super::{apply_bootstrap, strip_bootstrap, ConfigRead, ConfigSource, FileConfigSource};

/// The collection holding one config document per scope.
pub(crate) const CONFIG_COLLECTION: &str = "config";

/// The document field holding the TOML body.
const BODY_FIELD: &str = "toml";

/// A config kept as one document, `config/{scope}`, on the storage backend.
///
/// The document body is the TOML text without its bootstrap tables
/// ([`super::BOOTSTRAP_TABLES`]); reads re-apply those from the `file`
/// fallback. When the scope has no document yet, reads fall back to the file
/// (a first run seeds from the bootstrap file), and the next write creates it.
pub(crate) struct DocumentConfigSource {
    docs: Arc<dyn DocumentStore>,
    scope: String,
    file: FileConfigSource,
}

impl DocumentConfigSource {
    pub(crate) fn new(docs: Arc<dyn DocumentStore>, scope: String, file: FileConfigSource) -> Self {
        Self { docs, scope, file }
    }

    async fn stored_body(&self) -> Result<Option<String>> {
        self.docs
            .ensure_collection(&CollectionSpec::new(CONFIG_COLLECTION))
            .await
            .context("declare the config collection")?;
        let stored = self
            .docs
            .get(CONFIG_COLLECTION, &self.scope)
            .await
            .context("read the config document")?;
        Ok(stored.and_then(|versioned| {
            versioned
                .doc
                .get(BODY_FIELD)
                .and_then(|body| body.as_str())
                .map(str::to_string)
        }))
    }
}

#[async_trait]
impl ConfigSource for DocumentConfigSource {
    fn label(&self) -> &'static str {
        "document"
    }

    async fn exists(&self) -> bool {
        match self.stored_body().await {
            Ok(Some(_)) => true,
            _ => self.file.exists().await,
        }
    }

    async fn read(&self) -> Result<ConfigRead> {
        let Some(body) = self.stored_body().await? else {
            tracing::debug!(scope = %self.scope, "[config] no config document; reading the file");
            return self.file.read().await;
        };
        // Bootstrap tables come from the file, whatever the document says.
        let file_text = tokio::fs::read_to_string(self.file.path()).await.ok();
        match apply_bootstrap(&body, file_text.as_deref()) {
            Ok(contents) => Ok(ConfigRead {
                contents,
                recovered: false,
            }),
            Err(error) => {
                // A body that does not parse is handed to the loader as-is so
                // its parse recovery (defaults, loud log) applies as it does to
                // a corrupt file; the document is not rewritten here.
                tracing::warn!(scope = %self.scope, error = %error, "[config] config document is not valid TOML");
                Ok(ConfigRead {
                    contents: body,
                    recovered: false,
                })
            }
        }
    }

    async fn write(&self, toml: &str) -> Result<()> {
        let body = strip_bootstrap(toml).context("strip bootstrap tables from the config")?;
        self.docs
            .ensure_collection(&CollectionSpec::new(CONFIG_COLLECTION))
            .await
            .context("declare the config collection")?;
        self.docs
            .put(
                CONFIG_COLLECTION,
                &self.scope,
                json!({ BODY_FIELD: body }),
                Precondition::None,
            )
            .await
            .context("write the config document")?;
        tracing::debug!(scope = %self.scope, "[config] wrote the config document");
        Ok(())
    }
}
