use super::*;
use serde_json::json;
use tinytools::ToolScope;

fn cfg() -> Arc<Config> {
    Arc::new(Config::default())
}

#[test]
fn names_and_levels() {
    assert_eq!(
        McpRegistrySearchTool::new(cfg()).name(),
        "mcp_registry_search"
    );
    assert_eq!(
        McpRegistrySearchTool::new(cfg()).permission_level(),
        PermissionLevel::ReadOnly
    );
    assert_eq!(
        McpRegistryConnectTool::new(cfg()).permission_level(),
        PermissionLevel::Execute
    );
    assert_eq!(
        McpRegistryToolCallTool::new(cfg()).permission_level(),
        PermissionLevel::Execute
    );
    // Discovery tool: read-only, names match.
    assert_eq!(
        McpRegistryListToolsTool::new(cfg()).name(),
        "mcp_registry_list_tools"
    );
    assert_eq!(
        McpRegistryListToolsTool::new(cfg()).permission_level(),
        PermissionLevel::ReadOnly
    );
    assert_eq!(
        McpRegistryUninstallTool::new(cfg()).permission_level(),
        PermissionLevel::Write
    );
    assert_eq!(McpRegistrySearchTool::new(cfg()).scope(), ToolScope::All);
}

#[tokio::test]
async fn get_requires_qualified_name() {
    let err = McpRegistryGetTool::new(cfg())
        .execute(json!({}))
        .await
        .expect_err("missing qualified_name");
    assert!(err.to_string().contains("qualified_name"));
}

#[tokio::test]
async fn list_tools_requires_server_id() {
    let err = McpRegistryListToolsTool::new(cfg())
        .execute(json!({}))
        .await
        .expect_err("missing server_id");
    assert!(err.to_string().contains("server_id"));
}

#[tokio::test]
async fn list_tools_errors_for_unconnected_server() {
    // A server_id that is not installed errors rather than succeeding empty,
    // and says so rather than claiming it is merely not connected (#6313).
    let err = McpRegistryListToolsTool::new(cfg())
        .execute(json!({ "server_id": "definitely-not-connected-uuid" }))
        .await
        .expect_err("unconnected server must error");
    let err = err.to_string();
    assert!(err.contains("no installed MCP server"), "{err}");
    assert!(err.contains("mcp_registry_status"), "{err}");
}

/// The identity a registry tool presents to the model, captured from the
/// hand-written tools before their specs moved to `tinymcp_bus::agent_tools`.
///
/// Name, description and schema are prompt-cache and transcript identity: a
/// byte of drift invalidates every cached prefix and changes what a resumed
/// session replays. The schema is compared as serialized text, not as a
/// `Value`, so a key-order change is caught too.
struct Golden {
    tool: Box<dyn Tool>,
    name: &'static str,
    description: &'static str,
    schema: &'static str,
    permission: PermissionLevel,
    exposure: tinytools::ToolExposure,
    concurrency_safe: bool,
}

fn goldens() -> Vec<Golden> {
    vec![
        Golden {
            tool: Box::new(McpRegistrySearchTool::new(cfg())),
            name: r#"mcp_registry_search"#,
            description: r#"Search the MCP server registry catalog by `query`, optionally filtered by `transport` ("stdio" | "hosted" | "all"), paginated by `page` / `page_size`. Use to discover installable MCP servers."#,
            schema: r#"{"properties":{"page":{"minimum":1,"type":"integer"},"page_size":{"minimum":1,"type":"integer"},"query":{"type":"string"},"transport":{"enum":["stdio","hosted","all"],"type":"string"}},"type":"object"}"#,
            permission: PermissionLevel::ReadOnly,
            exposure: tinytools::ToolExposure::Deferred,
            concurrency_safe: true,
        },
        Golden {
            tool: Box::new(McpRegistryGetTool::new(cfg())),
            name: r#"mcp_registry_get"#,
            description: r#"Get one MCP registry server's detail by `qualified_name`."#,
            schema: r#"{"properties":{"qualified_name":{"type":"string"}},"required":["qualified_name"],"type":"object"}"#,
            permission: PermissionLevel::ReadOnly,
            exposure: tinytools::ToolExposure::Deferred,
            concurrency_safe: true,
        },
        Golden {
            tool: Box::new(McpRegistryInstalledListTool::new(cfg())),
            name: r#"mcp_registry_installed_list"#,
            description: r#"List the MCP servers currently installed for this user."#,
            schema: r#"{"properties":{},"type":"object"}"#,
            permission: PermissionLevel::ReadOnly,
            exposure: tinytools::ToolExposure::Deferred,
            concurrency_safe: true,
        },
        Golden {
            tool: Box::new(McpRegistryStatusTool::new(cfg())),
            name: r#"mcp_registry_status"#,
            description: r#"Report the connection status of installed MCP servers."#,
            schema: r#"{"properties":{},"type":"object"}"#,
            permission: PermissionLevel::ReadOnly,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: true,
        },
        Golden {
            tool: Box::new(McpRegistryListToolsTool::new(cfg())),
            name: r#"mcp_registry_list_tools"#,
            description: r#"List the tools (name, description, input schema) exposed by a connected MCP server, given its `server_id`. Use this to discover what a connected server can do before calling `mcp_registry_tool_call`. The server must already be connected (see `mcp_registry_status` / `mcp_registry_connect`)."#,
            schema: r#"{"properties":{"server_id":{"type":"string"}},"required":["server_id"],"type":"object"}"#,
            permission: PermissionLevel::ReadOnly,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: true,
        },
        Golden {
            tool: Box::new(McpRegistryConnectTool::new(cfg())),
            name: r#"mcp_registry_connect"#,
            description: r#"Connect (spawn + handshake) an installed MCP server by `server_id`, returning its tools."#,
            schema: r#"{"properties":{"server_id":{"type":"string"}},"required":["server_id"],"type":"object"}"#,
            permission: PermissionLevel::Execute,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: false,
        },
        Golden {
            tool: Box::new(McpRegistryDisconnectTool::new(cfg())),
            name: r#"mcp_registry_disconnect"#,
            description: r#"Disconnect (stop) a connected MCP server by `server_id`."#,
            schema: r#"{"properties":{"server_id":{"type":"string"}},"required":["server_id"],"type":"object"}"#,
            permission: PermissionLevel::Execute,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: false,
        },
        Golden {
            tool: Box::new(McpRegistryToolCallTool::new(cfg())),
            name: r#"mcp_registry_tool_call"#,
            description: r#"Invoke a tool on a connected MCP server: `server_id` + `tool_name` + `arguments` object."#,
            schema: r#"{"properties":{"arguments":{"type":"object"},"server_id":{"type":"string"},"tool_name":{"type":"string"}},"required":["server_id","tool_name"],"type":"object"}"#,
            permission: PermissionLevel::Execute,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: false,
        },
        Golden {
            tool: Box::new(McpRegistryUninstallTool::new(cfg())),
            name: r#"mcp_registry_uninstall"#,
            description: r#"Uninstall an installed MCP server by `server_id`. Default-OFF (opt-in)."#,
            schema: r#"{"properties":{"server_id":{"type":"string"}},"required":["server_id"],"type":"object"}"#,
            permission: PermissionLevel::Write,
            exposure: tinytools::ToolExposure::Direct,
            concurrency_safe: false,
        },
    ]
}

#[test]
fn registry_tools_present_the_exact_identity_they_always_had() {
    for golden in goldens() {
        let tool = &golden.tool;
        assert_eq!(tool.name(), golden.name);
        assert_eq!(tool.description(), golden.description, "{}", golden.name);
        assert_eq!(
            serde_json::to_string(&tool.parameters_schema()).unwrap(),
            golden.schema,
            "{}",
            golden.name
        );
        assert_eq!(
            tool.permission_level(),
            golden.permission,
            "{}",
            golden.name
        );
        assert_eq!(tool.exposure(), golden.exposure, "{}", golden.name);
        assert_eq!(
            tool.is_concurrency_safe(&json!({})),
            golden.concurrency_safe,
            "{}",
            golden.name
        );
        assert!(!tool.external_effect(), "{}", golden.name);
        assert_eq!(tool.family(), None, "{}", golden.name);
    }
}

#[tokio::test]
async fn tool_call_refuses_arguments_that_are_not_an_object() {
    let err = McpRegistryToolCallTool::new(cfg())
        .execute(json!({ "server_id": "srv", "tool_name": "t", "arguments": 5 }))
        .await
        .expect_err("a number is not arguments");
    let message = err.to_string();
    assert!(message.contains("mcp_registry_tool_call"), "{message}");
    assert!(message.contains("a number"), "{message}");
}

/// A workspace of its own, so the host this opens is not shared.
fn workspace_config(dir: &std::path::Path) -> Arc<Config> {
    Arc::new(Config {
        workspace_dir: dir.join("workspace"),
        action_dir: dir.join("workspace"),
        config_path: dir.join("config.toml"),
        ..Default::default()
    })
}

/// Answers the MCP handshake and one tool over Streamable HTTP.
struct LoopbackMcp;

impl wiremock::Respond for LoopbackMcp {
    fn respond(&self, request: &wiremock::Request) -> wiremock::ResponseTemplate {
        let body: Value = serde_json::from_slice(&request.body).unwrap_or_default();
        let result = match body["method"].as_str().unwrap_or_default() {
            "initialize" => json!({
                "protocolVersion": tinymcp_bus::LATEST_PROTOCOL_VERSION,
                "capabilities": { "tools": {} },
                "serverInfo": { "name": "loopback", "version": "1.0.0" },
            }),
            "notifications/initialized" => return wiremock::ResponseTemplate::new(202),
            "tools/list" => json!({
                "tools": [{ "name": "forecast", "inputSchema": { "type": "object" } }]
            }),
            "tools/call" => json!({ "content": [{ "type": "text", "text": "sunny" }] }),
            _ => json!({}),
        };
        wiremock::ResponseTemplate::new(200).set_body_json(json!({
            "jsonrpc": "2.0",
            "id": body["id"].clone(),
            "result": result,
        }))
    }
}

#[tokio::test]
async fn tool_call_with_string_arguments_reaches_the_server_as_an_object() {
    // The reported failure: a model called `mcp_registry_tool_call` with
    // `"arguments": "{...}"`, a JSON-encoded string where MCP needs an object.
    let server = wiremock::MockServer::start().await;
    wiremock::Mock::given(wiremock::matchers::method("POST"))
        .respond_with(LoopbackMcp)
        .mount(&server)
        .await;
    let dir = tempfile::tempdir().expect("temp workspace");
    let config = workspace_config(dir.path());
    let host = crate::mcp::host::for_config(&config).expect("host");
    host.dynamic()
        .store()
        .insert_server(&crate::mcp::registry::InstalledServer {
            server_id: "srv-1".into(),
            qualified_name: "loopback".into(),
            display_name: "loopback".into(),
            description: None,
            icon_url: None,
            command_kind: tinymcp_bus::CommandKind::Node,
            command: String::new(),
            args: Vec::new(),
            env_keys: Vec::new(),
            config: None,
            installed_at: 1,
            last_connected_at: None,
            transport: tinymcp_bus::Transport::HttpRemote {
                url: format!("{}/mcp", server.uri()),
            },
            enabled: true,
        })
        .expect("insert");
    McpRegistryConnectTool::new(Arc::clone(&config))
        .execute(json!({ "server_id": "srv-1" }))
        .await
        .expect("connect");

    let result = McpRegistryToolCallTool::new(Arc::clone(&config))
        .execute(json!({
            "server_id": "srv-1",
            "tool_name": "forecast",
            "arguments": "{\"city\":\"Paris\"}"
        }))
        .await
        .expect("call");
    assert!(!result.is_error, "{}", result.text());

    let calls: Vec<Value> = server
        .received_requests()
        .await
        .expect("recording")
        .iter()
        .filter_map(|request| serde_json::from_slice::<Value>(&request.body).ok())
        .filter(|body| body["method"] == "tools/call")
        .collect();
    assert_eq!(calls.len(), 1);
    assert_eq!(calls[0]["params"]["arguments"], json!({ "city": "Paris" }));
}
