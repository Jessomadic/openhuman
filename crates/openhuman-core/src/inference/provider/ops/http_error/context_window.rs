//! Context-window overflow demotion log. The pure body matcher
//! (`is_context_window_exceeded_message`) lives in `tinyinference-llm`'s
//! `failure` module.

pub fn log_context_window_exceeded(
    operation: &str,
    provider: &str,
    model: Option<&str>,
    status: reqwest::StatusCode,
) {
    tracing::warn!(
        domain = "llm_provider",
        operation = operation,
        provider = provider,
        model = model.unwrap_or(""),
        status = status.as_u16(),
        failure = "non_2xx",
        kind = "context_window_exceeded",
        "[llm_provider] {operation} context-window exceeded ({status}) — \
         request too long for the model, not reporting to Sentry"
    );
}
