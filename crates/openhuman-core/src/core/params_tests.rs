use super::*;
use serde_json::json;

#[test]
fn params_to_object_accepts_object() {
    let map = params_to_object(json!({"a": 1, "b": "x"})).unwrap();
    assert_eq!(map.len(), 2);
    assert_eq!(map.get("a"), Some(&json!(1)));
}

#[test]
fn params_to_object_accepts_null_as_empty_map() {
    let map = params_to_object(json!(null)).unwrap();
    assert!(map.is_empty());
}

#[test]
fn params_to_object_rejects_array() {
    let err = params_to_object(json!([1, 2, 3])).unwrap_err();
    assert!(err.contains("invalid params"));
    assert!(err.contains("array"));
}

#[test]
fn params_to_object_rejects_scalars() {
    assert!(params_to_object(json!(42)).unwrap_err().contains("number"));
    assert!(params_to_object(json!("hi"))
        .unwrap_err()
        .contains("string"));
    assert!(params_to_object(json!(true)).unwrap_err().contains("bool"));
}

#[test]
fn json_type_name_labels_every_json_variant() {
    assert_eq!(json_type_name(&json!(null)), "null");
    assert_eq!(json_type_name(&json!(true)), "bool");
    assert_eq!(json_type_name(&json!(3)), "number");
    assert_eq!(json_type_name(&json!("s")), "string");
    assert_eq!(json_type_name(&json!([])), "array");
    assert_eq!(json_type_name(&json!({})), "object");
}

#[test]
fn parse_json_params_roundtrips_object() {
    let v = parse_json_params(r#"{"k":1}"#).unwrap();
    assert_eq!(v, json!({"k": 1}));
}

#[test]
fn parse_json_params_reports_error_message() {
    let err = parse_json_params("{not json").unwrap_err();
    assert!(err.contains("invalid JSON params"));
}

#[test]
fn validation_messages_keep_their_wire_wording() {
    assert_eq!(
        unknown_param_message("api_key", "config", "update_model_settings"),
        "unknown param 'api_key' for config.update_model_settings"
    );
    assert_eq!(
        missing_required_param_message("session_id", "active session identifier"),
        "missing required param 'session_id': active session identifier"
    );
    assert_eq!(
        params_to_object(json!([])).unwrap_err(),
        "invalid params: expected object or null, got array"
    );
}

#[test]
fn is_param_validation_error_matches_every_emitted_shape() {
    // Driven from the emitters rather than literals, so the matcher and the
    // messages cannot drift apart.
    assert!(is_param_validation_error(&unknown_param_message(
        "x", "ns", "fn"
    )));
    assert!(is_param_validation_error(&missing_required_param_message(
        "x", "comment"
    )));
    assert!(is_param_validation_error(
        &params_to_object(json!("s")).unwrap_err()
    ));
}

#[test]
fn is_param_validation_error_matches_the_three_validator_shapes() {
    // Regression guard for OPENHUMAN-TAURI-20: pre-#1467 cores rejected
    // `api_key` because it wasn't in the schema yet. The error string
    // must keep matching here so it gets logged at info level and never
    // reaches Sentry as an unactionable client/server skew event.
    assert!(is_param_validation_error(
        "unknown param 'api_key' for config.update_model_settings"
    ));
    // `all::validate_params` — missing required field.
    assert!(is_param_validation_error(
        "missing required param 'session_id': active session identifier"
    ));
    // `params_to_object` — params field is the wrong JSON shape.
    assert!(is_param_validation_error(
        "invalid params: expected object or null, got array"
    ));
}

#[test]
fn is_param_validation_error_does_not_match_unrelated_errors() {
    // Handler-side / network / auth failures must still be reported.
    assert!(!is_param_validation_error(
        "backend returned 401 Unauthorized"
    ));
    assert!(!is_param_validation_error("network timeout"));
    assert!(!is_param_validation_error(
        "config.update_model_settings: store write failed"
    ));
    // Empty and substring-only matches don't qualify either.
    assert!(!is_param_validation_error(""));
    assert!(!is_param_validation_error(
        "rpc failed: unknown param 'x' for ns.fn"
    ));
    // The JSON-string parse error is a CLI input error, not a params-shape one.
    assert!(!is_param_validation_error(
        &parse_json_params("{").unwrap_err()
    ));
}
