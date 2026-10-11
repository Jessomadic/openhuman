//! OpenHuman's Streamable HTTP + SSE MCP server.
//!
//! The transport is `tinymcp`'s (`tinymcp::run_http`, behind its
//! `server-http` feature, which OpenHuman's `http-server` gate forwards). These
//! entry points bind it to OpenHuman's handler, so callers keep the
//! handler-free signatures this module always had.

use std::net::SocketAddr;

use anyhow::Result;

pub use tinymcp::HttpServerConfig;

use super::handler::handler;

/// Serves OpenHuman's MCP surface over HTTP until the server stops.
pub async fn run_http(config: HttpServerConfig) -> Result<()> {
    run_http_reporting(config, None).await
}

/// Like [`run_http`] but reports the actually-bound [`SocketAddr`] through
/// `ready` once the listener is up. Needed when binding an ephemeral port
/// (`127.0.0.1:0`) so the caller can learn the chosen port (e.g. to hand the
/// URL to a local MCP client).
pub async fn run_http_reporting(
    config: HttpServerConfig,
    ready: Option<tokio::sync::oneshot::Sender<SocketAddr>>,
) -> Result<()> {
    tinymcp::run_http_reporting(handler(), config, ready).await?;
    Ok(())
}
