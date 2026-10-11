use std::collections::HashSet;

use serde_json::json;
use tinytools::{Tool, ToolExposure, ToolResult};

use super::{deferred_set, deferred_tool_names, strip_deferred_from_visible};

struct Fake(&'static str, ToolExposure);

#[async_trait::async_trait]
impl Tool for Fake {
    fn name(&self) -> &str {
        self.0
    }
    fn description(&self) -> &str {
        "fake"
    }
    fn parameters_schema(&self) -> serde_json::Value {
        json!({"type": "object"})
    }
    fn exposure(&self) -> ToolExposure {
        self.1
    }
    async fn execute(&self, _args: serde_json::Value) -> anyhow::Result<ToolResult> {
        Ok(ToolResult::success("ok"))
    }
}

fn tools() -> Vec<Box<dyn Tool>> {
    vec![
        Box::new(Fake("direct", ToolExposure::Direct)),
        Box::new(Fake("deferred", ToolExposure::Deferred)),
        Box::new(Fake("hidden", ToolExposure::Hidden)),
        Box::new(Fake("unlisted_deferred", ToolExposure::Deferred)),
    ]
}

#[test]
fn strip_removes_deferred_and_hidden_but_returns_only_deferred() {
    let mut visible: HashSet<String> = ["direct", "deferred", "hidden"]
        .into_iter()
        .map(String::from)
        .collect();
    let deferred = strip_deferred_from_visible(&mut visible, &tools());
    assert_eq!(visible, HashSet::from(["direct".to_string()]));
    assert_eq!(deferred, HashSet::from(["deferred".to_string()]));
}

#[test]
fn strip_ignores_tools_the_belt_never_named() {
    let mut visible: HashSet<String> = HashSet::from(["direct".to_string()]);
    let deferred = strip_deferred_from_visible(&mut visible, &tools());
    assert!(deferred.is_empty());
    assert_eq!(visible.len(), 1);
}

#[test]
fn deferred_tool_names_lists_every_deferred_registration() {
    assert_eq!(
        deferred_tool_names(&tools()),
        HashSet::from(["deferred".to_string(), "unlisted_deferred".to_string()])
    );
}

/// An agent definition's `deferred_tools` adds its `Direct` tools to the
/// deferred set, on top of every `Deferred` registration in both sets. A
/// requested name that is not registered, or is `Hidden`, is ignored: deferral
/// only subtracts, so it can neither invent a tool nor make a hidden one
/// searchable.
#[test]
fn deferred_set_adds_requested_direct_tools_and_nothing_else() {
    let durable = tools();
    let synthesized: Vec<Box<dyn Tool>> = vec![
        Box::new(Fake("synth_direct", ToolExposure::Direct)),
        Box::new(Fake("synth_deferred", ToolExposure::Deferred)),
    ];
    let requested: Vec<String> = ["direct", "synth_direct", "hidden", "not_registered"]
        .into_iter()
        .map(String::from)
        .collect();
    let set = deferred_set(&durable, &synthesized, &requested);
    let expected: HashSet<String> = [
        "direct",
        "synth_direct",
        "deferred",
        "unlisted_deferred",
        "synth_deferred",
    ]
    .into_iter()
    .map(String::from)
    .collect();
    assert_eq!(set, expected);

    // Nothing requested: exactly the exposure-derived set.
    let plain = deferred_set(&durable, &synthesized, &[]);
    assert!(!plain.contains("direct") && !plain.contains("synth_direct"));
    assert!(plain.contains("synth_deferred") && plain.contains("deferred"));
}
