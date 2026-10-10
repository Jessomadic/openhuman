//! Strict local structured-output validation at the Embed boundary.

mod common;

use openhuman_embed::complete::{ChatMessage, Completer, CompletionRequest, ResponseFormat};
use openhuman_embed::Route;
use serde_json::{json, Value};
use wiremock::matchers::{method, path};
use wiremock::{Mock, MockServer, ResponseTemplate};

async fn provider(content: &str) -> MockServer {
    let server = MockServer::start().await;
    Mock::given(method("POST"))
        .and(path("/v1/chat/completions"))
        .respond_with(ResponseTemplate::new(200).set_body_json(common::chat_completion(content)))
        .mount(&server)
        .await;
    server
}

fn request(schema: Value) -> CompletionRequest {
    CompletionRequest::new("fixture", vec![ChatMessage::user("Review untrusted code.")])
        .response_format(ResponseFormat::JsonSchema {
            name: "review".into(),
            schema,
        })
        .max_tokens(128)
}

fn completer(server: &MockServer) -> Completer {
    Completer::new(Route::openai_compatible(
        format!("{}/v1", server.uri()),
        "fixture",
    ))
}

#[tokio::test]
async fn a_parseable_reply_with_the_wrong_type_is_an_error() {
    let server = provider(r#"{"summary":123}"#).await;
    let error = completer(&server).complete(request(json!({"type":"object","properties":{"summary":{"type":"string"}},"required":["summary"]}))).await.expect_err("schema-invalid JSON must not become an empty successful review");
    assert!(!error.to_string().contains("123"));
    assert_eq!(server.received_requests().await.unwrap().len(), 1);
}

#[tokio::test]
async fn schema_combinators_and_numeric_constraints_are_enforced() {
    let server = provider(r#"{"confidence":1.5}"#).await;
    completer(&server).complete(request(json!({"allOf":[{"type":"object","required":["confidence"]},{"properties":{"confidence":{"type":"number","minimum":0,"maximum":1}}}]})))
        .await.expect_err("a schema subset must not silently ignore bounds or combinators");
}

#[tokio::test]
async fn an_invalid_schema_is_rejected_before_inference() {
    let server = provider("{}").await;
    completer(&server)
        .complete(request(json!({"type":"not-a-json-type"})))
        .await
        .expect_err("invalid schema");
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn invalid_answers_exhaust_only_the_explicit_repair_allowance() {
    let server = provider(r#"{"summary":123}"#).await;
    let error = completer(&server)
        .complete(
            request(json!({"properties":{"summary":{"type":"string"}}})).structured_retries(2),
        )
        .await
        .unwrap_err();
    let openhuman_embed::CoreError::StructuredOutput { failure, .. } = error else {
        panic!("typed validation error");
    };
    assert_eq!(failure.attempts, 3);
    assert_eq!(failure.usage.unwrap().input_tokens, 3);
    assert_eq!(server.received_requests().await.unwrap().len(), 3);
}

#[tokio::test]
async fn external_schema_retrieval_is_refused_before_inference() {
    let server = provider("{}").await;
    completer(&server)
        .complete(request(json!({"$ref":"https://example.invalid/schema"})))
        .await
        .unwrap_err();
    assert!(server.received_requests().await.unwrap().is_empty());
}
