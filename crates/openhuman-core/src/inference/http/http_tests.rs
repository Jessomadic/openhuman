//! Unit tests for the OpenAI-compatible `/v1` handler helpers. Route and
//! auth-layer tests live with the router in `openhuman-rpc`
//! (`server/http/inference_route_tests.rs`).

use crate::inference::http::server::strip_temperature_suffix;

#[test]
fn strip_temperature_suffix_only_removes_numeric_suffixes() {
    assert_eq!(strip_temperature_suffix("gpt-4o@0.7"), "gpt-4o");
    assert_eq!(strip_temperature_suffix("llama3.1:8b@1"), "llama3.1:8b");
    assert_eq!(strip_temperature_suffix("gpt@beta"), "gpt@beta");
}

/// Asserts that `ChatCompletionRequest` parses `max_completion_tokens` and respects
/// fallback precedence over `max_tokens` (Refs #5498).
#[test]
fn test_chat_completion_request_deserializes_max_completion_tokens() {
    use crate::inference::http::types::ChatCompletionRequest;

    let json_both = serde_json::json!({
        "model": "gpt-5",
        "messages": [{ "role": "user", "content": "hello" }],
        "max_tokens": 100,
        "max_completion_tokens": 200
    });
    let parsed: ChatCompletionRequest = serde_json::from_value(json_both).unwrap();
    assert_eq!(parsed.max_tokens, Some(100));
    assert_eq!(parsed.max_completion_tokens, Some(200));
    assert_eq!(
        parsed.max_completion_tokens.or(parsed.max_tokens),
        Some(200)
    );

    let json_legacy = serde_json::json!({
        "model": "gpt-4o",
        "messages": [{ "role": "user", "content": "hello" }],
        "max_tokens": 150
    });
    let parsed_legacy: ChatCompletionRequest = serde_json::from_value(json_legacy).unwrap();
    assert_eq!(parsed_legacy.max_tokens, Some(150));
    assert_eq!(parsed_legacy.max_completion_tokens, None);
    assert_eq!(
        parsed_legacy
            .max_completion_tokens
            .or(parsed_legacy.max_tokens),
        Some(150)
    );
}
