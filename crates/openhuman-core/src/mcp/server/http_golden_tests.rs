//! Golden fixtures for the Streamable HTTP transport OpenHuman serves.
//!
//! Status codes, plain-text rejection bodies, content types, the session
//! header and the JSON bodies are all wire behavior a remote client depends
//! on. Captured before the transport moved into `tinymcp::server`; they must
//! keep passing through that move unchanged.

use reqwest::{header::CONTENT_TYPE, Client, Response, StatusCode};
use serde_json::{json, Value};
use tinymcp_bus::{HEADER_PROTOCOL_VERSION, HEADER_SESSION_ID, LATEST_PROTOCOL_VERSION};

use super::test_support::spawn_http;

const PLAIN_TEXT: &str = "text/plain; charset=utf-8";

async fn initialize(http: &Client, endpoint: &str) -> String {
    let response = post(http, endpoint, None, None, &init_body()).await;
    assert_eq!(response.status(), StatusCode::OK);
    response
        .headers()
        .get(HEADER_SESSION_ID)
        .and_then(|value| value.to_str().ok())
        .expect("session header")
        .to_string()
}

fn init_body() -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": 1,
        "method": "initialize",
        "params": {
            "protocolVersion": LATEST_PROTOCOL_VERSION,
            "capabilities": {},
            "clientInfo": {"name": "golden", "version": "0"}
        }
    })
}

async fn post(
    http: &Client,
    endpoint: &str,
    session: Option<&str>,
    protocol: Option<&str>,
    body: &Value,
) -> Response {
    let mut request = http.post(endpoint).json(body);
    if let Some(session) = session {
        request = request.header(HEADER_SESSION_ID, session);
    }
    if let Some(protocol) = protocol {
        request = request.header(HEADER_PROTOCOL_VERSION, protocol);
    }
    request.send().await.expect("post")
}

async fn assert_text(response: Response, status: StatusCode, body: &str) {
    assert_content(response, status, PLAIN_TEXT, body).await;
}

async fn assert_content(response: Response, status: StatusCode, content_type: &str, body: &str) {
    assert_eq!(response.status(), status);
    assert_eq!(
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some(content_type)
    );
    assert_eq!(response.text().await.expect("body"), body);
}

#[tokio::test]
async fn initialize_answers_json_and_mints_a_session() {
    let endpoint = spawn_http(None).await;
    let response = post(&Client::new(), &endpoint, None, None, &init_body()).await;
    assert_eq!(response.status(), StatusCode::OK);
    assert_eq!(
        response
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("application/json")
    );
    let session = response
        .headers()
        .get(HEADER_SESSION_ID)
        .and_then(|v| v.to_str().ok())
        .expect("session header")
        .to_string();
    assert_eq!(session.len(), 36, "a hyphenated v4 uuid: {session}");
    let body: Value = response.json().await.expect("json");
    assert_eq!(body["result"]["protocolVersion"], LATEST_PROTOCOL_VERSION);
    assert_eq!(body["result"]["serverInfo"]["name"], "openhuman-core");
    assert_eq!(
        body["result"]["serverInfo"]["version"],
        env!("CARGO_PKG_VERSION")
    );
}

#[tokio::test]
async fn failed_initialize_answers_the_error_without_a_session() {
    let endpoint = spawn_http(None).await;
    let response = post(
        &Client::new(),
        &endpoint,
        None,
        None,
        &json!({"jsonrpc": "1.0", "id": 1, "method": "initialize"}),
    )
    .await;
    assert_eq!(response.status(), StatusCode::OK);
    assert!(response.headers().get(HEADER_SESSION_ID).is_none());
    assert_eq!(
        response.text().await.expect("body"),
        r#"{"error":{"code":-32600,"data":"jsonrpc must be \"2.0\"","message":"Invalid Request"},"id":1,"jsonrpc":"2.0"}"#
    );
}

#[tokio::test]
async fn session_and_protocol_rejections_are_plain_text() {
    let endpoint = spawn_http(None).await;
    let http = Client::new();
    let ping = json!({"jsonrpc": "2.0", "id": 2, "method": "ping"});

    let no_session = post(&http, &endpoint, None, None, &ping).await;
    assert_text(
        no_session,
        StatusCode::BAD_REQUEST,
        "missing or invalid Mcp-Session-Id header",
    )
    .await;

    let unknown = post(
        &http,
        &endpoint,
        Some("nope"),
        Some(LATEST_PROTOCOL_VERSION),
        &ping,
    )
    .await;
    assert_text(
        unknown,
        StatusCode::NOT_FOUND,
        "unknown or expired MCP session",
    )
    .await;

    let session = initialize(&http, &endpoint).await;
    let mismatch = post(&http, &endpoint, Some(&session), Some("2024-11-05"), &ping).await;
    assert_text(
        mismatch,
        StatusCode::BAD_REQUEST,
        "missing or invalid MCP-Protocol-Version header",
    )
    .await;
    let missing = post(&http, &endpoint, Some(&session), None, &ping).await;
    assert_text(
        missing,
        StatusCode::BAD_REQUEST,
        "missing or invalid MCP-Protocol-Version header",
    )
    .await;
}

#[tokio::test]
async fn requests_notifications_and_batches_on_a_session() {
    let endpoint = spawn_http(None).await;
    let http = Client::new();
    let session = initialize(&http, &endpoint).await;
    let protocol = Some(LATEST_PROTOCOL_VERSION);

    let ping = post(
        &http,
        &endpoint,
        Some(&session),
        protocol,
        &json!({"jsonrpc": "2.0", "id": 2, "method": "ping"}),
    )
    .await;
    assert_eq!(ping.status(), StatusCode::OK);
    assert_eq!(
        ping.text().await.expect("body"),
        r#"{"id":2,"jsonrpc":"2.0","result":{}}"#
    );

    let notification = post(
        &http,
        &endpoint,
        Some(&session),
        protocol,
        &json!({"jsonrpc": "2.0", "method": "notifications/initialized"}),
    )
    .await;
    assert_eq!(notification.status(), StatusCode::NO_CONTENT);
    assert_eq!(notification.text().await.expect("body"), "");

    // A batch body has no top-level `id`, so the transport answers 204 even
    // when the batch holds requests. Pinned as-is: it is the current wire.
    let batch = post(
        &http,
        &endpoint,
        Some(&session),
        protocol,
        &json!([{"jsonrpc": "2.0", "id": 3, "method": "ping"}]),
    )
    .await;
    assert_eq!(batch.status(), StatusCode::NO_CONTENT);

    let unknown_method = post(
        &http,
        &endpoint,
        Some(&session),
        protocol,
        &json!({"jsonrpc": "2.0", "id": 4, "method": "nope"}),
    )
    .await;
    assert_eq!(unknown_method.status(), StatusCode::OK);
    assert_eq!(
        unknown_method.text().await.expect("body"),
        r#"{"error":{"code":-32601,"data":"unsupported MCP method `nope`","message":"Method not found"},"id":4,"jsonrpc":"2.0"}"#
    );
}

#[tokio::test]
async fn non_json_body_is_rejected_by_the_extractor() {
    let endpoint = spawn_http(None).await;
    let response = Client::new()
        .post(&endpoint)
        .body("ping")
        .send()
        .await
        .expect("post");
    assert_eq!(response.status(), StatusCode::UNSUPPORTED_MEDIA_TYPE);
    assert_eq!(
        response.text().await.expect("body"),
        "Expected request with `Content-Type: application/json`"
    );
}

#[tokio::test]
async fn get_and_delete_follow_the_session_lifecycle() {
    let endpoint = spawn_http(None).await;
    let http = Client::new();

    let get_missing = http.get(&endpoint).send().await.expect("get");
    assert_text(
        get_missing,
        StatusCode::BAD_REQUEST,
        "missing Mcp-Session-Id header",
    )
    .await;
    let get_unknown = http
        .get(&endpoint)
        .header(HEADER_SESSION_ID, "nope")
        .send()
        .await
        .expect("get");
    assert_text(
        get_unknown,
        StatusCode::NOT_FOUND,
        "unknown or expired MCP session",
    )
    .await;

    let session = initialize(&http, &endpoint).await;
    let get_mismatch = http
        .get(&endpoint)
        .header(HEADER_SESSION_ID, session.as_str())
        .send()
        .await
        .expect("get");
    assert_text(
        get_mismatch,
        StatusCode::BAD_REQUEST,
        "missing or invalid MCP-Protocol-Version header",
    )
    .await;
    let events = http
        .get(&endpoint)
        .header(HEADER_SESSION_ID, session.as_str())
        .header(HEADER_PROTOCOL_VERSION, LATEST_PROTOCOL_VERSION)
        .send()
        .await
        .expect("get");
    assert_eq!(events.status(), StatusCode::OK);
    assert_eq!(
        events
            .headers()
            .get(CONTENT_TYPE)
            .and_then(|v| v.to_str().ok()),
        Some("text/event-stream")
    );
    drop(events);

    let delete_missing = http.delete(&endpoint).send().await.expect("delete");
    assert_text(
        delete_missing,
        StatusCode::BAD_REQUEST,
        "missing Mcp-Session-Id header",
    )
    .await;
    let deleted = http
        .delete(&endpoint)
        .header(HEADER_SESSION_ID, session.as_str())
        .send()
        .await
        .expect("delete");
    assert_eq!(deleted.status(), StatusCode::NO_CONTENT);
    let deleted_again = http
        .delete(&endpoint)
        .header(HEADER_SESSION_ID, session.as_str())
        .send()
        .await
        .expect("delete");
    assert_eq!(deleted_again.status(), StatusCode::NO_CONTENT);

    let after = post(
        &http,
        &endpoint,
        Some(&session),
        Some(LATEST_PROTOCOL_VERSION),
        &json!({"jsonrpc": "2.0", "id": 2, "method": "ping"}),
    )
    .await;
    assert_text(
        after,
        StatusCode::NOT_FOUND,
        "unknown or expired MCP session",
    )
    .await;
}

#[tokio::test]
async fn bearer_auth_rejects_with_plain_text_before_anything_else() {
    let endpoint = spawn_http(Some("golden-secret")).await;
    let http = Client::new();

    // The auth rejection sets a bare `text/plain`, unlike the other rejections.
    let missing = post(&http, &endpoint, None, None, &init_body()).await;
    assert_content(
        missing,
        StatusCode::UNAUTHORIZED,
        "text/plain",
        "unauthorized",
    )
    .await;
    let wrong = http
        .post(&endpoint)
        .bearer_auth("wrong")
        .json(&init_body())
        .send()
        .await
        .expect("post");
    assert_eq!(wrong.status(), StatusCode::UNAUTHORIZED);
    let get = http.get(&endpoint).send().await.expect("get");
    assert_eq!(get.status(), StatusCode::UNAUTHORIZED);
    let delete = http.delete(&endpoint).send().await.expect("delete");
    assert_eq!(delete.status(), StatusCode::UNAUTHORIZED);

    let allowed = http
        .post(&endpoint)
        .bearer_auth("golden-secret")
        .json(&init_body())
        .send()
        .await
        .expect("post");
    assert_eq!(allowed.status(), StatusCode::OK);
}
