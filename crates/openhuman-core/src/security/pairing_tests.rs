use super::*;
use tokio::test;

// ── is_public_bind ───────────────────────────────────────

#[test]
async fn localhost_variants_not_public() {
    assert!(!is_public_bind("127.0.0.1"));
    assert!(!is_public_bind("localhost"));
    assert!(!is_public_bind("::1"));
    assert!(!is_public_bind("[::1]"));
}

#[test]
async fn zero_zero_is_public() {
    assert!(is_public_bind("0.0.0.0"));
}

#[test]
async fn real_ip_is_public() {
    assert!(is_public_bind("192.168.1.100"));
    assert!(is_public_bind("10.0.0.1"));
}

// ── Core RPC bind token ──────────────────────────────────

#[test]
async fn public_bind_without_env_token_auto_generates() {
    let tmp = std::env::temp_dir().join(format!("pairing-bind-test-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let token = ensure_core_rpc_token_for_bind("0.0.0.0", &tmp, None)
        .expect("public bind should auto-generate a token")
        .expect("public bind should return Some(token)");
    assert_eq!(token.len(), 64);
    assert!(token.chars().all(|c| c.is_ascii_hexdigit()));
    let from_disk = std::fs::read_to_string(tmp.join("core.token")).unwrap();
    assert_eq!(from_disk, token);
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
async fn public_bind_rejects_explicit_empty_env_token() {
    let tmp = std::env::temp_dir().join(format!("pairing-bind-empty-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let err = ensure_core_rpc_token_for_bind("0.0.0.0", &tmp, Some("   "))
        .expect_err("empty env token on public bind must fail");
    assert!(matches!(err, CoreBindTokenError::EmptyEnvToken { .. }));
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
async fn loopback_bind_without_env_token_returns_none() {
    let tmp = std::env::temp_dir().join(format!("pairing-bind-loopback-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let token = ensure_core_rpc_token_for_bind("127.0.0.1", &tmp, None).unwrap();
    assert!(token.is_none());
    assert!(!tmp.join("core.token").exists());
    std::fs::remove_dir_all(&tmp).ok();
}

#[test]
async fn public_bind_uses_nonempty_env_token_without_writing_file() {
    let tmp = std::env::temp_dir().join(format!("pairing-bind-env-token-{}", std::process::id()));
    std::fs::create_dir_all(&tmp).unwrap();
    let token = ensure_core_rpc_token_for_bind("0.0.0.0", &tmp, Some("  abc123  "))
        .unwrap()
        .expect("env token should be returned");
    assert_eq!(token, "abc123");
    assert!(!tmp.join("core.token").exists());
    std::fs::remove_dir_all(&tmp).ok();
}
