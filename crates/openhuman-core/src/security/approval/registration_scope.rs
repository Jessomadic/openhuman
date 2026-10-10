//! Serializes an agent instance's approval registration and decisions with removal.

use std::sync::Mutex;

/// An instance-owned barrier; reusing an agent ID requires a fresh scope.
#[derive(Debug, Default)]
pub struct ApprovalScope {
    closed: Mutex<Option<String>>,
}

impl ApprovalScope {
    /// Stop registration and decisions; wait for accepted work to finish.
    /// The first teardown reason remains authoritative.
    pub fn close(&self, reason: &str) {
        let mut closed = self
            .closed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if closed.is_none() {
            *closed = Some(reason.to_owned());
        }
    }

    /// Whether removal has closed this instance's registration and decision barrier.
    pub fn is_closed(&self) -> bool {
        self.closed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .is_some()
    }

    /// Run synchronous registration or a decision while holding the removal barrier.
    pub(crate) fn with_open<T>(&self, register: impl FnOnce() -> T) -> Result<T, String> {
        let closed = self
            .closed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(reason) = closed.as_ref() {
            return Err(reason.clone());
        }
        // Keep the barrier through persistence and approval event/waiter publication.
        // No asynchronous work or user callbacks run in this critical section.
        Ok(register())
    }
}

#[cfg(test)]
#[path = "registration_scope_tests.rs"]
mod tests;
