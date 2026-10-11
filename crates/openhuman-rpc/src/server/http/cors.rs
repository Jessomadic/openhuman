//! CORS for the core's HTTP API.
//!
//! The origin allowlist itself is the shared wire rule in
//! [`crate::is_origin_allowed_with_extra`]; this module reads the
//! operator's extra origins from the environment and shapes the headers.

use axum::extract::Request;
use axum::http::{header, HeaderValue, Method, StatusCode};
use axum::middleware::Next;
use axum::response::{IntoResponse, Response};

/// Decides whether a browser `Origin` header value is allowed, including the
/// operator's extra origins from [`crate::ALLOWED_ORIGINS_ENV`].
pub(crate) fn is_origin_allowed(origin: &str) -> bool {
    let extra_origins = std::env::var(crate::ALLOWED_ORIGINS_ENV).ok();
    crate::is_origin_allowed_with_extra(origin, extra_origins.as_deref())
}

/// Middleware for handling Cross-Origin Resource Sharing (CORS).
///
/// Reads the request's `Origin` header before invoking the inner handler so
/// the same value can be echoed back (when allowed) on the response.
pub(super) async fn cors_middleware(req: Request, next: Next) -> Response {
    let origin = req
        .headers()
        .get(header::ORIGIN)
        .and_then(|v| v.to_str().ok())
        .map(str::to_owned);

    if req.method() == Method::OPTIONS {
        return with_cors_headers(StatusCode::NO_CONTENT.into_response(), origin.as_deref());
    }

    let response = next.run(req).await;
    with_cors_headers(response, origin.as_deref())
}

/// Injects CORS headers into a response.
///
/// If the request carried an `Origin` header and that origin is on the
/// allowlist, the value is echoed back in `Access-Control-Allow-Origin` and
/// `Vary: Origin` is set so intermediate caches keep per-origin responses
/// distinct. Disallowed origins receive no `Access-Control-Allow-Origin`
/// header at all — the browser will then refuse to surface the response to
/// the calling JS. Non-browser callers (no `Origin` header) are unaffected.
///
/// For Docker / cloud deployments where the server binds to `0.0.0.0`,
/// extend the allowlist via the `OPENHUMAN_CORE_ALLOWED_ORIGINS` env var
/// (comma-separated) rather than wildcarding `Access-Control-Allow-Origin`.
pub(crate) fn with_cors_headers(mut response: Response, origin: Option<&str>) -> Response {
    let headers = response.headers_mut();
    headers.append(header::VARY, HeaderValue::from_static("Origin"));

    if let Some(o) = origin {
        if is_origin_allowed(o) {
            if let Ok(val) = HeaderValue::from_str(o) {
                headers.insert(header::ACCESS_CONTROL_ALLOW_ORIGIN, val);
            }
        } else {
            tracing::warn!("[cors] rejected disallowed origin: {}", o);
        }
    }

    headers.insert(
        header::ACCESS_CONTROL_ALLOW_METHODS,
        HeaderValue::from_static("GET, POST, OPTIONS"),
    );
    headers.insert(
        header::ACCESS_CONTROL_ALLOW_HEADERS,
        HeaderValue::from_static("Content-Type, Authorization"),
    );
    headers.insert(
        header::ACCESS_CONTROL_MAX_AGE,
        HeaderValue::from_static("86400"),
    );
    response
}

#[cfg(test)]
#[path = "cors_tests.rs"]
mod tests;
