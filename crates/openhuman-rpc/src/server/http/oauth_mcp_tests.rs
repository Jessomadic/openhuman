use axum::body::to_bytes;
use axum::extract::Query;
use axum::http::{header, StatusCode};
use axum::response::IntoResponse;

use super::{oauth_mcp_callback_handler, OAuthMcpCallbackQuery};

#[tokio::test]
async fn oauth_callback_reports_provider_denial_as_html_without_attempting_exchange() {
    let response = oauth_mcp_callback_handler(Query(OAuthMcpCallbackQuery {
        code: Some("unused-code".into()),
        state: Some("unused-state".into()),
        error: Some("access_denied".into()),
        error_description: Some("user declined".into()),
    }))
    .await
    .into_response();

    assert_eq!(response.status(), StatusCode::BAD_REQUEST);
    assert_eq!(
        response.headers()[header::CONTENT_TYPE],
        "text/html; charset=utf-8"
    );
    let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
    let html = String::from_utf8_lossy(&body);
    assert!(html.contains("access_denied"));
    assert!(html.contains("user declined"));
}

#[tokio::test]
async fn oauth_callback_requires_nonblank_code_and_state() {
    for (code, state) in [
        (None, Some("state")),
        (Some("code"), None),
        (Some("  "), Some("state")),
        (Some("code"), Some("  ")),
    ] {
        let response = oauth_mcp_callback_handler(Query(OAuthMcpCallbackQuery {
            code: code.map(str::to_string),
            state: state.map(str::to_string),
            error: None,
            error_description: None,
        }))
        .await
        .into_response();
        assert_eq!(response.status(), StatusCode::BAD_REQUEST);
        let body = to_bytes(response.into_body(), usize::MAX).await.unwrap();
        assert!(String::from_utf8_lossy(&body).contains("Missing authorization code or state"));
    }
}
