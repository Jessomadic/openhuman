//! Microphone audio capture.
//!
//! Records audio from the default input device and produces 16-kHz mono WAV
//! bytes suitable for STT transcription. The `cpal` device flow lives in
//! `tinyvoice::capture`; this file supplies the host's microphone-permission
//! policy and, on stop, runs the raw samples through the `tinyvoice` module
//! (downmix, resample, silence gate, WAV framing).

use log::{debug, info, warn};

use crate::config::Config;

const LOG_PREFIX: &str = "[voice_capture]";

/// Target sample rate for STT (16 kHz mono).
pub(crate) const TARGET_SAMPLE_RATE: u32 = tinyvoice::capture::TARGET_SAMPLE_RATE;

/// Samples per measurement frame — 20 ms at [`TARGET_SAMPLE_RATE`].
///
/// Matches the always-on loop's framing so a "peak RMS" means the same thing
/// in both paths; a different window would make the same audio report a
/// different peak depending on which recorder captured it.
const FRAME_SAMPLES: u32 = TARGET_SAMPLE_RATE / 50;

/// RMS below which the module's silence gate drops audio.
///
/// The value the in-process gate used before this moved to the module.
const SILENCE_GATE_THRESHOLD: f32 = 0.002;

/// Result of a completed recording.
#[derive(Debug, Clone)]
pub struct RecordingResult {
    /// WAV-encoded audio bytes (16 kHz, mono, 16-bit PCM).
    pub wav_bytes: Vec<u8>,
    /// Duration of the recording in seconds.
    pub duration_secs: f32,
    /// Number of samples captured.
    pub sample_count: usize,
    /// Peak RMS energy observed during recording.
    /// Used for silence detection — values below ~0.002 indicate no speech.
    pub peak_rms: f32,
}

/// Handle to a recording in progress. Call `stop()` to end recording.
pub struct RecordingHandle {
    /// The device recording; `None` only for a handle built by a test.
    inner: Option<tinyvoice::capture::RecordingHandle>,
    /// A finished result to hand back instead of preparing one.
    ///
    /// Test-only. `stop` now ends in module calls, so a test that wants to
    /// exercise what the *pipeline* does with a result — the short-audio and
    /// silence gates in `server` — would otherwise have to stand up a module
    /// to assert something that has nothing to do with audio.
    #[cfg(test)]
    finalized: Option<Result<RecordingResult, String>>,
}

/// What the capture thread produces: the device's own samples, untouched.
///
/// The thread does no signal processing at all: it converts the sample
/// format and accumulates. Downmixing, resampling, silence gating and WAV
/// framing all happen in [`RecordingHandle::stop`], through the `tinyvoice`
/// module, off the audio thread.
pub use tinyvoice::capture::RawRecording;

impl RecordingHandle {
    /// Signal the recording to stop, then turn the raw capture into a result.
    ///
    /// Takes `config` because everything after "stop the stream" is a module
    /// call: downmix, resample, silence-gate and frame the audio. Doing that
    /// here rather than on the capture thread is what keeps the audio callback
    /// free of signal processing.
    ///
    /// # Errors
    ///
    /// The capture error if the recording itself failed, or the module error if
    /// the audio cannot be prepared. Both are strings the caller surfaces.
    pub async fn stop(mut self, config: &Config) -> Result<RecordingResult, String> {
        #[cfg(test)]
        if let Some(finalized) = self.finalized.take() {
            return finalized;
        }

        let Some(inner) = self.inner.take() else {
            return Err("recording already stopped".to_string());
        };
        let raw = inner.stop().await.map_err(|e| e.to_string())?;
        finalize(config, &raw).await
    }

    /// A handle whose `stop` yields `result` without touching audio or the bus.
    #[cfg(test)]
    pub(crate) fn from_test_result(result: Result<RecordingResult, String>) -> Self {
        Self {
            inner: None,
            finalized: Some(result),
        }
    }
}

/// Turn a raw capture into a WAV plus the metrics the caller gates on.
///
/// Three module calls rather than one, because the caller needs two different
/// views of the same audio: the peak energy is measured on the *ungated*
/// samples — silence detection has to see the silence — while the WAV is the
/// gated version, which is what the STT engine should be billed for.
async fn finalize(config: &Config, raw: &RawRecording) -> Result<RecordingResult, String> {
    use crate::modules::voice as tinyvoice;

    let channels = u16::try_from(raw.channels)
        .map_err(|_| format!("implausible channel count: {}", raw.channels))?;

    // Ungated 16 kHz mono, for the energy measurement.
    let mono = tinyvoice::prepare_frames(config, &raw.samples, raw.source_rate, channels)
        .await
        .map_err(|e| format!("could not prepare captured audio: {e}"))?;

    // One frame's worth per measurement, matching the always-on loop's framing.
    let peak_rms = tinyvoice::frame_energies(config, &mono, FRAME_SAMPLES)
        .await
        .map_err(|e| format!("could not measure captured audio: {e}"))?
        .into_iter()
        .fold(0.0f32, f32::max);

    // Gated, framed as WAV — what actually gets uploaded.
    let wav_bytes = tinyvoice::prepare_capture(
        config,
        &raw.samples,
        raw.source_rate,
        channels,
        SILENCE_GATE_THRESHOLD,
    )
    .await
    .map_err(|e| format!("could not encode captured audio: {e}"))?;

    // Derived from the WAV that is actually returned, not from `mono`.
    //
    // `mono` is the UNGATED buffer — it exists to measure peak energy, which
    // has to see the silence. `wav_bytes` is the gated one. Reporting `mono`'s
    // length here would describe audio the caller does not have: `server.rs`
    // gates on `duration_secs` against `min_duration_secs`, so a recording that
    // is mostly silence would claim a long duration and pass a check it should
    // fail. Before the gate moved to the module it ran in the capture callback,
    // so the buffer this was derived from was already gated and the two agreed.
    //
    // 16-bit mono PCM after a 44-byte header, so two bytes per sample.
    let sample_count = wav_bytes.len().saturating_sub(44) / 2;
    let duration_secs = sample_count as f32 / TARGET_SAMPLE_RATE as f32;
    info!(
        "{LOG_PREFIX} recording finalized: {duration_secs:.1}s, {} bytes WAV, peak_rms={peak_rms:.6}",
        wav_bytes.len()
    );

    Ok(RecordingResult {
        wav_bytes,
        duration_secs,
        sample_count,
        peak_rms,
    })
}

/// Start recording from the default microphone.
///
/// Returns a `RecordingHandle` that must be `.stop().await`-ed to get
/// the captured audio. Recording runs on a dedicated OS thread inside
/// `tinyvoice::capture` because `cpal::Stream` is `!Send` (it must be created
/// and dropped on the same thread).
pub fn start_recording() -> Result<RecordingHandle, String> {
    Ok(RecordingHandle {
        inner: Some(
            tinyvoice::capture::start_recording(microphone_permission)
                .map_err(|e| e.to_string())?,
        ),
        #[cfg(test)]
        finalized: None,
    })
}

/// List available input devices.
pub fn list_input_devices() -> Result<Vec<String>, String> {
    tinyvoice::capture::list_input_devices().map_err(|e| e.to_string())
}

/// The host's microphone-permission policy for a one-shot recording.
///
/// Cross-platform pre-check: an undetermined state asks the OS for access (macOS
/// may show a prompt) and re-checks; a denied state, or one still undetermined
/// after asking, fails with the platform's explanation.
fn microphone_permission() -> Result<(), String> {
    use tinycomputer_accessibility::{
        detect_microphone_permission, microphone_denied_message, request_microphone_access,
        PermissionState,
    };

    let mic_perm = detect_microphone_permission();
    debug!("{LOG_PREFIX} microphone permission state: {mic_perm:?}");

    match mic_perm {
        PermissionState::Unknown => {
            info!("{LOG_PREFIX} microphone permission not yet determined — requesting access");
            request_microphone_access();
            // Re-check after request (macOS may have shown a prompt).
            let updated = detect_microphone_permission();
            debug!("{LOG_PREFIX} microphone permission after request: {updated:?}");
            if matches!(updated, PermissionState::Denied | PermissionState::Unknown) {
                let msg = microphone_denied_message();
                warn!("{LOG_PREFIX} {msg}");
                return Err(msg);
            }
        }
        PermissionState::Denied => {
            let msg = microphone_denied_message();
            warn!("{LOG_PREFIX} {msg}");
            return Err(msg);
        }
        _ => {} // Granted or Unsupported — proceed normally.
    }
    Ok(())
}
