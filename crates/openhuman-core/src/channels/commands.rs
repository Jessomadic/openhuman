//! `doctor channels`: health checks for every configured real-time channel.
//!
//! Channels are built by `tinychannels::build_channels` from the same hydrated
//! config the runtime uses, and checked by `tinychannels::runtime`; this module
//! only prints the report.

use super::runtime::{hydrate_channel_credentials, RuntimeProxyClients};
use crate::config::Config;
use anyhow::Result;
use std::sync::Arc;
use std::time::Duration;
use tinychannels::runtime::{check_channels_health, ChannelHealthState};

/// Per-channel health-check budget.
const HEALTH_CHECK_TIMEOUT: Duration = Duration::from_secs(10);

/// Display label for a channel id (`telegram` → `Telegram`).
fn channel_label(channel: &str) -> String {
    tinychannels::controllers::find_channel_definition(channel)
        .map(|definition| definition.display_name.to_string())
        .unwrap_or_else(|| channel.to_string())
}

/// One report line for a channel's health state.
fn report_line(label: &str, state: ChannelHealthState) -> String {
    match state {
        ChannelHealthState::Healthy => format!("  ✅ {label:<9} healthy"),
        ChannelHealthState::Unhealthy => format!("  ❌ {label:<9} unhealthy (auth/config/network)"),
        ChannelHealthState::Timeout => format!("  ⏱️  {label:<9} timed out (>10s)"),
    }
}

/// Run health checks for configured channels.
pub async fn doctor_channels(config: Config) -> Result<()> {
    let host: Arc<dyn tinychannels::ChannelHost> = Arc::new(tinychannels::NoopHost);
    let channels = tinychannels::build_channels(
        &hydrate_channel_credentials(&config),
        &host,
        &RuntimeProxyClients,
    );

    if channels.is_empty() {
        println!("No real-time channels configured. Configure channels in the web UI.");
        return Ok(());
    }

    println!("🩺 OpenHuman Channel Doctor");
    println!();

    let (mut healthy, mut unhealthy, mut timeout) = (0_u32, 0_u32, 0_u32);
    for (name, state) in check_channels_health(&channels, HEALTH_CHECK_TIMEOUT).await {
        match state {
            ChannelHealthState::Healthy => healthy += 1,
            ChannelHealthState::Unhealthy => unhealthy += 1,
            ChannelHealthState::Timeout => timeout += 1,
        }
        println!("{}", report_line(&channel_label(&name), state));
    }

    if config.channels_config.webhook.is_some() {
        println!("  ℹ️  Webhook   ensure your webhook endpoint is reachable");
    }

    println!();
    println!("Summary: {healthy} healthy, {unhealthy} unhealthy, {timeout} timed out");
    Ok(())
}

#[cfg(test)]
#[path = "commands_tests.rs"]
mod tests;
