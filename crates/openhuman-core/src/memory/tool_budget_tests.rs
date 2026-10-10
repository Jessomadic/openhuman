use super::*;
use std::sync::atomic::{AtomicUsize, Ordering};
use std::time::Duration;

#[tokio::test(start_paused = true)]
async fn a_slow_memory_call_returns_and_disables_memory_only_for_its_turn() {
    let budget = ToolBudget::default();
    let result = budget
        .run(Some("turn-one".into()), async {
            tokio::time::sleep(Duration::from_secs(60)).await;
            ToolResult::success("late")
        })
        .await;
    assert!(result.is_error);
    assert!(result.text().contains("Continue answering"));
    let calls = AtomicUsize::new(0);
    let result = budget
        .run(Some("turn-one".into()), async {
            calls.fetch_add(1, Ordering::SeqCst);
            ToolResult::success("should not run")
        })
        .await;
    assert!(result.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), 0);
    let next = budget
        .run(Some("turn-two".into()), async {
            ToolResult::success("healthy")
        })
        .await;
    assert!(!next.is_error);
}

#[tokio::test]
async fn successful_memory_churn_is_bounded_without_blocking_the_next_turn() {
    let budget = ToolBudget::default();
    let calls = AtomicUsize::new(0);
    for _ in 0..20 {
        budget
            .run(Some("turn-one".into()), async {
                calls.fetch_add(1, Ordering::SeqCst);
                ToolResult::success("saved with a different id")
            })
            .await;
    }
    assert_eq!(calls.load(Ordering::SeqCst), 8);
    let next = budget
        .run(Some("turn-two".into()), async {
            ToolResult::success("healthy")
        })
        .await;
    assert!(!next.is_error);
}

#[tokio::test(start_paused = true)]
async fn successful_memory_calls_share_one_latency_budget() {
    let budget = ToolBudget::default();
    for _ in 0..3 {
        let result = budget
            .run(Some("turn".into()), async {
                tokio::time::sleep(Duration::from_secs(12)).await;
                ToolResult::success("saved")
            })
            .await;
        if result.is_error {
            return;
        }
    }
    panic!("memory consumed more than thirty seconds in one turn");
}

#[tokio::test(start_paused = true)]
async fn callers_without_a_run_id_still_have_a_deadline() {
    let budget = ToolBudget::default();
    let result = budget
        .run(None, async {
            tokio::time::sleep(Duration::from_secs(60)).await;
            ToolResult::success("late")
        })
        .await;
    assert!(result.is_error);
}

#[tokio::test(start_paused = true)]
async fn parallel_memory_reads_reserve_from_the_same_time_budget() {
    let budget = ToolBudget::default();
    let calls = AtomicUsize::new(0);
    let read = || async {
        calls.fetch_add(1, Ordering::SeqCst);
        tokio::time::sleep(Duration::from_secs(12)).await;
        ToolResult::success("read")
    };
    let (first, second, third) = tokio::join!(
        budget.run(Some("turn".into()), read()),
        budget.run(Some("turn".into()), read()),
        budget.run(Some("turn".into()), read()),
    );
    assert!(!first.is_error);
    assert!(!second.is_error);
    assert!(third.is_error);
    assert_eq!(calls.load(Ordering::SeqCst), 2);
    assert_eq!(
        budget.runs.lock().unwrap().states["turn"].remaining,
        Duration::from_secs(6)
    );
}

#[tokio::test]
async fn completed_run_tracking_is_bounded() {
    let budget = ToolBudget::default();
    for i in 0..200 {
        budget
            .run(Some(format!("turn-{i}")), async {
                ToolResult::success("saved")
            })
            .await;
    }
    let runs = budget.runs.lock().unwrap();
    assert_eq!(runs.states.len(), MAX_TRACKED_RUNS);
    assert_eq!(runs.order.len(), MAX_TRACKED_RUNS);
}
