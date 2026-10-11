//! Global hotkey listener.
//!
//! The rdev-based listener, the key-name table, `ActivationMode`,
//! `HotkeyEvent`, `HotkeyCombination`, `parse_hotkey` and `start_listener` live
//! in the `tinyvoice` library (`tinyvoice::hotkey`, behind its `hotkey`
//! feature). This module keeps the `crate::voice::hotkey` path stable for the
//! dictation server and CLI.

pub use tinyvoice::hotkey::*;
