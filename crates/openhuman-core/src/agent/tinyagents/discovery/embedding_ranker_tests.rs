use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::Arc;

use tinytools::{RankCandidate, RankContext, ToolRanker};

use super::*;

/// Counts embed calls and maps every text to a fixed three-word bag.
struct BagEmbedder {
    calls: AtomicUsize,
}

#[async_trait::async_trait]
impl EmbeddingProvider for BagEmbedder {
    fn name(&self) -> &str {
        "bag"
    }
    fn model_id(&self) -> &str {
        "bag-v1"
    }
    fn dimensions(&self) -> usize {
        3
    }
    fn signature(&self) -> String {
        "provider=bag;model=bag-v1;dims=3".into()
    }
    async fn embed(&self, texts: &[&str]) -> anyhow::Result<Vec<Vec<f32>>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        Ok(texts
            .iter()
            .map(|t| {
                let t = t.to_ascii_lowercase();
                vec![
                    f32::from(u8::from(t.contains("message") || t.contains("ping"))),
                    f32::from(u8::from(t.contains("email") || t.contains("mail"))),
                    f32::from(u8::from(t.contains("file"))),
                ]
            })
            .collect())
    }
}

fn candidates() -> Vec<RankCandidate> {
    vec![
        RankCandidate::new("SLACK_SEND_MESSAGE", "send a message to a channel")
            .with_family("slack"),
        RankCandidate::new("GMAIL_SEND_EMAIL", "send an email").with_family("gmail"),
        RankCandidate::new("file_read", "read a file"),
    ]
}

/// The provider adapter carries the embedding through to the vendor ranker, and
/// the provider's signature keys the disk cache it writes.
#[tokio::test]
async fn the_ranker_ranks_through_the_provider_and_keys_its_cache_by_signature() {
    let tmp = tempfile::tempdir().unwrap();
    let path = tmp.path().join("cache.json");
    let embedder = Arc::new(BagEmbedder {
        calls: AtomicUsize::new(0),
    });
    let ranker = embedding_tool_ranker(embedder.clone()).with_disk_cache(path.clone());
    let hits = ranker
        .rank("ping alex", &RankContext::empty(), &candidates(), 1)
        .await
        .unwrap();
    assert_eq!(hits[0].key, "SLACK_SEND_MESSAGE");
    let on_disk: serde_json::Value =
        serde_json::from_slice(&std::fs::read(&path).unwrap()).unwrap();
    assert_eq!(on_disk["signature"], "provider=bag;model=bag-v1;dims=3");
}

#[test]
fn the_none_provider_is_unusable() {
    let none = crate::inference::embedding_host::TinyInferenceEmbeddingProvider::new(
        tinyinference_embeddings::NoopEmbeddingModel,
    );
    assert!(!embedding_provider_is_usable(&none));
    let bag = BagEmbedder {
        calls: AtomicUsize::new(0),
    };
    assert!(embedding_provider_is_usable(&bag));
}
