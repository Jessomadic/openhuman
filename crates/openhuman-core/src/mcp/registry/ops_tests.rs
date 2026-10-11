//! Unit tests for the MCP clients RPC handlers.
//!
//! The operations themselves are covered in `tinymcp`. What this layer adds is
//! the RPC shape, which the end-to-end suites exercise against a live process,
//! and how a refusal reads to the caller, which a host over a temp workspace
//! can pin without connecting anything.

use super::*;

#[test]
fn a_blank_identifier_is_refused_with_the_field_name() {
    // The frontend surfaces this text, so it has to name what was missing.
    let error = require("   ", "server_id").expect_err("a blank identifier");
    assert_eq!(error, "server_id must not be empty");
}

#[test]
fn an_identifier_is_trimmed_before_it_is_used() {
    assert_eq!(require("  srv-1  ", "server_id").unwrap(), "srv-1");
}

// ── list_tools refusals (#6313) ─────────────────────────────────────────────
//
// A real host over a temp workspace. `apply_config_doc` writes the install
// store and dials nothing, so an installed server stays disconnected.

const QUALIFIED: &str = "io.github.ryudi84/uuid";

fn temp_config(workspace: &tempfile::TempDir) -> Config {
    Config {
        workspace_dir: workspace.path().join("workspace"),
        action_dir: workspace.path().join("workspace"),
        config_path: workspace.path().join("config.toml"),
        ..Default::default()
    }
}

/// Installs one stdio server under [`QUALIFIED`] and returns its `server_id`.
async fn install_one(config: &Config) -> String {
    let registry = resolve(config).unwrap();
    let doc = json!({ "mcpServers": { QUALIFIED: { "command": "uuid-mcp" } } });
    registry.dynamic().apply_config_doc(&doc).await.unwrap();
    let installs = registry.dynamic().status().await.unwrap();
    assert_eq!(installs.len(), 1, "{installs:?}");
    assert_ne!(
        installs[0].server_id, QUALIFIED,
        "fixture: the install's id must differ from its registry name"
    );
    installs[0].server_id.clone()
}

#[tokio::test]
async fn agent_refusal_names_no_rpc_method() {
    let workspace = tempfile::tempdir().unwrap();
    let config = temp_config(&workspace);
    let server_id = install_one(&config).await;

    let error = mcp_clients_list_tools(&config, server_id.clone(), Caller::Agent)
        .await
        .expect_err("a disconnected server has no tools to list");
    assert!(!error.contains("mcp_clients_"), "{error}");
    assert!(
        error.starts_with(&format!(
            "server_id={server_id} is disconnected; it has to be connected"
        )),
        "{error}"
    );
}

/// Every tool an agent refusal names must be callable by every agent that can
/// receive it, i.e. every built-in agent with `mcp_registry_list_tools` on its
/// belt. The read-only planner has no `mcp_registry_connect`.
#[test]
fn refusals_name_only_tools_on_every_listing_belt() {
    let install = tinymcp::ConnStatus {
        server_id: "srv-1".into(),
        qualified_name: QUALIFIED.into(),
        display_name: "uuid".into(),
        status: tinymcp::ServerStatus::Disconnected,
        tool_count: 0,
        last_error: None,
        auth_hint: None,
    };
    let refusals: Vec<String> = ["srv-1", "io.github.other/absent"]
        .into_iter()
        .map(|requested| {
            match explain_not_connected(requested, std::slice::from_ref(&install), Caller::Agent) {
                NotConnected::Refused(message) => message,
                NotConnected::Resolved(id) => panic!("{requested} resolved to {id}"),
            }
        })
        .collect();
    let named: Vec<&str> = refusals
        .iter()
        .flat_map(|message| message.split(|c: char| !(c.is_ascii_alphanumeric() || c == '_')))
        .filter(|word| word.starts_with("mcp_"))
        .collect();
    assert!(
        !named.is_empty(),
        "the unknown-id refusal names the status tool"
    );

    let belts: Vec<_> = crate::agent::registry::agents::load_builtins()
        .expect("built-ins load")
        .into_iter()
        .filter_map(|def| {
            let crate::agent::harness::definition::ToolScope::Named(tools) = &def.tools else {
                return None;
            };
            let belt: Vec<String> = tools.iter().chain(&def.deferred_tools).cloned().collect();
            belt.iter()
                .any(|tool| tool == "mcp_registry_list_tools")
                .then(|| (def.id.clone(), belt))
        })
        .collect();
    assert!(
        belts.iter().any(|(id, _)| id == "planner"),
        "fixture: the planner lists MCP tools, got {:?}",
        belts.iter().map(|(id, _)| id).collect::<Vec<_>>()
    );
    for (id, belt) in &belts {
        for tool in &named {
            assert!(
                belt.iter().any(|t| t == tool),
                "{id} can receive a refusal naming `{tool}`, which is not on its belt"
            );
        }
    }
}

#[tokio::test]
async fn rpc_refusal_still_names_the_rpc_method() {
    let workspace = tempfile::tempdir().unwrap();
    let config = temp_config(&workspace);
    let server_id = install_one(&config).await;

    let error = mcp_clients_list_tools(&config, server_id, Caller::Rpc)
        .await
        .expect_err("a disconnected server has no tools to list");
    assert!(error.contains("mcp_clients_connect"), "{error}");
    assert!(!error.contains("mcp_registry_connect"), "{error}");
}

#[tokio::test]
async fn a_qualified_name_resolves_to_its_install() {
    let workspace = tempfile::tempdir().unwrap();
    let config = temp_config(&workspace);
    let server_id = install_one(&config).await;

    // Resolved, then refused for the install it names — in terms of that
    // install's server_id, not the registry name the caller passed.
    let error = mcp_clients_list_tools(&config, QUALIFIED.to_string(), Caller::Agent)
        .await
        .expect_err("the resolved server is not connected");
    assert!(
        error.starts_with(&format!("server_id={server_id} is disconnected")),
        "{error}"
    );
}

#[tokio::test]
async fn an_uninstalled_id_is_not_reported_as_not_connected() {
    let workspace = tempfile::tempdir().unwrap();
    let config = temp_config(&workspace);
    install_one(&config).await;

    let error = mcp_clients_list_tools(&config, "io.github.other/absent".into(), Caller::Agent)
        .await
        .expect_err("nothing is installed under that name");
    assert!(!error.contains("not connected"), "{error}");
    assert!(error.contains("no installed MCP server"), "{error}");
    assert!(error.contains("mcp_registry_status"), "{error}");
}

/// The #6313 case itself: the server is connected, and the caller passes its
/// registry name. The listing is answered for the install that name resolves
/// to, under that install's `server_id`.
///
/// The server is OpenHuman's own MCP endpoint on an ephemeral loopback port,
/// so nothing leaves the machine.
#[cfg(feature = "http-server")]
#[tokio::test]
async fn a_qualified_name_lists_the_tools_of_its_connected_install() {
    let (bound_tx, bound_rx) = tokio::sync::oneshot::channel();
    let serve = crate::mcp::server::HttpServerConfig {
        bind_addr: "127.0.0.1:0".parse().unwrap(),
        auth_token: None,
    };
    let server = tokio::spawn(crate::mcp::server::run_http_reporting(
        serve,
        Some(bound_tx),
    ));
    let endpoint = format!("http://{}/", bound_rx.await.unwrap());

    let workspace = tempfile::tempdir().unwrap();
    let config = temp_config(&workspace);
    let registry = resolve(&config).unwrap();
    let doc = json!({ "mcpServers": { QUALIFIED: { "url": endpoint } } });
    registry.dynamic().apply_config_doc(&doc).await.unwrap();
    let server_id = registry.dynamic().status().await.unwrap()[0]
        .server_id
        .clone();
    assert_ne!(server_id, QUALIFIED, "fixture: id and registry name differ");
    mcp_clients_connect(&config, server_id.clone())
        .await
        .unwrap();

    let listed = mcp_clients_list_tools(&config, QUALIFIED.to_string(), Caller::Agent)
        .await
        .expect("a connected server's registry name lists its tools");
    assert_eq!(listed.value["server_id"], json!(server_id));
    assert!(
        !listed.value["tools"].as_array().unwrap().is_empty(),
        "{}",
        listed.value
    );

    registry.dynamic().disconnect(&server_id).await.unwrap();
    server.abort();
}

#[test]
fn a_registry_name_installed_twice_is_refused_with_both_ids() {
    let install = |server_id: &str| tinymcp::ConnStatus {
        server_id: server_id.into(),
        qualified_name: QUALIFIED.into(),
        display_name: "uuid".into(),
        status: tinymcp::ServerStatus::Disconnected,
        tool_count: 0,
        last_error: None,
        auth_hint: None,
    };
    let installs = [install("srv-a"), install("srv-b")];
    let NotConnected::Refused(message) = explain_not_connected(QUALIFIED, &installs, Caller::Agent)
    else {
        panic!("an ambiguous name must not resolve");
    };
    assert!(message.contains("srv-a, srv-b"), "{message}");
}
