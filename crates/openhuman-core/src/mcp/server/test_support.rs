//! Test-only entry points into the served MCP surface.
//!
//! The golden suites call these instead of naming the protocol or transport
//! directly, so the fixtures stay byte-for-byte unchanged while the machinery
//! underneath them moves.

/// Answer one newline-delimited JSON-RPC line on a fresh session, exactly as
/// the stdio transport would.
pub(super) async fn dispatch_line(line: &str) -> Option<String> {
    let mut session = tinymcp::ClientSession::new("mcp");
    tinymcp::server::handle_line(
        &super::handler::OpenHumanMcpHandler,
        &mut session,
        &tinymcp::RequestHeaders::new(),
        line,
    )
    .await
}

/// Start the Streamable HTTP server on an ephemeral loopback port and return
/// its endpoint URL.
#[cfg(feature = "http-server")]
pub(super) async fn spawn_http(auth_token: Option<&str>) -> String {
    let (tx, rx) = tokio::sync::oneshot::channel();
    let config = super::HttpServerConfig {
        bind_addr: "127.0.0.1:0".parse().expect("loopback address"),
        auth_token: auth_token.map(str::to_string),
    };
    tokio::spawn(async move {
        super::run_http_reporting(config, Some(tx))
            .await
            .expect("mcp http server runs");
    });
    let addr = rx.await.expect("server reports its bound address");
    format!("http://{addr}/")
}
