//! Desktop-shell-facing surfaces.
//!
//! Domains that exist to serve the Tauri desktop client specifically — the
//! things a headless / embedded host has no use for. Grouped so a future
//! `desktop` gate can drop them as one unit.
//!
//! - [`app_state`]         — persisted desktop app state
//! - [`dashboard`]         — dashboard aggregation surface
//! - [`notifications`]     — user-facing notification delivery
//! - [`overlay`]           — the desktop overlay window surface
//! - [`provider_surfaces`] — per-provider UI surface descriptors
//!
//! OS accessibility (AX/IOKit FFI, focus, permissions, Globe key) lives in the
//! `tinycomputer-accessibility` library crate (`vendor/tinycomputer`), linked
//! directly by the `voice` family; its `cpal` microphone probe rides the
//! `inference` gate. Not yet gated: the modules below are ungated. See
//! `docs/specs/2026-08-02-core-kernel-domain-reorg.md`.

pub mod app_state;
#[cfg(feature = "modules")]
pub mod control;
pub mod dashboard;
pub mod notifications;
pub mod overlay;
pub mod provider_surfaces;
