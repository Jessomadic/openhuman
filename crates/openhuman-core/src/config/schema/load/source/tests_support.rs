//! Test seam: force the document source for the current thread without
//! installing a process-wide backend that every other test would see.
use crate::storage::ScopedStorage;
use std::cell::RefCell;

thread_local! {
    static FORCED: RefCell<Option<(ScopedStorage, String)>> = const { RefCell::new(None) };
}

pub(crate) fn forced_document_scope() -> Option<(ScopedStorage, String)> {
    FORCED.with(|forced| forced.borrow().clone())
}

/// Forces the document source on this thread until the guard drops.
pub(crate) struct ForcedDocumentSource;

impl ForcedDocumentSource {
    pub(crate) fn new(scoped: ScopedStorage, scope: &str) -> Self {
        FORCED.with(|forced| *forced.borrow_mut() = Some((scoped, scope.to_string())));
        Self
    }
}

impl Drop for ForcedDocumentSource {
    fn drop(&mut self) {
        FORCED.with(|forced| *forced.borrow_mut() = None);
    }
}
