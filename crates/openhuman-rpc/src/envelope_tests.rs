use super::*;
use serde_json::json;

#[test]
fn rpc_request_deserializes() {
    let json = r#"{"jsonrpc":"2.0","id":1,"method":"test","params":{}}"#;
    let req: RpcRequest = serde_json::from_str(json).unwrap();
    assert_eq!(req.method, "test");
    assert_eq!(req.id, json!(1));
}

#[test]
fn rpc_request_params_default_to_null() {
    let json = r#"{"jsonrpc":"2.0","id":"abc","method":"foo"}"#;
    let req: RpcRequest = serde_json::from_str(json).unwrap();
    assert!(req.params.is_null());
}

#[test]
fn rpc_success_serializes() {
    let resp = RpcSuccess {
        jsonrpc: JSONRPC_VERSION,
        id: json!(42),
        result: json!({"ok": true}),
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("\"jsonrpc\":\"2.0\""));
    assert!(json.contains("\"id\":42"));
}

#[test]
fn rpc_failure_serializes() {
    let resp = RpcFailure {
        jsonrpc: JSONRPC_VERSION,
        id: json!("req-1"),
        error: RpcError {
            code: -32601,
            message: "Method not found".into(),
            data: Some(json!({"detail": "unknown"})),
        },
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("-32601"));
    assert!(json.contains("Method not found"));
}

#[test]
fn rpc_failure_serializes_without_data() {
    let resp = RpcFailure {
        jsonrpc: JSONRPC_VERSION,
        id: json!(null),
        error: RpcError {
            code: -32700,
            message: "Parse error".into(),
            data: None,
        },
    };
    let json = serde_json::to_string(&resp).unwrap();
    assert!(json.contains("-32700"));
}

#[test]
fn server_failure_wire_shape_is_stable() {
    // The exact bytes a controller failure is answered with. A change here is
    // a wire change for every client.
    let resp = RpcFailure {
        jsonrpc: JSONRPC_VERSION,
        id: json!(7),
        error: RpcError {
            code: SERVER_ERROR_CODE,
            message: "boom".into(),
            data: None,
        },
    };
    assert_eq!(
        serde_json::to_string(&resp).unwrap(),
        r#"{"jsonrpc":"2.0","id":7,"error":{"code":-32000,"message":"boom","data":null}}"#
    );
}

#[test]
fn request_body_builds_a_2_0_envelope() {
    let body = request_body(1, "core.ping", json!({"a": 1}));
    assert_eq!(
        body,
        json!({"jsonrpc": "2.0", "id": 1, "method": "core.ping", "params": {"a": 1}})
    );
}

#[test]
fn request_body_round_trips_through_rpc_request() {
    let body = request_body("abc", "openhuman.config_get", json!({}));
    let req: RpcRequest = serde_json::from_value(body).unwrap();
    assert_eq!(req.id, json!("abc"));
    assert_eq!(req.method, "openhuman.config_get");
    assert_eq!(req.params, json!({}));
}

#[test]
fn decodes_result_and_error_envelopes() {
    let ok = decode_response(
        200,
        r#"{"jsonrpc":"2.0","id":1,"result":{"isAuthenticated":true}}"#,
    )
    .unwrap();
    assert_eq!(ok, json!({ "isAuthenticated": true }));

    let err = decode_response(
        200,
        r#"{"jsonrpc":"2.0","id":1,"error":{"code":-32000,"message":"token is required"}}"#,
    )
    .unwrap_err();
    assert_eq!(err, "token is required");

    let http = decode_response(401, r#"{"jsonrpc":"2.0","id":1}"#).unwrap_err();
    assert!(http.contains("401"), "{http}");

    let garbage = decode_response(200, "<html>").unwrap_err();
    assert!(garbage.contains("non-JSON"), "{garbage}");
}

#[test]
fn decode_response_falls_back_to_the_raw_error_object() {
    let err = decode_response(200, r#"{"jsonrpc":"2.0","id":1,"error":{"code":-1}}"#).unwrap_err();
    assert_eq!(err, r#"{"code":-1}"#);
}

#[test]
fn decode_response_treats_null_error_and_missing_result_as_null_success() {
    let ok = decode_response(200, r#"{"jsonrpc":"2.0","id":1,"error":null}"#).unwrap();
    assert!(ok.is_null());
}
