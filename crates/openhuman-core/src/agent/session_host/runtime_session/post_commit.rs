//! The post-commit tail of a session turn.
//!
//! The runtime awaits the whole `after_commit` hook before `run_turn` returns.
//! The web caller publishes `chat_done` only after that return, and it first
//! waits for the progress bridge to see `TurnCompleted`. Every await in this
//! hook therefore sits between the turn's final model call and the user's
//! answer. Production traces showed 2.3–3.9s of untraced time there, about a
//! quarter of a median turn.
//!
//! The hook now does the work in this order:
//!
//! 1. Record the receipt-derived state the caller reads right after
//!    `run_turn` returns (cap flag, usage).
//! 2. Publish `TurnCompleted`. It is the progress bridge's drain fence, and
//!    nothing it gates depends on the steps below.
//! 3. Run the cheap, synchronous-ordering steps: the transcript mirror and
//!    memory ingest. Both only take state and spawn.
//! 4. Hand thread-goal accounting to a background task
//!    ([`complete_then_defer`]). The next turn awaits it before it loads the
//!    goal, so goal budgets still see every committed turn in order.
//!
//! Each step is timed under the `[session-runtime] post-commit` log prefix.

use std::future::Future;
use std::time::{Duration, Instant};

use tinyinference_llm::message::Message;

/// How long a new turn waits for the previous turn's deferred post-commit
/// work before it proceeds anyway. Generous: the work is a local goal-store
/// update. The bound only exists so a wedged store cannot wedge the thread.
pub(super) const PENDING_POST_COMMIT_WAIT: Duration = Duration::from_secs(10);

/// Model calls this turn made: `TurnCompleted.iterations` and the post-turn
/// hooks' `iteration_count`.
///
/// The driver's sidecar records the turn's own model calls, including the
/// grounded close and any required-output repair. This used to count every
/// assistant row in the committed history, which is the *whole
/// conversation*. A one-call turn deep into a thread then reported 60+
/// iterations. When the sidecar is empty (a driver that does not fill it),
/// this falls back to the assistant rows after the last user row, which is
/// this turn's exchange. Never reports zero.
pub(super) fn turn_iterations(sidecar_model_calls: usize, history: &[Message]) -> u32 {
    let calls = if sidecar_model_calls > 0 {
        sidecar_model_calls
    } else {
        let start = history
            .iter()
            .rposition(|message| matches!(message, Message::User(_)))
            .map_or(0, |index| index + 1);
        history[start..]
            .iter()
            .filter(|message| matches!(message, Message::Assistant(_)))
            .count()
    };
    calls.clamp(1, u32::MAX as usize) as u32
}

/// Await `publish` (the completion), then spawn `tail` (deferred work) and
/// return its handle. The caller can fence later work on the handle. Returns
/// whether the completion was delivered.
pub(super) async fn complete_then_defer<P, T>(
    publish: P,
    tail: T,
) -> (bool, tokio::task::JoinHandle<()>)
where
    P: Future<Output = bool>,
    T: Future<Output = ()> + Send + 'static,
{
    let started = Instant::now();
    let delivered = publish.await;
    tracing::debug!(
        delivered,
        elapsed_ms = elapsed_ms(started),
        "[session-runtime] post-commit: turn completion published"
    );
    let handle = crate::core::runtime::spawn_scoped(async move {
        let started = Instant::now();
        tail.await;
        tracing::debug!(
            elapsed_ms = elapsed_ms(started),
            "[session-runtime] post-commit: deferred work finished"
        );
    });
    (delivered, handle)
}

/// Await the previous turn's deferred post-commit work, bounded by
/// [`PENDING_POST_COMMIT_WAIT`].
pub(super) async fn await_pending(handle: Option<tokio::task::JoinHandle<()>>) {
    let Some(handle) = handle else {
        return;
    };
    let started = Instant::now();
    match tokio::time::timeout(PENDING_POST_COMMIT_WAIT, handle).await {
        Ok(_) => tracing::debug!(
            waited_ms = elapsed_ms(started),
            "[session-runtime] post-commit: previous turn's deferred work settled before this turn"
        ),
        Err(_) => tracing::warn!(
            waited_ms = elapsed_ms(started),
            "[session-runtime] post-commit: previous turn's deferred work still running; proceeding"
        ),
    }
}

pub(super) fn elapsed_ms(since: Instant) -> u64 {
    since.elapsed().as_millis().min(u128::from(u64::MAX)) as u64
}

#[cfg(test)]
#[path = "post_commit_tests.rs"]
mod tests;
