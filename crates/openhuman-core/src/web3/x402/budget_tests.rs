use super::*;

fn env<'a>(pairs: &'a [(&'a str, &'a str)]) -> impl Fn(&str) -> Option<String> + 'a {
    move |name| {
        pairs
            .iter()
            .find(|(k, _)| *k == name)
            .map(|(_, v)| (*v).to_string())
    }
}

#[test]
fn no_overrides_gives_the_crate_defaults() {
    assert_eq!(budget_from(env(&[])), SpendingBudget::default());
}

#[test]
fn each_variable_overrides_only_its_own_limit() {
    let budget = budget_from(env(&[
        ("OPENHUMAN_X402_PER_REQUEST_MAX", "111"),
        ("OPENHUMAN_X402_MONTHLY_MAX", "333"),
    ]));
    assert_eq!(budget.per_request_max_atomic, 111);
    assert_eq!(
        budget.daily_max_atomic,
        SpendingBudget::default().daily_max_atomic
    );
    assert_eq!(budget.monthly_max_atomic, 333);

    let budget = budget_from(env(&[("OPENHUMAN_X402_DAILY_MAX", "222")]));
    assert_eq!(budget.daily_max_atomic, 222);
}

#[test]
fn a_value_that_is_not_a_u64_is_ignored() {
    let budget = budget_from(env(&[
        ("OPENHUMAN_X402_PER_REQUEST_MAX", "one usdc"),
        ("OPENHUMAN_X402_DAILY_MAX", "-5"),
        ("OPENHUMAN_X402_MONTHLY_MAX", ""),
    ]));
    assert_eq!(budget, SpendingBudget::default());
}
