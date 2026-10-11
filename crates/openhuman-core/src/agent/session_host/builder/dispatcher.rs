//! Which tool-call dialect a session speaks to its provider, resolved from
//! the configured `agent.tool_dispatcher` choice and the provider's native
//! tool support.

use tinytools_agent::dialect::CodeStyle;

/// Which tool-call dialect a session speaks to its provider.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub(super) enum DispatcherKind {
    /// Provider-native structured function calling (JSON tool specs on the wire).
    Native,
    /// JSON-in-tag: `<tool_call>{"name":…,"arguments":{…}}</tool_call>` in text.
    Xml,
    /// Compact positional P-Format (`tool[a|b]`) — opt-in only.
    PFormat,
    /// Code-style calls against Python or TypeScript signatures — opt-in only.
    Code(CodeStyle),
}

/// Pick the tool-call dialect from the configured `agent.tool_dispatcher`
/// choice and the provider's native-tool support.
///
/// `"auto"` (and any unrecognized value) resolves to native when the provider
/// supports it, otherwise JSON-in-tag — **never** P-Format or a code dialect,
/// which are opt-in (`"pformat"`, `"python"`, `"typescript"`) because their
/// compact syntaxes mis-parse on some models.
pub(super) fn resolve_dispatcher_kind(
    dispatcher_choice: &str,
    supports_native: bool,
) -> DispatcherKind {
    match dispatcher_choice {
        "native" => DispatcherKind::Native,
        "xml" => DispatcherKind::Xml,
        "pformat" => DispatcherKind::PFormat,
        "python" => DispatcherKind::Code(CodeStyle::Python),
        "typescript" => DispatcherKind::Code(CodeStyle::TypeScript),
        _ if supports_native => DispatcherKind::Native,
        _ => DispatcherKind::Xml,
    }
}
