//! Which browser origins may call a core's HTTP API.
//!
//! The core's RPC server only ever serves three legitimate browser consumers:
//!   1. The bundled Tauri v2 webview — `tauri://localhost` on macOS/Linux and
//!      `http(s)://tauri.localhost` on Windows.
//!   2. The Vite dev server during `pnpm dev` — any port on loopback hosts.
//!   3. Operator-controlled debug harnesses opted in via [`ALLOWED_ORIGINS_ENV`].
//!
//! Anything else (a random web page that has somehow obtained the bearer token
//! via leaked logs / screenshots / a compromised third-party origin) must be
//! refused — the bearer token alone is not enough authorization without an
//! origin binding.
//!
//! This is the CORS rule for `/rpc` and the other HTTP routes. The core's
//! Socket.IO handshake has its own URL-parsing check that accepts a slightly
//! different set (any scheme on a loopback or `tauri.localhost` host); both
//! read the same [`ALLOWED_ORIGINS_ENV`]. Converging the two is a behavior
//! change and is left as follow-up.
//!
//! The function here is pure: the caller reads the environment and passes the
//! extra allowlist in, which keeps this crate free of I/O and makes the rule
//! testable without mutating process-global state.

/// Environment variable for additional comma-separated origins to allow.
/// Intended for debug harnesses and E2E setups that don't run on loopback —
/// e.g. `OPENHUMAN_CORE_ALLOWED_ORIGINS=https://e2e.internal,http://my-debugger:8080`.
pub const ALLOWED_ORIGINS_ENV: &str = "OPENHUMAN_CORE_ALLOWED_ORIGINS";

/// Decides whether a browser `Origin` header value is allowed to make
/// authenticated cross-origin requests against a core's HTTP API.
///
/// `extra_origins` is the raw value of [`ALLOWED_ORIGINS_ENV`], if set: a
/// comma-separated list matched exactly, never by prefix or host.
#[must_use]
pub fn is_origin_allowed_with_extra(origin: &str, extra_origins: Option<&str>) -> bool {
    // Tauri v2 webview origins. Windows uses an HTTP(S) custom host; macOS
    // and Linux use the `tauri://` scheme. We accept both for portability.
    if matches!(
        origin,
        "tauri://localhost" | "http://tauri.localhost" | "https://tauri.localhost"
    ) {
        return true;
    }

    // Loopback origins on any port (Vite dev server, E2E driver, CLI tools).
    if let Some(rest) = origin.strip_prefix("http://") {
        let authority = rest.split('/').next().unwrap_or("");
        let host = if let Some(stripped) = authority.strip_prefix('[') {
            // IPv6 literal: `[::1]:1420` → `::1`
            stripped.split(']').next().unwrap_or("")
        } else {
            authority.split(':').next().unwrap_or("")
        };
        if matches!(host, "127.0.0.1" | "localhost" | "::1") {
            return true;
        }
    }

    // Env override: comma-separated exact matches.
    if let Some(extra) = extra_origins {
        for candidate in extra.split(',').map(str::trim).filter(|s| !s.is_empty()) {
            if candidate == origin {
                return true;
            }
        }
    }

    false
}

#[cfg(test)]
#[path = "origin_tests.rs"]
mod tests;
