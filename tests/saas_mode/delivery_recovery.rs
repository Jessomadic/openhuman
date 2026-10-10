//! A detached sub-agent's result survives a restart and reaches the profile
//! that spawned it, through the real binary.
//!
//! `ann` spawns a detached sub-agent on a thread whose turn then stays in
//! flight ([`HANG_AFTER_TOOL`]), so the finished result is recorded but
//! held: delivery never runs into a busy thread. The core is then killed
//! (SIGKILL: no shutdown hook, no delivery). `bob` has a thread with the same
//! id on the same core.
//!
//! After a restart nothing is delivered at boot: profiles are opened lazily.
//! Opening `ann`'s profile (`ProfileHost::open` → `recover_on_open`) must
//! deliver the result into `ann`'s thread, under `ann`'s credential; opening
//! `bob`'s first, and the whole recovery, must leave `bob`'s thread of the
//! same id untouched.

use std::path::Path;

use super::mock_llm::{mock_llm, MockLlm, HANG_AFTER_TOOL, PROBE};
use super::*;

const OWNER: &str = "ann";
const OTHER: &str = "bob";
const THREAD: &str = "shared-thread";
/// Unique to the sub-agent's task. The mock answers the sub-agent with
/// `ECHO: <its prompt>`, so [`result`] appears only once the sub-agent ran.
const MARKER: &str = "delivery-ann-7c1e";

fn task() -> String {
    format!("SUBTASK {MARKER}")
}

/// The sub-agent's answer, as the mock writes it.
fn result() -> String {
    format!("ECHO: {}", task())
}

fn node_logging(d: &Deployment, backend: u16) -> Node {
    start_node_logging(
        d,
        "1",
        None,
        "",
        Some(backend),
        "info,openhuman_core::agent::orchestration=debug",
    )
}

fn messages(node: &Node, user: &str) -> String {
    let (status, _, body) = call(
        node,
        user,
        "openhuman.threads_messages_list",
        json!({ "thread_id": THREAD }),
    );
    assert_eq!(status, 200, "{user} lists {THREAD}: {body}");
    assert!(body.get("result").is_some(), "{user} lists {THREAD}: {body}");
    body.to_string()
}

/// Whether some `background_completions.jsonl` under `root` holds `text`.
fn completion_log_holds(root: &Path, text: &str) -> bool {
    let Ok(entries) = std::fs::read_dir(root) else {
        return false;
    };
    entries.flatten().any(|entry| {
        let path = entry.path();
        if path.is_dir() {
            completion_log_holds(&path, text)
        } else {
            path.file_name()
                .is_some_and(|name| name == "background_completions.jsonl")
                && std::fs::read_to_string(&path).is_ok_and(|log| log.contains(text))
        }
    })
}

/// Inference requests carrying the sub-agent's result, by credential.
fn result_requests(llm: &MockLlm) -> Vec<String> {
    llm.recorded()
        .into_iter()
        .filter(|r| r.is_inference() && r.body.contains(&result()))
        .map(|r| r.auth)
        .collect()
}

#[test]
fn a_held_subagent_result_reaches_its_own_profile_after_a_restart() {
    let d = deployment(true);
    let llm = mock_llm();
    let mut node = node_logging(&d, llm.port);
    provision_with_credential(&node, OWNER);
    provision_with_credential(&node, OTHER);

    // bob holds a thread with the same id, with a finished turn of his own.
    let (status, _, body) = call(
        &node,
        OTHER,
        "openhuman.channel_web_chat",
        json!({ "client_id": "c1", "thread_id": THREAD, "message": "bob's own words" }),
    );
    assert_eq!(status, 200, "{body}");
    wait_until("bob's turn", &node, Duration::from_secs(60), || {
        messages(&node, OTHER).contains("ECHO: bob's own words")
    });

    // ann's turn spawns a detached sub-agent, then stays in flight.
    let args = json!({ "agent_id": "task_manager_agent", "prompt": task() });
    let message = format!("{PROBE} spawn_async_subagent {args}\n{HANG_AFTER_TOOL}");
    let (status, _, body) = call(
        &node,
        OWNER,
        "openhuman.channel_web_chat",
        json!({ "client_id": "c1", "thread_id": THREAD, "message": message }),
    );
    assert_eq!(status, 200, "{body}");
    assert!(body.get("result").is_some(), "{body}");

    // The sub-agent finishes and its result is recorded, but not delivered:
    // ann's turn on the thread is still running.
    wait_until(
        "the sub-agent's recorded result",
        &node,
        Duration::from_secs(90),
        || completion_log_holds(&d.root, &result()),
    );
    assert!(
        active(&node, OWNER, THREAD),
        "ann's turn stays in flight while the result is held"
    );
    assert!(
        !messages(&node, OWNER).contains(&result()),
        "the result is held while ann's turn runs"
    );
    let before = node.log_tail();
    node.kill();

    // Restart. Nothing is open until a user calls.
    let node = node_logging(&d, llm.port);
    let bob_before = messages(&node, OTHER);
    assert!(!bob_before.contains(MARKER), "{bob_before}");

    // Opening ann's profile recovers the held result into ann's thread.
    wait_until(
        "the recovered delivery into ann's thread",
        &node,
        Duration::from_secs(120),
        || messages(&node, OWNER).contains(&result()),
    );

    // Give any stray drain time to land, then check bob is untouched.
    std::thread::sleep(Duration::from_secs(5));
    let bob_after = messages(&node, OTHER);
    assert!(
        !bob_after.contains(MARKER),
        "ann's result reached bob's thread of the same id: {bob_after}"
    );
    assert_eq!(
        bob_before, bob_after,
        "recovery changed bob's thread of the same id"
    );

    // Every inference request that carried the result ran as ann.
    let carriers = result_requests(&llm);
    assert!(!carriers.is_empty(), "the result went through inference");
    for auth in &carriers {
        assert!(
            auth.contains(&format!("{OWNER}-jwt")),
            "ann's result was sent under another credential (before kill:\n{before}\n)"
        );
    }
}
