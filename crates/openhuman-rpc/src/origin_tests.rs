use super::*;

#[test]
fn allows_tauri_webview_origins() {
    for origin in [
        "tauri://localhost",
        "http://tauri.localhost",
        "https://tauri.localhost",
    ] {
        assert!(
            is_origin_allowed_with_extra(origin, None),
            "expected {origin} to be allowed"
        );
    }
}

#[test]
fn allows_loopback_with_any_port() {
    for origin in [
        "http://127.0.0.1:1420",
        "http://localhost:5173",
        "http://[::1]:4444",
        "http://localhost",
    ] {
        assert!(
            is_origin_allowed_with_extra(origin, None),
            "expected {origin} to be allowed"
        );
    }
}

#[test]
fn rejects_disallowed_origins() {
    for origin in [
        "https://attacker.example",
        "http://evil.localhost.attacker.example",
        "https://127.0.0.1.attacker.example",
        // HTTPS variant of localhost is NOT a configuration we ship — refuse.
        "https://localhost",
        "null",
        "",
    ] {
        assert!(
            !is_origin_allowed_with_extra(origin, None),
            "expected {origin} to be rejected"
        );
    }
}

#[test]
fn env_override_allows_extra_origins() {
    let extra_origins = Some("https://debug.internal, http://harness:9000");

    assert!(is_origin_allowed_with_extra(
        "https://debug.internal",
        extra_origins
    ));
    assert!(is_origin_allowed_with_extra(
        "http://harness:9000",
        extra_origins
    ));
    assert!(!is_origin_allowed_with_extra(
        "https://debug.internal.attacker.example",
        extra_origins
    ));
}

#[test]
fn env_override_does_not_allow_lookalike_suffixes() {
    assert!(!is_origin_allowed_with_extra(
        "https://debug.internal.attacker.example",
        Some("https://debug.internal")
    ));
}

#[test]
fn env_override_ignores_empty_entries() {
    assert!(!is_origin_allowed_with_extra(
        "https://attacker.example",
        Some(" , ,")
    ));
}
