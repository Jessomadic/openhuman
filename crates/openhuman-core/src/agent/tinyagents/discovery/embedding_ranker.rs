//! Host wiring for the harness `EmbeddingToolRanker`: adapt the process's
//! `EmbeddingProvider` onto the vendor `EmbeddingModel` and decide whether the
//! provider can embed at all. The ranker itself (cosine ranking, the in-memory
//! and on-disk catalogue cache) lives in `tinyagents-harness`
//! (`tool::discover::EmbeddingToolRanker`).

use std::sync::Arc;

use async_trait::async_trait;
use tinyagents_harness::tool::discover::EmbeddingToolRanker;
use tinyinference_embeddings::{EmbeddingModel, Error as EmbedError, Result as EmbedResult};

use crate::inference::embedding_host::EmbeddingProvider;

/// A provider viewed as an `EmbeddingModel`, with no side effects.
///
/// Deliberately not [`ProviderEmbeddingModel`](crate::agent::tinyagents::embeddings):
/// that adapter records embedding cost per call, and catalogue ranking has never
/// been metered.
struct RankerEmbeddingModel(Arc<dyn EmbeddingProvider>);

#[async_trait]
impl EmbeddingModel for RankerEmbeddingModel {
    fn name(&self) -> &str {
        self.0.name()
    }

    fn model_id(&self) -> &str {
        self.0.model_id()
    }

    fn dimensions(&self) -> usize {
        self.0.dimensions()
    }

    async fn embed(&self, texts: &[String]) -> EmbedResult<Vec<Vec<f32>>> {
        let borrowed: Vec<&str> = texts.iter().map(String::as_str).collect();
        self.0
            .embed(&borrowed)
            .await
            .map_err(|error| EmbedError::Embedding(format!("{error:#}")))
    }
}

/// A ranker over `provider` with an in-memory cache; chain
/// `.with_disk_cache(path)` to persist it. The cache is keyed by the provider's
/// embedding-space signature, so a model change invalidates it.
pub fn embedding_tool_ranker(provider: Arc<dyn EmbeddingProvider>) -> EmbeddingToolRanker {
    let signature = provider.signature();
    EmbeddingToolRanker::new(Arc::new(RankerEmbeddingModel(provider)), signature)
}

/// Whether `provider` can embed at all. The `none` provider embeds nothing and
/// would rank everything at zero.
pub fn embedding_provider_is_usable(provider: &dyn EmbeddingProvider) -> bool {
    provider.dimensions() > 0 && provider.name() != "none"
}

#[cfg(test)]
#[path = "embedding_ranker_tests.rs"]
mod tests;
