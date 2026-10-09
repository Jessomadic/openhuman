use super::*;
use crate::security::approval::store as live;
use crate::security::approval::types::{
    ApprovalDecision, ApprovalSourceContext, ExecutionOutcome, PendingApproval,
};
use crate::storage::local::{forget, table_names};
use chrono::{Duration, Utc};
use serde_json::json;
use tempfile::TempDir;

fn workspace() -> (TempDir, Config, Config) {
    let dir = TempDir::new().unwrap();
    let mut classic = Config {
        workspace_dir: dir.path().to_path_buf(),
        ..Config::default()
    };
    classic.storage.url = Some("classic".into());
    let default = Config {
        workspace_dir: dir.path().to_path_buf(),
        ..Config::default()
    };
    (dir, classic, default)
}

fn request(id: &str, expires_in: i64) -> PendingApproval {
    PendingApproval {
        request_id: id.to_string(),
        tool_name: "composio".to_string(),
        action_summary: format!("summary {id}"),
        args_redacted: json!({ "action": "execute", "id": id }),
        created_at: Utc::now(),
        expires_at: Some(Utc::now() + Duration::minutes(expires_in)),
        source_context: Some(ApprovalSourceContext::Flow {
            flow_id: "flow-1".into(),
            run_id: "run-1".into(),
            node_id: None,
        }),
        tool_call_id: Some(format!("call-{id}")),
        agent_id: Some("agent-7".into()),
    }
}

#[test]
fn legacy_rows_are_imported_once_through_the_public_api() {
    let (_dir, classic, default) = workspace();
    // Build the legacy database with the legacy code.
    live::insert_pending(&classic, &request("pending-1", 10), "sess").unwrap();
    live::insert_pending(&classic, &request("approved-1", 10), "sess").unwrap();
    live::insert_pending(&classic, &request("denied-1", 10), "sess").unwrap();
    live::insert_pending(&classic, &request("stale-1", -5), "sess").unwrap();
    live::decide(&classic, "approved-1", ApprovalDecision::Approve).unwrap();
    live::record_execution(&classic, "approved-1", ExecutionOutcome::Success, None).unwrap();
    live::decide(&classic, "denied-1", ApprovalDecision::Deny).unwrap();
    live::insert_flow_trust(&classic, "flow-1", "shell").unwrap();
    live::insert_flow_trust(&classic, "flow-1", "http").unwrap();
    live::record_flow_preauthorization(&classic, "flow-2", "shell", "sess").unwrap();
    let db = live::db_path(&classic);
    assert!(table_names(&db).contains(&"pending_approvals".to_string()));

    // The default opens the same file and sees every row.
    let pending = live::list_pending(&default).unwrap();
    let mut ids: Vec<_> = pending.iter().map(|p| p.request_id.as_str()).collect();
    ids.sort_unstable();
    assert_eq!(ids, ["pending-1", "stale-1"]);
    let first = pending.iter().find(|p| p.request_id == "pending-1").unwrap();
    assert_eq!(first.tool_name, "composio");
    assert_eq!(first.action_summary, "summary pending-1");
    assert_eq!(first.args_redacted["id"], "pending-1");
    assert_eq!(first.tool_call_id.as_deref(), Some("call-pending-1"));
    assert_eq!(first.agent_id.as_deref(), Some("agent-7"));
    assert!(matches!(
        first.source_context,
        Some(ApprovalSourceContext::Flow { ref flow_id, .. }) if flow_id == "flow-1"
    ));
    assert_eq!(
        live::get_decision(&default, "approved-1").unwrap(),
        Some(ApprovalDecision::Approve)
    );
    assert_eq!(
        live::get_decision(&default, "denied-1").unwrap(),
        Some(ApprovalDecision::Deny)
    );
    let audit = live::list_recent_decisions(&default, 10).unwrap();
    let mut audited: Vec<_> = audit.iter().map(|a| a.decision).collect();
    audited.sort_by_key(|d| d.as_str());
    assert_eq!(audit.len(), 3, "approve, deny and the flow pre-authorization");
    assert!(audited.contains(&ApprovalDecision::ApproveAlwaysForFlow));
    assert!(live::is_flow_tool_trusted(&default, "flow-1", "shell").unwrap());
    assert!(live::is_flow_tool_trusted(&default, "flow-1", "http").unwrap());
    assert!(!live::is_flow_tool_trusted(&default, "flow-2", "http").unwrap());
    // The expiry key was imported: the stale request expires.
    assert_eq!(live::expire_stale(&default).unwrap(), 1);

    // The old tables are kept under their retired names.
    let tables = table_names(&db);
    assert!(tables.contains(&"_legacy_pending_approvals".to_string()));
    assert!(tables.contains(&"_legacy_flow_tool_trust".to_string()));
    assert!(!tables.contains(&"pending_approvals".to_string()));
    let conn = rusqlite::Connection::open(&db).unwrap();
    let kept: i64 = conn
        .query_row("SELECT COUNT(*) FROM _legacy_pending_approvals", [], |r| {
            r.get(0)
        })
        .unwrap();
    assert_eq!(kept, 5);

    // A restart does not import again: a change made since stays made.
    live::decide(&default, "pending-1", ApprovalDecision::Deny).unwrap();
    forget(&db);
    assert_eq!(
        live::get_decision(&default, "pending-1").unwrap(),
        Some(ApprovalDecision::Deny)
    );
    assert!(live::list_pending(&default).unwrap().is_empty());
}

#[test]
fn a_workspace_with_no_legacy_file_starts_empty() {
    let (_dir, _classic, default) = workspace();
    assert!(live::list_pending(&default).unwrap().is_empty());
    assert!(!table_names(&live::db_path(&default))
        .iter()
        .any(|t| t.starts_with("_legacy_")));
}

#[test]
fn the_classic_opt_out_keeps_the_legacy_tables() {
    let (_dir, classic, _default) = workspace();
    live::insert_pending(&classic, &request("a", 10), "sess").unwrap();
    assert_eq!(live::list_pending(&classic).unwrap().len(), 1);
    assert!(table_names(&live::db_path(&classic)).contains(&"pending_approvals".to_string()));
}
