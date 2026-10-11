use super::super::dispatcher::{resolve_dispatcher_kind, DispatcherKind};
use super::provider_role_for;

#[test]
fn legacy_orchestrator_fallback_defaults_to_chat() {
    assert_eq!(provider_role_for(Some("chat-v1")), "chat");
    assert_eq!(provider_role_for(None), "chat");
    // A legacy heavy default_model tier still falls through to chat.
    assert_eq!(provider_role_for(Some("reasoning-v1")), "chat");
}

#[test]
fn explicit_hints_route_to_workload() {
    assert_eq!(provider_role_for(Some("hint:agentic")), "agentic");
    assert_eq!(provider_role_for(Some("hint:reasoning")), "reasoning");
    assert_eq!(provider_role_for(Some("hint:coding")), "coding");
}

#[test]
fn auto_prefers_native_when_supported_never_pformat() {
    assert_eq!(
        resolve_dispatcher_kind("auto", true),
        DispatcherKind::Native
    );
    // Text-only provider defaults to JSON-in-tag, NOT P-Format.
    assert_eq!(resolve_dispatcher_kind("auto", false), DispatcherKind::Xml);
    // An unrecognized value behaves like "auto".
    assert_eq!(resolve_dispatcher_kind("bogus", false), DispatcherKind::Xml);
}

#[test]
fn explicit_choices_are_honoured_including_opt_in_pformat() {
    assert_eq!(
        resolve_dispatcher_kind("native", false),
        DispatcherKind::Native
    );
    assert_eq!(resolve_dispatcher_kind("xml", true), DispatcherKind::Xml);
    // P-Format is only ever selected when explicitly requested.
    assert_eq!(
        resolve_dispatcher_kind("pformat", true),
        DispatcherKind::PFormat
    );
    // So are the code dialects.
    assert_eq!(
        resolve_dispatcher_kind("python", true),
        DispatcherKind::Code(tinytools_agent::dialect::CodeStyle::Python)
    );
    assert_eq!(
        resolve_dispatcher_kind("typescript", false),
        DispatcherKind::Code(tinytools_agent::dialect::CodeStyle::TypeScript)
    );
}
