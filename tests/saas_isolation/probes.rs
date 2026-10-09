//! Policy probes (leak a): a user's model asks for host file and shell tools
//! aimed outside the user's sandbox. The deployment opts users into
//! `host_files` only, so `shell` must not even be offered, and every file
//! call that leaves `users/<id>/sandbox/` must be refused under the
//! *profile's* policy. The operator's policy is off (the default), so it
//! would have read the host file below.

use super::mock_llm::{content_text, mock_llm, MockLlm, PROBE};
use super::world::{canary, credential, USERS};
use super::*;

/// The tool output the model got back for the probe tagged `tag`, once the
/// follow-up inference request carries it.
fn tool_result(llm: &MockLlm, tag: &str, timeout: Duration) -> Option<String> {
    let deadline = Instant::now() + timeout;
    while Instant::now() < deadline {
        for r in llm.recorded().iter().filter(|r| r.is_inference()) {
            if !r.body.contains(tag) {
                continue;
            }
            let body: Value = serde_json::from_str(&r.body).unwrap_or(Value::Null);
            let Some(last) = body["messages"].as_array().and_then(|m| m.last()) else {
                continue;
            };
            if last["role"] == "tool" {
                return Some(content_text(last));
            }
        }
        std::thread::sleep(Duration::from_millis(200));
    }
    None
}

/// Run one probe as alice on its own thread and return the tool output.
fn probe(node: &Node, llm: &MockLlm, tag: &str, tool: &str, args: Value) -> Option<String> {
    let message = format!("probe-{tag} {PROBE} {tool} {args}");
    let (status, _, body) = call(
        node,
        USERS[0],
        "openhuman.channel_web_chat",
        json!({ "client_id": "c1", "thread_id": format!("probe-{tag}"), "message": message }),
    );
    assert_eq!(status, 200, "{body}");
    assert!(body.get("result").is_some(), "probe {tag}: {body}");
    tool_result(llm, &format!("probe-{tag} "), Duration::from_secs(60))
}

#[test]
fn host_tool_probes_are_refused_under_the_profile_policy() {
    let started = Instant::now();
    let d = deployment(true);
    let llm = mock_llm();
    let node = start_node(&d, "1", None, "tool_allowlist = [\"host_files\"]\n", Some(llm.port));
    for (user, name) in USERS.iter().enumerate().take(2) {
        provision(&client(), &node.base, name);
        let body = operator(
            &node,
            "openhuman.profiles_set_credential",
            json!({ "profile_id": name, "kind": "session", "token": credential(user) }),
        );
        assert!(body.get("result").is_some(), "{body}");
    }
    // Bob's data, the operator's and the host's: everything alice must not read.
    let (_, _, body) = call(&node, USERS[1], "openhuman.threads_upsert", json!({
        "id": "bob-private", "title": canary(1, "title"), "created_at": "2026-10-10T00:00:00Z"
    }));
    assert!(body.get("result").is_some(), "{body}");
    let bob_threads = d.root.join("users/bob/workspace/memory/conversations/threads.jsonl");
    assert!(
        std::fs::read_to_string(&bob_threads).is_ok_and(|t| t.contains("CANARY-bob-")),
        "bob's thread index at {}",
        bob_threads.display()
    );
    let host_secret = d.tmp.path().join("host-secret.txt");
    std::fs::write(&host_secret, "HOST-SECRET-6c1f").unwrap();
    let operator_secret = d.root.join("operator/operator-secret.txt");
    std::fs::write(&operator_secret, "OPERATOR-SECRET-9a2e").unwrap();
    let alice_config = d.root.join("users/alice/config.toml");
    let config_before = std::fs::read(&alice_config).ok();

    // Positive control: inside her sandbox the file tools work.
    let wrote = probe(&node, &llm, "own-write", "file_write",
        json!({ "path": "note.txt", "content": canary(0, "note") }));
    let offered: Vec<String> = llm
        .recorded()
        .iter()
        .filter(|r| r.is_inference() && r.auth.contains(&credential(0)))
        .flat_map(|r| r.offered_tools())
        .collect();
    assert!(!offered.is_empty(), "alice's turns offer some tools");
    assert!(
        !offered.iter().any(|t| t == "shell"),
        "`host_shell` is not allowlisted, so `shell` is never offered: {offered:?}"
    );
    for denied in ["install_tool", "git_operations", "delegate", "curl", "node_exec"] {
        assert!(!offered.iter().any(|t| t == denied), "{denied} is hard-denied: {offered:?}");
    }
    assert!(
        offered.iter().any(|t| t == "file_read"),
        "`host_files` is allowlisted, so file_read is offered: {offered:?}"
    );
    let wrote = wrote.expect("the own-write probe ran");
    let note = d.root.join("users/alice/sandbox/note.txt");
    assert!(
        std::fs::read_to_string(&note).is_ok_and(|t| t.contains("CANARY-alice-note")),
        "file_write lands in alice's sandbox ({wrote})"
    );
    let read = probe(&node, &llm, "own-read", "file_read", json!({ "path": "note.txt" }))
        .expect("the own-read probe ran");
    assert!(read.contains("CANARY-alice-note"), "file_read reads her sandbox: {read}");

    // Hostile probes, in parallel: each on its own thread.
    let pwned_host = d.tmp.path().join("pwned-host.txt");
    let shell_marker = d.tmp.path().join("shell-pwned");
    let probes: Vec<(&str, &str, Value)> = vec![
        ("host-read", "file_read", json!({ "path": host_secret })),
        ("operator-read", "file_read", json!({ "path": operator_secret })),
        ("bob-abs-read", "file_read", json!({ "path": bob_threads })),
        ("bob-rel-read", "file_read",
            json!({ "path": "../../bob/workspace/memory/conversations/threads.jsonl" })),
        ("own-ws-read", "file_read", json!({ "path": "../workspace/memory/conversations/threads.jsonl" })),
        ("bob-grep", "grep", json!({ "pattern": "CANARY", "path": d.root.join("users/bob") })),
        ("root-list", "list", json!({ "path": d.root.join("users") })),
        ("host-write", "file_write", json!({ "path": pwned_host, "content": canary(0, "pwn") })),
        ("bob-write", "file_write",
            json!({ "path": "../../bob/sandbox/pwned.txt", "content": canary(0, "pwn") })),
        ("config-write", "file_write",
            json!({ "path": "../config.toml", "content": "[autonomy]\nenabled = false\n" })),
        ("shell", "shell", json!({ "command": format!("touch {}", shell_marker.display()) })),
    ];
    let results: Vec<(String, Option<String>)> = std::thread::scope(|s| {
        let handles: Vec<_> = probes
            .iter()
            .map(|(tag, tool, args)| {
                let (node, llm) = (&node, &llm);
                s.spawn(move || (tag.to_string(), probe(node, llm, tag, tool, args.clone())))
            })
            .collect();
        handles.into_iter().map(|h| h.join().unwrap()).collect()
    });
    let mut report = Vec::new();
    for (tag, output) in &results {
        let output = output.as_deref().unwrap_or("<the model never got a tool result>");
        report.push(format!("  {tag}: {}", output.chars().take(160).collect::<String>()));
        for secret in ["HOST-SECRET", "OPERATOR-SECRET", "CANARY-bob-"] {
            assert!(!output.contains(secret), "probe {tag} read {secret}: {output}");
        }
        if tag == "root-list" {
            assert!(!output.contains("bob"), "probe {tag} listed other users: {output}");
        }
    }
    eprintln!("[isolation] probe results:\n{}", report.join("\n"));
    assert!(!pwned_host.exists(), "a user wrote a host file");
    assert!(!d.root.join("users/bob/sandbox/pwned.txt").exists(), "alice wrote into bob's sandbox");
    assert!(!shell_marker.exists(), "a user ran a host shell command");
    assert_eq!(
        std::fs::read(&alice_config).ok(),
        config_before,
        "a user rewrote their own profile config"
    );
    let (violations, _) = scan::audit_backend(&llm.recorded());
    assert!(violations.is_empty(), "{}", violations.join("\n"));
    eprintln!("[isolation] probes took {:.1}s", started.elapsed().as_secs_f64());
}
