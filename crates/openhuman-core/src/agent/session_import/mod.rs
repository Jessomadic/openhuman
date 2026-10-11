//! Host side of the legacy-session import into TinyAgents stores.
//!
//! The importer, the live dual-write and the shadow read now live in
//! `tinyagents_session::transcript::import` (scan, convert, ops, live). What
//! stays here is OpenHuman policy: the `openhuman.session_import_run`
//! controller ([`schemas`]), the config flag + kill-switch decisions and the
//! `RunContext.stores` registration ([`live`]), and the [`projector`] that
//! folds host message metadata into journal records.

pub mod live;
pub mod projector;
mod schemas;

pub use schemas::{
    all_session_import_controller_schemas, all_session_import_registered_controllers,
};

#[cfg(test)]
mod live_tests;
