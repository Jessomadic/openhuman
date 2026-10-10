use tinyagents_harness::host::security_gate::GateDecision;

use crate::security::approval::GateOutcome;

use super::unanswered_approval_text;

/// Convert the approval flow's terminal outcome into the host gate decision.
///
/// Expired approval is distinct from an explicit refusal so the model can tell
/// the user that a new request is needed. Refusals deliberately omit the
/// policy-denial marker, which would stop the turn before the model can explain
/// what happened.
pub(super) fn decision_for_outcome(tool_name: &str, outcome: GateOutcome) -> GateDecision {
    match outcome {
        GateOutcome::Allow => GateDecision::Prompted { approved: true },
        GateOutcome::Deny { reason }
            if crate::security::approval::is_unanswered_approval_reason(&reason) =>
        {
            tracing::warn!(
                target: "tinyagents",
                tool = %tool_name,
                "[tinyagents::host::security] approval prompt expired unanswered"
            );
            GateDecision::deny(unanswered_approval_text(tool_name))
        }
        GateOutcome::Deny { reason } => {
            tracing::warn!(
                target: "tinyagents",
                tool = %tool_name,
                reason = %reason,
                "[tinyagents::host::security] approval flow declined the tool call"
            );
            GateDecision::deny(
                "This action was refused and must not be performed this turn — do not retry this \
                 call and do not achieve the same result another way (shell, CLI, another tool). \
                 Tell the user it was not done.",
            )
        }
    }
}
