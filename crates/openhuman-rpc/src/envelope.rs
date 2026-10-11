//! JSON-RPC 2.0 request and response envelopes.
//!
//! Both halves of the wire live here: the server-side types the core's `/rpc`
//! handler deserializes and serializes, and the client-side helpers the Tauri
//! shell uses to build a request body and decode a response. Keeping them in
//! one place means a change to the envelope cannot land on one side only.
//!
//! As defined in the [JSON-RPC 2.0 Specification](https://www.jsonrpc.org/specification).

use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// The only protocol version OpenHuman speaks.
pub const JSONRPC_VERSION: &str = "2.0";

/// The implementation-defined server error code every controller failure is
/// answered with. The message (and optional `data`) carry the detail.
pub const SERVER_ERROR_CODE: i64 = -32000;

/// Standard JSON-RPC 2.0 request format.
#[derive(Debug, Deserialize)]
pub struct RpcRequest {
    /// The JSON-RPC version. MUST be exactly "2.0".
    #[allow(dead_code)]
    pub jsonrpc: String,
    /// Unique identifier for the request. MUST be a String, Number, or Null.
    /// The server will return this same ID in the response.
    pub id: Value,
    /// The name of the method to be invoked (e.g., `openhuman.memory_doc_put`).
    pub method: String,
    /// Parameters for the method call. MUST be a structured value (Object or Array).
    /// Defaults to null if not provided.
    #[serde(default)]
    pub params: Value,
}

/// Standard JSON-RPC 2.0 success response format.
#[derive(Debug, Serialize)]
pub struct RpcSuccess {
    /// The JSON-RPC version. ALWAYS "2.0".
    pub jsonrpc: &'static str,
    /// The identifier mirrored from the original request.
    pub id: Value,
    /// The result of the successful method invocation.
    pub result: Value,
}

/// Standard JSON-RPC 2.0 error response format.
#[derive(Debug, Serialize)]
pub struct RpcFailure {
    /// The JSON-RPC version. ALWAYS "2.0".
    pub jsonrpc: &'static str,
    /// The identifier mirrored from the original request.
    pub id: Value,
    /// Information about the error that occurred.
    pub error: RpcError,
}

/// Detail about an RPC invocation error.
///
/// Contains a code, a message, and optional extra data for debugging.
#[derive(Debug, Serialize)]
pub struct RpcError {
    /// Standardized error code.
    /// - -32700: Parse error
    /// - -32600: Invalid Request
    /// - -32601: Method not found
    /// - -32602: Invalid params
    /// - -32603: Internal error
    /// - -32000 to -32099: Reserved for implementation-defined server-errors.
    pub code: i64,
    /// A short, human-readable error message.
    pub message: String,
    /// Optional additional diagnostic data, which can be any JSON value.
    pub data: Option<Value>,
}

/// Build a JSON-RPC 2.0 request body for `method` with `params`.
#[must_use]
pub fn request_body(id: impl Into<Value>, method: &str, params: Value) -> Value {
    json!({
        "jsonrpc": JSONRPC_VERSION,
        "id": id.into(),
        "method": method,
        "params": params,
    })
}

/// Decode a JSON-RPC 2.0 response body into its `result`, or the error
/// message.
///
/// An `error` member wins over the HTTP status, so a failed call answered with
/// `200 OK` (which is how the core answers every controller failure) still
/// surfaces its message. A non-2xx status without an `error` member is an
/// error in its own right, and a missing `result` decodes as `null`.
pub fn decode_response(status: u16, body: &str) -> Result<Value, String> {
    let parsed: Value = serde_json::from_str(body)
        .map_err(|e| format!("core rpc returned a non-JSON body (http {status}): {e}"))?;
    if let Some(error) = parsed.get("error").filter(|e| !e.is_null()) {
        let message = error
            .get("message")
            .and_then(Value::as_str)
            .map(str::to_string)
            .unwrap_or_else(|| error.to_string());
        return Err(message);
    }
    if !(200..300).contains(&status) {
        return Err(format!("core rpc failed with http {status}"));
    }
    Ok(parsed.get("result").cloned().unwrap_or(Value::Null))
}

#[cfg(test)]
#[path = "envelope_tests.rs"]
mod tests;
