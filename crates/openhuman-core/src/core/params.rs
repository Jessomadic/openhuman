//! JSON-RPC params shape and the transport-level validation messages.
//!
//! Controllers take named arguments, so `params` must be an object
//! (or absent). The strings emitted here, and by the controller registry's
//! schema check through [`unknown_param_message`] and
//! [`missing_required_param_message`], are what [`is_param_validation_error`]
//! recognises. The emitters and the matcher live together so a wording change
//! cannot break one side silently.

use serde_json::{Map, Value};

/// Prefix of the error for a param the method's schema does not declare.
const UNKNOWN_PARAM_PREFIX: &str = "unknown param '";
/// Prefix of the error for a required param the caller omitted.
const MISSING_REQUIRED_PARAM_PREFIX: &str = "missing required param '";
/// Prefix of the error for a `params` member that is not an object or null.
const INVALID_PARAMS_PREFIX: &str = "invalid params: ";

/// Converts JSON parameters into a map, ensuring they are in object format.
///
/// JSON-RPC allows parameters to be an Object, an Array, or Null. This implementation
/// primarily supports Object parameters for named-argument style calls.
pub fn params_to_object(params: Value) -> Result<Map<String, Value>, String> {
    match params {
        Value::Object(map) => Ok(map),
        Value::Null => Ok(Map::new()),
        other => Err(format!(
            "{INVALID_PARAMS_PREFIX}expected object or null, got {}",
            json_type_name(&other)
        )),
    }
}

/// Returns a human-readable string representation of a JSON value's type.
#[must_use]
pub fn json_type_name(value: &Value) -> &'static str {
    match value {
        Value::Null => "null",
        Value::Bool(_) => "bool",
        Value::Number(_) => "number",
        Value::String(_) => "string",
        Value::Array(_) => "array",
        Value::Object(_) => "object",
    }
}

/// Parses a JSON string into a `Value`.
pub fn parse_json_params(raw: &str) -> Result<Value, String> {
    serde_json::from_str(raw).map_err(|e| format!("invalid JSON params: {e}"))
}

/// The error for a param `key` that `namespace.function`'s schema does not declare.
#[must_use]
pub fn unknown_param_message(key: &str, namespace: &str, function: &str) -> String {
    format!("{UNKNOWN_PARAM_PREFIX}{key}' for {namespace}.{function}")
}

/// The error for a required param `key` the caller omitted; `comment` is the
/// field's schema description.
#[must_use]
pub fn missing_required_param_message(key: &str, comment: &str) -> String {
    format!("{MISSING_REQUIRED_PARAM_PREFIX}{key}': {comment}")
}

/// Returns `true` when the error message comes from JSON-RPC params validation
/// rather than the underlying handler.
///
/// Three shapes, all emitted before the handler ever runs:
///   * `"unknown param '<key>' for <ns>.<fn>"`       — [`unknown_param_message`] (extra field)
///   * `"missing required param '<key>': <comment>"` — [`missing_required_param_message`] (omitted required field)
///   * `"invalid params: expected object or null, got <type>"` — [`params_to_object`] (wrong params shape)
///
/// These only fire when caller and server schemas drift at the transport layer
/// — either a frontend on a different release than the running core, or a buggy
/// external client. Reporting them to Sentry produces unactionable noise (we
/// cannot patch an already-shipped install, and the message itself already
/// names the bad field).
///
/// Note: domain-level validation errors (e.g. type/format checks emitted *inside*
/// a controller's `rpc.rs` handler such as `"param 'x' must be a UUID"`) are
/// intentionally *not* matched here — only the three shapes emitted by the
/// transport-layer validators before the handler runs. Longer-term a typed
/// `RpcError::ParamValidation` variant would remove the string-matching
/// brittleness.
///
/// `starts_with` (not `.contains()`) is deliberate: validator errors are always
/// emitted as the full message body, so an anchored match avoids false positives
/// from upstream handler text that happens to mention `"unknown param"`. The
/// core's session-expired predicate uses `.contains()` because session-expired
/// markers can appear mid-message — flip these to match and the test
/// `is_param_validation_error_does_not_match_unrelated_errors` will break.
#[must_use]
pub fn is_param_validation_error(msg: &str) -> bool {
    msg.starts_with(UNKNOWN_PARAM_PREFIX)
        || msg.starts_with(MISSING_REQUIRED_PARAM_PREFIX)
        || msg.starts_with(INVALID_PARAMS_PREFIX)
}

#[cfg(test)]
#[path = "params_tests.rs"]
mod tests;
