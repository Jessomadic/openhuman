use super::ApprovalScope;
use std::sync::{mpsc, Arc};

#[test]
fn removal_refuses_late_registration_without_creating_a_pending_row() {
    let scope = ApprovalScope::default();
    scope.close("agent_removed");
    let mut created = false;
    let result = scope.register(|| created = true);
    assert_eq!(result, Err("agent_removed".to_owned()));
    assert!(!created);
}

#[test]
fn removal_waits_for_accepted_registration_before_taking_its_snapshot() {
    let scope = Arc::new(ApprovalScope::default());
    let (entered_tx, entered_rx) = mpsc::channel();
    let (release_tx, release_rx) = mpsc::channel();
    let (closed_tx, closed_rx) = mpsc::channel();
    let registering = scope.clone();
    let registration = std::thread::spawn(move || {
        registering.register(|| {
            entered_tx.send(()).unwrap();
            release_rx.recv().unwrap();
        })
    });
    entered_rx.recv().unwrap();
    let removing = scope.clone();
    let removal = std::thread::spawn(move || {
        removing.close("agent_removed");
        closed_tx.send(()).unwrap();
    });
    let closed_early = closed_rx
        .recv_timeout(std::time::Duration::from_millis(100))
        .is_ok();
    release_tx.send(()).unwrap();
    assert_eq!(registration.join().unwrap(), Ok(()));
    removal.join().unwrap();
    assert!(
        !closed_early,
        "removal snapshot raced an accepted registration"
    );
}

#[test]
fn a_reused_agent_id_has_a_fresh_scope_and_preserves_the_old_removal_reason() {
    let old = ApprovalScope::default();
    old.close("agent_removed");
    old.close("agent_dropped");
    assert_eq!(old.register(|| ()), Err("agent_removed".to_owned()));
    assert_eq!(ApprovalScope::default().register(|| 42), Ok(42));
}
