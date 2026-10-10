//! [`FencedBackend`]: a storage backend whose writes pass the lease fence.
//!
//! Wraps any backend. Every scope it hands out is the inner backend's, with
//! the document, stream and blob handles wrapped so that each write first
//! asks the [`FenceRegistry`] for the scope's fence and runs only if that
//! fence passes ([`FenceRegistry::guard`]). Reads, `ensure_collection`
//! (idempotent schema) and scopes with no fence go straight through.
//!
//! The fence is looked up per write, not when the scope is bound, because
//! long-lived consumers (the session store caches its per-agent handles)
//! must follow the profile as it is opened, fenced and re-opened.
//!
//! See [`super::fence`] for what the check does and does not guarantee.

use std::ops::Range;
use std::sync::Arc;

use async_trait::async_trait;
use serde_json::Value;
use tinystoragedrivers::{
    Blob, BlobMeta, BlobStore, Capabilities, CollectionSpec, Filter, Page, Precondition, Query,
    Result, SearchHit, Sort, StreamEntry, StreamStore, Version, Versioned, WriteOp, WriteResult,
};

use super::fence::FenceRegistry;
use super::{DocumentStore, Scope, ScopedStorage, StorageBackend};

/// A backend whose writes are fenced. See the module docs.
pub struct FencedBackend {
    inner: Arc<dyn StorageBackend>,
    fences: Arc<FenceRegistry>,
}

impl std::fmt::Debug for FencedBackend {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FencedBackend")
            .field("inner", &self.inner)
            .finish_non_exhaustive()
    }
}

impl FencedBackend {
    /// `inner`, its writes checked against `fences`.
    pub fn new(inner: Arc<dyn StorageBackend>, fences: Arc<FenceRegistry>) -> Self {
        Self { inner, fences }
    }
}

/// `inner` fenced by the process's registry ([`super::fence::registry`]).
pub fn wrap(inner: Arc<dyn StorageBackend>) -> Arc<dyn StorageBackend> {
    Arc::new(FencedBackend::new(inner, super::fence::registry()))
}

impl StorageBackend for FencedBackend {
    fn driver(&self) -> &'static str {
        self.inner.driver()
    }

    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }

    fn for_scope(&self, scope: &Scope) -> Result<ScopedStorage> {
        let scoped = self.inner.for_scope(scope)?;
        let guard = Guard {
            scope: scope.as_str().to_string(),
            fences: Arc::clone(&self.fences),
        };
        Ok(ScopedStorage::new(
            scope.clone(),
            scoped.driver(),
            Arc::new(FencedDocuments {
                inner: Arc::clone(scoped.documents()),
                guard: guard.clone(),
            }),
            Arc::new(FencedStreams {
                inner: Arc::clone(scoped.streams()),
                guard: guard.clone(),
            }),
            Arc::new(FencedBlobs {
                inner: Arc::clone(scoped.blobs()),
                guard,
            }),
        ))
    }

    fn database(&self, name: &str) -> Result<Arc<dyn StorageBackend>> {
        Ok(Arc::new(Self::new(
            self.inner.database(name)?,
            Arc::clone(&self.fences),
        )))
    }
}

#[derive(Clone)]
struct Guard {
    scope: String,
    fences: Arc<FenceRegistry>,
}

impl Guard {
    async fn check(&self, op: &'static str) -> Result<()> {
        self.fences.guard(&self.scope, op).await
    }
}

struct FencedDocuments {
    inner: Arc<dyn DocumentStore>,
    guard: Guard,
}

impl std::fmt::Debug for FencedDocuments {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FencedDocuments")
            .field("inner", &self.inner)
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl DocumentStore for FencedDocuments {
    fn capabilities(&self) -> Capabilities {
        self.inner.capabilities()
    }

    async fn ensure_collection(&self, spec: &CollectionSpec) -> Result<()> {
        self.inner.ensure_collection(spec).await
    }

    async fn get(&self, collection: &str, id: &str) -> Result<Option<Versioned<Value>>> {
        self.inner.get(collection, id).await
    }

    async fn put(
        &self,
        collection: &str,
        id: &str,
        doc: Value,
        precondition: Precondition,
    ) -> Result<Version> {
        self.guard.check("documents.put").await?;
        self.inner.put(collection, id, doc, precondition).await
    }

    async fn delete(&self, collection: &str, id: &str, precondition: Precondition) -> Result<bool> {
        self.guard.check("documents.delete").await?;
        self.inner.delete(collection, id, precondition).await
    }

    async fn query(&self, collection: &str, query: &Query) -> Result<Page<Versioned<Value>>> {
        self.inner.query(collection, query).await
    }

    async fn count(&self, collection: &str, filter: &Filter) -> Result<u64> {
        self.inner.count(collection, filter).await
    }

    async fn delete_where(&self, collection: &str, filter: &Filter) -> Result<u64> {
        self.guard.check("documents.delete_where").await?;
        self.inner.delete_where(collection, filter).await
    }

    async fn claim(
        &self,
        collection: &str,
        filter: &Filter,
        sort: &[Sort],
        patch: &Value,
    ) -> Result<Option<Versioned<Value>>> {
        self.guard.check("documents.claim").await?;
        self.inner.claim(collection, filter, sort, patch).await
    }

    async fn atomic_batch(&self, ops: Vec<WriteOp>) -> Result<Vec<WriteResult>> {
        self.guard.check("documents.atomic_batch").await?;
        self.inner.atomic_batch(ops).await
    }

    async fn search(&self, collection: &str, text: &str, limit: usize) -> Result<Vec<SearchHit>> {
        self.inner.search(collection, text, limit).await
    }

    async fn drop_collection(&self, collection: &str) -> Result<()> {
        self.guard.check("documents.drop_collection").await?;
        self.inner.drop_collection(collection).await
    }
}

struct FencedStreams {
    inner: Arc<dyn StreamStore>,
    guard: Guard,
}

impl std::fmt::Debug for FencedStreams {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FencedStreams")
            .field("inner", &self.inner)
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl StreamStore for FencedStreams {
    async fn append(&self, stream: &str, value: Value) -> Result<u64> {
        self.guard.check("streams.append").await?;
        self.inner.append(stream, value).await
    }

    async fn append_batch(&self, stream: &str, values: Vec<Value>) -> Result<u64> {
        self.guard.check("streams.append_batch").await?;
        self.inner.append_batch(stream, values).await
    }

    async fn read_window(&self, stream: &str, from: u64, limit: usize) -> Result<Vec<StreamEntry>> {
        self.inner.read_window(stream, from, limit).await
    }

    async fn len(&self, stream: &str) -> Result<u64> {
        self.inner.len(stream).await
    }

    async fn truncate_before(&self, stream: &str, offset: u64) -> Result<u64> {
        self.guard.check("streams.truncate_before").await?;
        self.inner.truncate_before(stream, offset).await
    }

    async fn delete_stream(&self, stream: &str) -> Result<bool> {
        self.guard.check("streams.delete_stream").await?;
        self.inner.delete_stream(stream).await
    }

    async fn streams(&self, prefix: &str) -> Result<Vec<String>> {
        self.inner.streams(prefix).await
    }
}

struct FencedBlobs {
    inner: Arc<dyn BlobStore>,
    guard: Guard,
}

impl std::fmt::Debug for FencedBlobs {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        f.debug_struct("FencedBlobs")
            .field("inner", &self.inner)
            .finish_non_exhaustive()
    }
}

#[async_trait]
impl BlobStore for FencedBlobs {
    async fn put(&self, key: &str, bytes: Vec<u8>, content_type: Option<&str>) -> Result<BlobMeta> {
        self.guard.check("blobs.put").await?;
        self.inner.put(key, bytes, content_type).await
    }

    async fn get(&self, key: &str) -> Result<Option<Blob>> {
        self.inner.get(key).await
    }

    async fn get_range(&self, key: &str, range: Range<u64>) -> Result<Option<Vec<u8>>> {
        self.inner.get_range(key, range).await
    }

    async fn head(&self, key: &str) -> Result<Option<BlobMeta>> {
        self.inner.head(key).await
    }

    async fn delete(&self, key: &str) -> Result<bool> {
        self.guard.check("blobs.delete").await?;
        self.inner.delete(key).await
    }

    async fn list(&self, prefix: &str) -> Result<Vec<BlobMeta>> {
        self.inner.list(prefix).await
    }
}

#[cfg(test)]
#[path = "fenced_backend_tests.rs"]
mod tests;
