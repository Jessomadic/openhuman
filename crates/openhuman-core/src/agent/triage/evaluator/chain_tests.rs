use super::*;

#[test]
fn dropped_attempt_releases_in_flight_state() {
    let state = RetryState::default();
    let generation = begin_outage_attempt(Some(&state), "stub-cloud").expect("attempt");
    drop(OutageAttempt {
        state: &state,
        key: "stub-cloud",
        generation,
    });

    assert!(!state.lock().expect("retry state")["stub-cloud"].in_flight);
}

#[test]
fn only_one_initial_outage_attempt_can_be_in_flight() {
    let state = RetryState::default();

    assert!(begin_outage_attempt(Some(&state), "stub-cloud").is_some());
    assert!(begin_outage_attempt(Some(&state), "stub-cloud").is_none());
}

#[test]
fn failed_attempt_after_concurrent_recovery_does_not_become_terminal() {
    let state = RetryState::default();
    let generation = begin_outage_attempt(Some(&state), "stub-cloud").expect("attempt");

    clear_outage(Some(&state), "stub-cloud", Some(generation));

    assert!(matches!(
        record_outage(Some(&state), "stub-cloud", Some(generation)),
        Some(TriageOutcome::Deferred { .. })
    ));
}
