//! Raw microphone capture for the always-on loop.
//!
//! The `cpal` stream, its realtime callback and the bounded-queue forwarding
//! live in `tinyvoice::capture`. This file supplies the host's part: the
//! microphone-permission policy. Downmixing and resampling live in the
//! processor, not in the callback.

use super::LOG_PREFIX;

pub(super) use tinyvoice::capture::{CaptureFormat, RawChunk};

/// Spawn the dedicated cpal capture thread. Blocks until the stream is set up
/// (or fails), mirroring `audio_capture::start_recording`'s readiness handshake.
pub(super) fn spawn_capture_thread(
    tx: tokio::sync::mpsc::Sender<RawChunk>,
) -> Result<CaptureFormat, String> {
    tinyvoice::capture::spawn_capture_thread(tx, microphone_permission).map_err(|e| e.to_string())
}

/// Surface the mic permission state explicitly — a denied/Unknown state is the
/// most common reason always-on "does nothing" and it differs per OS (macOS TCC
/// prompt, Windows privacy settings), so log it on every test build. Only a
/// denied state stops capture.
fn microphone_permission() -> Result<(), String> {
    use tinycomputer_accessibility::{detect_microphone_permission, PermissionState};

    let permission = detect_microphone_permission();
    log::info!("{LOG_PREFIX} microphone permission: {permission:?}");
    if matches!(permission, PermissionState::Denied) {
        log::warn!("{LOG_PREFIX} microphone permission denied — always-on cannot capture audio");
        return Err("microphone permission denied".to_string());
    }
    Ok(())
}
