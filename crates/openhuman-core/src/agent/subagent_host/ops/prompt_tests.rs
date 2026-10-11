use super::*;

#[test]
fn other_agents_get_role_contract_suffix() {
    let out = append_subagent_role_contract("body".to_string(), "researcher");
    assert!(out.contains("Sub-agent Result Contract"));
    assert!(out.contains("Recommended next step"));
}
