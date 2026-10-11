//! OpenHuman's [`ProgressiveSender`]: progressive channel replies over the
//! backend REST relay.
//!
//! The streaming choreography (draft, thinking and filler bubbles, failure
//! latches, finalize invariants) lives in `tinychannels::delivery::progressive`.
//! This adapter supplies the transport: it resolves the hosted session,
//! attaches idempotency keys, and maps [`BackendApiError`] onto
//! [`ProgressiveSendError`].

use crate::backend::{BackendApiError, BackendClient};
use crate::security::credentials::session_support::{
    get_session_token, is_local_session_token, BackendCredential,
};
use async_trait::async_trait;
use serde_json::{json, Value};
use tinychannels::delivery::progressive::{ProgressiveSendError, ProgressiveSender};

/// Attach a deterministic idempotency key to an outbound channel message
/// body, derived from the channel and message content.
pub(super) fn channel_message_body_with_idempotency(channel: &str, body: Value) -> Value {
    let intent = tinychannels::outbound_intent_from_legacy_message(channel, body);
    tinychannels::legacy_message_value_from_outbound_intent(&intent)
}

/// Map a backend failure onto the recovery the progressive driver needs.
/// Typed, never by message text, so recoveries cannot drift with wording.
pub(super) fn map_backend_error(err: anyhow::Error) -> ProgressiveSendError {
    match err.downcast_ref::<BackendApiError>() {
        Some(BackendApiError::ChannelEditUnsupported { .. }) => {
            ProgressiveSendError::EditUnsupported
        }
        Some(BackendApiError::MessageNotFound { .. }) => ProgressiveSendError::MessageGone,
        _ => ProgressiveSendError::Other(err),
    }
}

/// Construct the REST client plus the hosted session credential. Returns
/// `None` (and logs why) when either is unavailable.
async fn build_channel_client() -> Option<(BackendClient, BackendCredential)> {
    let config = match crate::config::rpc::load_config_with_timeout().await {
        Ok(c) => c,
        Err(e) => {
            tracing::error!("[channel-inbound] failed to load config: {}", e);
            return None;
        }
    };
    let credential = match get_session_token(&config) {
        Ok(Some(token)) if !is_local_session_token(&token) => BackendCredential::Session(token),
        Ok(_) => {
            tracing::error!("[channel-inbound] no hosted user session — cannot send");
            return None;
        }
        Err(e) => {
            tracing::error!(
                "[channel-inbound] no backend credential — cannot send: {}",
                e
            );
            return None;
        }
    };
    match BackendClient::from_config(&config) {
        Ok(client) => Some((client, credential)),
        Err(e) => {
            tracing::error!("[channel-inbound] failed to create API client: {}", e);
            None
        }
    }
}

async fn client() -> Result<(BackendClient, BackendCredential), ProgressiveSendError> {
    build_channel_client()
        .await
        .ok_or(ProgressiveSendError::Unavailable)
}

/// Progressive replies through `BackendClient::send_channel_*`.
pub(super) struct BackendProgressiveSender;

#[async_trait]
impl ProgressiveSender for BackendProgressiveSender {
    async fn send(&self, channel: &str, text: &str) -> Result<Value, ProgressiveSendError> {
        let (client, credential) = client().await?;
        let body = channel_message_body_with_idempotency(channel, json!({ "text": text }));
        client
            .send_channel_message(channel, &credential, body)
            .await
            .map_err(map_backend_error)
    }

    async fn edit(
        &self,
        channel: &str,
        message_id: &str,
        text: &str,
    ) -> Result<(), ProgressiveSendError> {
        let (client, credential) = client().await?;
        client
            .send_channel_edit(channel, message_id, &credential, json!({ "text": text }))
            .await
            .map(drop)
            .map_err(map_backend_error)
    }

    async fn delete(&self, channel: &str, message_id: &str) -> Result<(), ProgressiveSendError> {
        let (client, credential) = client().await?;
        client
            .send_channel_delete(channel, message_id, &credential)
            .await
            .map(drop)
            .map_err(map_backend_error)
    }

    async fn typing(&self, channel: &str) -> Result<(), ProgressiveSendError> {
        let (client, credential) = client().await?;
        client
            .send_channel_typing(channel, &credential)
            .await
            .map(drop)
            .map_err(map_backend_error)
    }
}

#[cfg(test)]
#[path = "delivery_tests.rs"]
mod tests;
