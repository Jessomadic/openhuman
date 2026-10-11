use super::build_http_schema_dump;

#[test]
fn http_schema_dump_includes_openhuman_and_core_methods() {
    let dump = build_http_schema_dump();
    let methods = dump.methods;
    assert!(
        methods
            .iter()
            .any(|m| m.method == "core.version" && m.namespace == "core"),
        "schema dump should include core methods"
    );

    assert!(
        methods
            .iter()
            .any(|m| m.method == "openhuman.health_snapshot"),
        "schema dump should include migrated openhuman methods"
    );
}

#[tokio::test]
async fn test_http_health_handler_returns_correct_status() {
    use axum::body::to_bytes;
    use axum::http::StatusCode;
    use axum::response::IntoResponse;

    // Call the handler once and derive both the status and expected status from
    // the same response — avoids a TOCTOU race where a separate snapshot()
    // call before/after the handler could observe different component state.
    let resp = super::health_handler().await.into_response();
    let status = resp.status();

    let body = to_bytes(resp.into_body(), usize::MAX)
        .await
        .expect("failed to read body");
    let snapshot: serde_json::Value =
        serde_json::from_slice(&body).expect("failed to deserialize health snapshot");

    let components = snapshot["components"]
        .as_object()
        .expect("components should be an object");

    // Granular liveness (#3312): the HTTP status is driven by the `healthy`
    // verdict (no *critical* component unhealthy), not by all-components-ok.
    // Derive the expectation from the body so the test asserts the handler's
    // internal consistency rather than racing on live component state.
    let body_healthy = snapshot["healthy"]
        .as_bool()
        .expect("body exposes a `healthy` verdict flag");
    let expected_status = if body_healthy {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    assert_eq!(status, expected_status);

    // `healthy` must mean "no critical component is unhealthy", and any
    // unhealthy component must be bucketed as either critical or degraded.
    let critical_unhealthy = snapshot["critical_unhealthy"]
        .as_array()
        .expect("body exposes critical_unhealthy");
    assert_eq!(body_healthy, critical_unhealthy.is_empty());

    let unhealthy_count = components
        .values()
        .filter(|c| {
            let s = c["status"].as_str().unwrap_or("");
            s != "ok" && s != "starting"
        })
        .count();
    let degraded_count = snapshot["degraded_components"]
        .as_array()
        .expect("body exposes degraded_components")
        .len();
    assert_eq!(
        unhealthy_count,
        critical_unhealthy.len() + degraded_count,
        "every unhealthy component is bucketed as critical or degraded"
    );
}
