//! A finished turn must release every clone of its progress sender once the
//! caller clears the sink, so the web channel's progress bridge (which only
//! exits when its receiver closes) does not outlive the turn on a cached
//! session.

use super::*;

#[tokio::test]
async fn clearing_progress_after_a_turn_closes_the_receiver() {
    let provider = Arc::new(ScriptedProvider::new(vec![text_response("Hello world")]));
    let (mut agent, _tmp) =
        build_agent_with(provider, vec![Box::new(EchoTool)], Box::new(NativeDialect));

    let (tx, mut rx) = tokio::sync::mpsc::channel(256);
    let weak = tx.downgrade();
    agent.set_on_progress(Some(tx));
    agent.turn("hi").await.expect("turn");
    agent.set_on_progress(None);

    eprintln!("DIAG strong_count after clear = {}", weak.strong_count());
    while rx.try_recv().is_ok() {}
    assert!(
        matches!(
            rx.try_recv(),
            Err(tokio::sync::mpsc::error::TryRecvError::Disconnected)
        ),
        "a cached session kept {} progress sender clone(s) alive after the turn",
        weak.strong_count()
    );
}
