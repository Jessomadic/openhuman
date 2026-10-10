//! OpenHuman's latency and call budget for optional memory in a chat turn.

use std::collections::{HashMap, VecDeque};
use std::future::Future;
use std::sync::Mutex;
use std::time::Duration;
use tinytools::ToolResult;

const CALL_TIMEOUT: Duration = Duration::from_secs(15);
const RUN_TIME_BUDGET: Duration = Duration::from_secs(30);
const MAX_CALLS: usize = 8;
const MAX_TRACKED_RUNS: usize = 128;
const CONTINUE: &str = "Continue answering the user's request without memory. Do not retry memory in this run. A timed-out write may already have been accepted; do not claim it failed or repeat it.";

#[derive(Default)]
pub(super) struct ToolBudget {
    runs: Mutex<Runs>,
}

#[derive(Default)]
struct Runs {
    states: HashMap<String, RunBudget>,
    order: VecDeque<String>,
}

struct RunBudget {
    calls: usize,
    remaining: Duration,
    disabled: bool,
}

impl Default for RunBudget {
    fn default() -> Self {
        Self {
            calls: 0,
            remaining: RUN_TIME_BUDGET,
            disabled: false,
        }
    }
}

impl ToolBudget {
    // Reserve time before polling the operation, so parallel reads share the
    // same budget. Return unused time on completion; never hold a lock across
    // engine I/O. State is scoped to a harness run, not to the conversation.
    fn reserve(&self, run_id: Option<&str>) -> Result<Duration, ToolResult> {
        let Some(run_id) = run_id else {
            return Ok(CALL_TIMEOUT);
        };
        let mut runs = self
            .runs
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner);
        if !runs.states.contains_key(run_id) {
            if runs.order.len() == MAX_TRACKED_RUNS {
                if let Some(oldest) = runs.order.pop_front() {
                    runs.states.remove(&oldest);
                }
            }
            runs.order.push_back(run_id.to_string());
        }
        let state = runs.states.entry(run_id.to_string()).or_default();
        if state.disabled || state.calls >= MAX_CALLS || state.remaining.is_zero() {
            return Err(ToolResult::error(format!(
                "Memory budget exhausted for this run. {CONTINUE}"
            )));
        }
        state.calls += 1;
        let allowance = state.remaining.min(CALL_TIMEOUT);
        state.remaining -= allowance;
        Ok(allowance)
    }

    /// Bounds optional memory work. A timeout opens the circuit for this run;
    /// the next run gets a fresh budget. Unscoped callers still get a deadline.
    pub(super) async fn run(
        &self,
        run_id: Option<String>,
        action: impl Future<Output = ToolResult>,
    ) -> ToolResult {
        let allowance = match self.reserve(run_id.as_deref()) {
            Ok(allowance) => allowance,
            Err(result) => return result,
        };
        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(allowance, action).await;
        if let Some(run_id) = run_id.as_deref() {
            let mut runs = self
                .runs
                .lock()
                .unwrap_or_else(std::sync::PoisonError::into_inner);
            if let Some(state) = runs.states.get_mut(run_id) {
                state.remaining += allowance.saturating_sub(started.elapsed());
                state.disabled |= result.is_err();
            }
        }
        result.unwrap_or_else(|_| ToolResult::error(format!(
            "Memory did not finish within its latency budget and is unavailable for this run. {CONTINUE}"
        )))
    }
}

#[cfg(test)]
#[path = "tool_budget_tests.rs"]
mod tests;
