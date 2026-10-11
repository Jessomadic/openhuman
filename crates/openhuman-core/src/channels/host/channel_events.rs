//! Event-bus subscribers that give every capable channel in-chat approvals
//! and remote-control turn state.
//!
//! Both used to exist for Telegram only. The behaviour now lives in
//! `tinychannels` (`approvals::ApprovalSurface`, `remote::mark_turn`), gated
//! per provider by `ChannelCapabilities`; these subscribers only translate
//! OpenHuman's [`DomainEvent`]s into it.

use std::collections::HashMap;
use std::path::PathBuf;
use std::sync::Arc;

use async_trait::async_trait;
use tinybus::EventHandler;
use tinychannels::approvals::{ApprovalPrompt, ApprovalSurface};
use tinychannels::capabilities_for;

use crate::channels::Channel;
use crate::core::events::DomainEvent;

/// Turns `ApprovalRequested` events into prompts in the chat the turn came
/// from, for every channel with the `chat_approvals` capability.
///
/// The dispatch loop scopes those channels' turns in an
/// `ApprovalChatContext` whose `thread_id` is the conversation history key and
/// whose `client_id` is the channel name; this subscriber records each inbound
/// message's reply target under the same key, so a later approval can find its
/// way back. The user's `yes`/`no` reply is intercepted by the dispatch loop.
pub struct ChannelApprovalSurfaceSubscriber {
    surface: ApprovalSurface,
}

impl ChannelApprovalSurfaceSubscriber {
    pub fn new(channels_by_name: Arc<HashMap<String, Arc<dyn Channel>>>) -> Self {
        Self {
            surface: ApprovalSurface::new(channels_by_name),
        }
    }

    #[cfg(test)]
    pub(crate) fn surface(&self) -> &ApprovalSurface {
        &self.surface
    }
}

#[async_trait]
impl EventHandler<DomainEvent> for ChannelApprovalSurfaceSubscriber {
    fn name(&self) -> &str {
        "channels::approval_surface"
    }

    fn domains(&self) -> Option<&[&str]> {
        Some(&["channel", "approval"])
    }

    async fn handle(&self, event: &DomainEvent) {
        match event {
            DomainEvent::ChannelMessageReceived {
                channel,
                sender,
                reply_target,
                thread_ts,
                ..
            } => {
                self.surface
                    .record_inbound(channel, sender, reply_target, thread_ts.as_deref());
            }
            DomainEvent::ApprovalRequested {
                request_id,
                tool_name,
                action_summary,
                thread_id,
                client_id,
                ..
            } => {
                // Web and other non-channel approvals carry their own client
                // ids; only channels that surface approvals in chat apply.
                let Some(channel) = client_id.as_deref() else {
                    return;
                };
                if !capabilities_for(channel).chat_approvals {
                    return;
                }
                let Some(thread_id) = thread_id.as_deref() else {
                    tracing::warn!(
                        "[channel-approval] approval request_id={request_id} tool={tool_name} \
                         has client_id={channel} but no thread_id — cannot route"
                    );
                    return;
                };
                let outcome = self
                    .surface
                    .surface(&ApprovalPrompt {
                        request_id: request_id.clone(),
                        tool_name: tool_name.clone(),
                        action_summary: action_summary.clone(),
                        thread_id: thread_id.to_string(),
                        channel: channel.to_string(),
                    })
                    .await;
                tracing::debug!(
                    "[channel-approval] request_id={request_id} channel={channel} outcome={outcome:?}"
                );
            }
            _ => {}
        }
    }
}

/// Records per-chat turn state (busy while a turn runs) for `/status`, on
/// every channel with the `remote_control` capability.
pub struct ChannelTurnStateSubscriber {
    workspace_dir: PathBuf,
}

impl ChannelTurnStateSubscriber {
    pub fn new(workspace_dir: PathBuf) -> Self {
        Self { workspace_dir }
    }

    async fn mark(&self, channel: &str, reply_target: &str, event_ws: &PathBuf, busy: bool) {
        if !capabilities_for(channel).remote_control {
            return;
        }
        if *event_ws != self.workspace_dir {
            tracing::debug!(
                "[channel-remote] dropping stale-workspace turn event busy={busy} event_ws={} self_ws={}",
                event_ws.display(),
                self.workspace_dir.display()
            );
            return;
        }
        tracing::debug!(
            "[channel-remote] turn busy={busy} channel={channel} reply_target={reply_target}"
        );
        tinychannels::remote::mark_turn(&self.workspace_dir, channel, reply_target, busy).await;
    }
}

#[async_trait]
impl EventHandler<DomainEvent> for ChannelTurnStateSubscriber {
    fn name(&self) -> &str {
        "channels::turn_state"
    }

    fn domains(&self) -> Option<&[&str]> {
        Some(&["channel"])
    }

    async fn handle(&self, event: &DomainEvent) {
        match event {
            DomainEvent::ChannelMessageReceived {
                channel,
                reply_target,
                workspace_dir,
                ..
            } => self.mark(channel, reply_target, workspace_dir, true).await,
            DomainEvent::ChannelMessageProcessed {
                channel,
                reply_target,
                workspace_dir,
                ..
            } => self.mark(channel, reply_target, workspace_dir, false).await,
            _ => {}
        }
    }
}

#[cfg(test)]
#[path = "channel_events_tests.rs"]
mod tests;
