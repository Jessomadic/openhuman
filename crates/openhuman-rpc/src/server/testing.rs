//! Test-only helpers shared by the JSON-RPC test modules.

use std::ffi::OsString;
use std::sync::{Mutex, MutexGuard};

/// Serializes the environment mutations this crate's tests make. Core's own
/// test lock is private to core's test binary, which is a separate process.
static TEST_ENV_LOCK: Mutex<()> = Mutex::new(());

pub(crate) struct EnvVarGuard {
    old_values: Vec<(&'static str, Option<OsString>)>,
    _lock: MutexGuard<'static, ()>,
}

impl EnvVarGuard {
    pub(crate) fn set_many(vars: Vec<(&'static str, OsString)>) -> Self {
        let lock = TEST_ENV_LOCK.lock().expect("test env lock poisoned");
        let mut old_values = Vec::with_capacity(vars.len());
        for (key, value) in vars {
            let old = std::env::var_os(key);
            std::env::set_var(key, value);
            old_values.push((key, old));
        }
        Self {
            old_values,
            _lock: lock,
        }
    }
}

impl Drop for EnvVarGuard {
    fn drop(&mut self) {
        for (key, old) in self.old_values.iter().rev() {
            match old {
                Some(value) => std::env::set_var(key, value),
                None => std::env::remove_var(key),
            }
        }
    }
}
