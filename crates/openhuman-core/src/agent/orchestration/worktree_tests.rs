//! Host-typed tests for the worktree wire contract.
//!
//! The git-worktree plumbing itself is tested in
//! `vendor/tinyagents/crates/tinyagents-harness/src/workspace/git/test.rs`.

use tinyagents_harness::workspace::GitWorktreeStatus;

/// Pins the JSON-RPC wire shape of [`GitWorktreeStatus`].
///
/// `worktree_schemas.rs` serializes this type straight to the desktop UI, so a
/// renamed or dropped field surfaces as an empty worktree panel rather than a
/// failing test. This asserts the exact camelCase key set and value shapes so
/// the type can be re-pointed at the TinyAgents `GitWorktreeStatus` without
/// silently changing the contract.
#[test]
fn worktree_status_serializes_with_stable_camel_case_keys() {
    let status = GitWorktreeStatus {
        path: std::path::PathBuf::from("/tmp/repo/.claude/worktrees/run-1"),
        branch: Some("agent/run-1".to_string()),
        is_dirty: true,
        changed_files: vec![
            std::path::PathBuf::from("src/a.rs"),
            std::path::PathBuf::from("src/b.rs"),
        ],
    };

    let value = serde_json::to_value(&status).expect("GitWorktreeStatus serializes");
    let object = value.as_object().expect("serializes to a JSON object");

    let mut keys: Vec<&str> = object.keys().map(String::as_str).collect();
    keys.sort_unstable();
    assert_eq!(
        keys,
        vec!["branch", "changedFiles", "isDirty", "path"],
        "worktree status wire keys changed — the desktop worktree panel reads these"
    );

    assert_eq!(value["path"], "/tmp/repo/.claude/worktrees/run-1");
    assert_eq!(value["branch"], "agent/run-1");
    assert_eq!(value["isDirty"], true);
    assert_eq!(
        value["changedFiles"],
        serde_json::json!(["src/a.rs", "src/b.rs"])
    );

    // A detached worktree serializes `branch` as null, not as an omitted key.
    let detached = GitWorktreeStatus {
        branch: None,
        ..status
    };
    let detached_value = serde_json::to_value(&detached).expect("serializes");
    assert!(
        detached_value.as_object().unwrap().contains_key("branch"),
        "branch must stay present-and-null so the UI can distinguish detached HEAD"
    );
    assert_eq!(detached_value["branch"], serde_json::Value::Null);
}
