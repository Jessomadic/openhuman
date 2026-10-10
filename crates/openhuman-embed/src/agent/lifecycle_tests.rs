use super::*;
use std::sync::Arc;

fn removed(outcome: Result<(), CoreError>) -> bool {
    matches!(outcome, Err(CoreError::AgentRemoved { ref agent_id, .. }) if agent_id == "a")
}

#[tokio::test]
async fn a_live_agent_runs_its_turns() {
    let lifecycle = Lifecycle::new();
    let outcome = lifecycle.admit("a", "test", async { Ok(7) }).await;
    assert_eq!(outcome.unwrap(), 7);
    assert!(lifecycle.wait_idle(Duration::from_millis(10)).await);
}

#[tokio::test]
async fn a_removed_agent_refuses_new_turns() {
    let lifecycle = Lifecycle::new();
    lifecycle.mark_removed();
    let ran = Arc::new(AtomicBool::new(false));
    let flag = Arc::clone(&ran);
    let outcome = lifecycle
        .admit("a", "test", async move {
            flag.store(true, Ordering::SeqCst);
            Ok(())
        })
        .await;
    assert!(removed(outcome));
    assert!(!ran.load(Ordering::SeqCst));
}

#[tokio::test]
async fn removal_ends_a_turn_in_flight_and_the_agent_goes_idle() {
    let lifecycle = Arc::new(Lifecycle::new());
    let running = Arc::clone(&lifecycle);
    let turn = tokio::spawn(async move {
        running
            .admit("a", "test", std::future::pending::<Result<(), CoreError>>())
            .await
    });
    while lifecycle.in_flight.load(Ordering::SeqCst) == 0 {
        tokio::task::yield_now().await;
    }
    assert!(!lifecycle.wait_idle(Duration::from_millis(10)).await);

    lifecycle.mark_removed();

    assert!(removed(turn.await.expect("turn task")));
    assert!(lifecycle.wait_idle(Duration::from_secs(1)).await);
}

#[test]
fn teardown_is_claimed_once() {
    let lifecycle = Lifecycle::new();
    assert!(lifecycle.begin_teardown());
    assert!(!lifecycle.begin_teardown());
}

#[tokio::test]
async fn a_claimed_removal_refuses_turns_before_approvals_are_settled() {
    let lifecycle = Arc::new(Lifecycle::new());
    let removing = lifecycle.clone();
    let (entered, callback_entered) = std::sync::mpsc::channel();
    let (release, callback_release) = std::sync::mpsc::channel();
    let removal = std::thread::spawn(move || {
        removing.mark_removed_with(|| {
            entered.send(()).unwrap();
            callback_release.recv().unwrap();
        })
    });
    callback_entered.recv().unwrap();
    let ran = AtomicBool::new(false);
    let outcome = lifecycle
        .admit("a", "test", async {
            ran.store(true, Ordering::SeqCst);
            Ok(())
        })
        .await;
    release.send(()).unwrap();
    assert!(removal.join().unwrap());
    assert!(removed(outcome));
    assert!(
        !ran.load(Ordering::SeqCst),
        "removal admitted a new turn while settling approvals"
    );
}

#[test]
fn a_claimed_removal_refuses_approval_decisions_before_denial_finishes() {
    let lifecycle = Arc::new(Lifecycle::new());
    let approvals = crate::Approvals::new("a", lifecycle.removed(), lifecycle.approval_state());
    let removing = lifecycle.clone();
    let (entered, callback_entered) = std::sync::mpsc::channel();
    let (release, callback_release) = std::sync::mpsc::channel();
    let removal = std::thread::spawn(move || {
        removing.mark_removed_with(|| {
            entered.send(()).unwrap();
            callback_release.recv().unwrap();
        })
    });
    callback_entered.recv().unwrap();
    let outcome = approvals.decide("pending-request", crate::ApprovalDecision::ApproveOnce);
    release.send(()).unwrap();
    assert!(removal.join().unwrap());
    assert!(
        matches!(outcome, Err(crate::ApprovalsError::NotFound(_))),
        "{outcome:?}"
    );
}

#[test]
fn accepted_approval_decisions_hold_the_removal_claim_barrier() {
    let state = Arc::new(ApprovalState::default());
    let deciding = state.clone();
    let (entered, decision_entered) = std::sync::mpsc::channel();
    let (release, decision_release) = std::sync::mpsc::channel();
    let decision = std::thread::spawn(move || {
        deciding.with_live(|| {
            entered.send(()).unwrap();
            decision_release.recv().unwrap();
            7
        })
    });
    decision_entered.recv().unwrap();
    let held = matches!(
        state.decisions.try_lock(),
        Err(std::sync::TryLockError::WouldBlock)
    );
    release.send(()).unwrap();
    assert_eq!(decision.join().unwrap(), Some(7));
    assert!(
        held,
        "removal could claim while a decision was still being applied"
    );
    assert!(state.claim_removal());
    let mut ran = false;
    assert_eq!(state.with_live(|| ran = true), None);
    assert!(!ran);
}
