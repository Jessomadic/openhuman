//! Serializes an agent instance's approval registration with its removal.

use std::sync::Mutex;

/// An instance-owned barrier; reusing an agent ID requires a fresh scope.
#[derive(Default)]
pub struct ApprovalScope {
    closed: Mutex<Option<String>>,
}

impl ApprovalScope {
    /// Stop registration and wait for any accepted registration to finish.
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

    pub(crate) fn register<T>(&self, register: impl FnOnce() -> T) -> Result<T, String> {
        let closed = self
            .closed
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if let Some(reason) = closed.as_ref() {
            return Err(reason.clone());
        }
        // Keep the barrier through persistence and ApprovalRequested publication.
        // No asynchronous work or user callbacks run in this critical section.
        Ok(register())
    }
}

#[cfg(test)]
#[path = "registration_scope_tests.rs"]
mod tests;
