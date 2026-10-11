//! Explicit logout invalidates channel runtimes, independently of model auth.
//!
//! The session mechanics live in `tinychannels::runtime`; this module owns the
//! process's single session.
use std::sync::LazyLock;
use tinychannels::runtime::ChannelSession;
use tokio_util::sync::CancellationToken;

pub(super) use tinychannels::runtime::run_in_session;

static SESSION: LazyLock<ChannelSession> = LazyLock::new(ChannelSession::new);

pub(crate) fn channel_session() -> CancellationToken {
    SESSION.current()
}

pub(crate) fn invalidate_channel_session() {
    SESSION.invalidate();
}

#[cfg(test)]
#[path = "session_tests.rs"]
mod tests;
