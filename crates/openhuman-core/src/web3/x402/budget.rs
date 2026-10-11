//! Where the x402 spending limits come from.
//!
//! The crate owns the budget type and its defaults (1 / 10 / 100 USDC per
//! request / day / month); which limits a process runs with is host policy, so
//! the `OPENHUMAN_X402_*` environment overrides are read here.

use log::debug;
use tinywallet_x402::ledger::SpendingBudget;

const LOG_PREFIX: &str = "[x402::budget]";

/// Override for [`SpendingBudget::per_request_max_atomic`].
const ENV_PER_REQUEST_MAX: &str = "OPENHUMAN_X402_PER_REQUEST_MAX";
/// Override for [`SpendingBudget::daily_max_atomic`].
const ENV_DAILY_MAX: &str = "OPENHUMAN_X402_DAILY_MAX";
/// Override for [`SpendingBudget::monthly_max_atomic`].
const ENV_MONTHLY_MAX: &str = "OPENHUMAN_X402_MONTHLY_MAX";

/// The crate's default budget with the process environment's overrides applied.
pub(crate) fn budget_from_env() -> SpendingBudget {
    budget_from(|name| std::env::var(name).ok())
}

/// [`budget_from_env`] over an arbitrary variable lookup, so the override rules
/// are testable without touching the process environment.
///
/// A value that is not a base-10 `u64` is ignored and the default stays.
pub(crate) fn budget_from(get: impl Fn(&str) -> Option<String>) -> SpendingBudget {
    let mut budget = SpendingBudget::default();
    let apply = |name: &str, label: &str, slot: &mut u64| {
        if let Some(n) = get(name).and_then(|v| v.parse::<u64>().ok()) {
            debug!("{LOG_PREFIX} env override {label}={n}");
            *slot = n;
        }
    };
    apply(
        ENV_PER_REQUEST_MAX,
        "per_request_max",
        &mut budget.per_request_max_atomic,
    );
    apply(ENV_DAILY_MAX, "daily_max", &mut budget.daily_max_atomic);
    apply(
        ENV_MONTHLY_MAX,
        "monthly_max",
        &mut budget.monthly_max_atomic,
    );
    budget
}

#[cfg(test)]
#[path = "budget_tests.rs"]
mod tests;
