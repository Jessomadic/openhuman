//! The `mcp.json` RPC handlers: reading the install store as one document and
//! replacing it from one.
//!
//! The contract — what a read shows, what a write may say — and the
//! reconciliation against the store are `tinymcp`'s
//! (`tinymcp::registry::config_doc`, `McpRegistry::apply_config_doc`). What is
//! left here is this application's: the `Outcome` envelope, the domain
//! events a change publishes, and connecting the changed servers in the
//! background so the editor that saved the document does not wait on them.

use serde_json::{json, Value};

use crate::config::Config;
use crate::core::bus::BUS;
use crate::core::events::DomainEvent;
use crate::core::Outcome;

use super::helpers::resolve;

// ── mcp.json ─────────────────────────────────────────────────────────────────

/// Renders the install store as the `mcp.json` document.
///
/// Credential *names* ride along as `envKeys`; values never do.
pub async fn mcp_clients_config_get(config: &Config) -> Result<Outcome<Value>, String> {
    let service = resolve(config)?;
    let doc = service
        .dynamic()
        .render_config_doc()
        .map_err(|error| error.to_string())?;
    let count = doc[tinymcp::registry::config_doc::ROOT_KEY]
        .as_object()
        .map_or(0, serde_json::Map::len);

    Ok(Outcome::new(
        doc,
        vec![format!("config_get rendered {count} servers")],
    ))
}

/// Replaces the install store with what `doc` declares.
///
/// A replace, not a merge — see `McpRegistry::apply_config_doc`. Every added
/// or updated server that is enabled is connected in the background; the
/// status poll reports how that went. The reply carries the re-rendered
/// document and what changed, so the editor can show both.
pub async fn mcp_clients_config_set(config: &Config, doc: Value) -> Result<Outcome<Value>, String> {
    let service = resolve(config)?;
    let registry = service.dynamic();
    let report = registry
        .apply_config_doc(&doc)
        .await
        .map_err(|error| error.to_string())?;

    for server in &report.removed {
        BUS.publish(DomainEvent::McpServerDisconnected {
            server_id: server.server_id.clone(),
            reason: Some("removed from mcp.json".to_string()),
        });
    }
    for server in &report.installed {
        BUS.publish(DomainEvent::McpServerInstalled {
            server_id: server.server_id.clone(),
            qualified_name: server.name.clone(),
        });
    }

    // Connecting can take the transport's whole timeout per server; the editor
    // must not wait on it. The status poll shows each attempt's outcome, and a
    // failure is recorded against the server either way.
    for server_id in report.connect_queued.clone() {
        let service = std::sync::Arc::clone(&service);
        tokio::spawn(async move {
            match service.dynamic().connect(&server_id).await {
                Ok(outcome) => {
                    let tool_count = u32::try_from(outcome.tools.len()).unwrap_or(u32::MAX);
                    tracing::debug!(
                        server_id = %server_id,
                        tools = tool_count,
                        "[mcp] config_set connected a server"
                    );
                    BUS.publish(DomainEvent::McpServerConnected {
                        server_id,
                        tool_count,
                    });
                }
                Err(error) => {
                    tracing::warn!(
                        server_id = %server_id,
                        "[mcp] config_set could not connect a server: {error}"
                    );
                }
            }
        });
    }

    let mut rendered = registry
        .render_config_doc()
        .map_err(|error| error.to_string())?;

    let names = |servers: &[tinymcp::AppliedServer]| -> Vec<String> {
        servers.iter().map(|server| server.name.clone()).collect()
    };
    let note = format!(
        "config_set added={} updated={} removed={}",
        report.installed.len(),
        report.updated.len(),
        report.removed.len()
    );
    tracing::debug!(
        added = report.installed.len(),
        updated = report.updated.len(),
        removed = report.removed.len(),
        connecting = report.connect_queued.len(),
        "[mcp] config_set applied mcp.json"
    );
    if let Some(object) = rendered.as_object_mut() {
        object.insert("added".into(), json!(names(&report.installed)));
        object.insert("updated".into(), json!(names(&report.updated)));
        object.insert("removed".into(), json!(names(&report.removed)));
    }

    Ok(Outcome::new(rendered, vec![note]))
}
