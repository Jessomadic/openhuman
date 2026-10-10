use super::*;
use ratatui::backend::TestBackend;
use ratatui::Terminal;
fn rendered(width: u16, height: u16, state: &TranscriptState, ui: &mut UiState) -> String {
    let mut terminal = Terminal::new(TestBackend::new(width, height)).unwrap();
    terminal.draw(|f| draw(f, state, ui)).unwrap();
    terminal
        .backend()
        .buffer()
        .content()
        .iter()
        .map(|cell| cell.symbol())
        .collect()
}
#[test]
fn conversation_and_click_targets_fit_standard_terminal() {
    let mut ui = UiState::new("thread".into(), "client".into());
    let state = TranscriptState::new("client");
    let output = rendered(80, 24, &state, &mut ui);
    for label in [
        "OpenHuman",
        "Sessions",
        "Agents",
        "Tools",
        "Settings",
        "Describe a task",
    ] {
        assert!(output.contains(label), "{label}");
    }
    assert!(!output.contains("1 Logs"));
    assert!(ui.hits.iter().any(|hit| hit.action == Action::Send));
    assert!(ui
        .hits
        .iter()
        .all(|hit| hit.area.right() <= 80 && hit.area.bottom() <= 24));
}
#[test]
fn masked_login_does_not_render_a_secret() {
    let mut ui = UiState::new("thread".into(), "client".into());
    ui.active_tab = AppTab::Settings;
    ui.login_token = Some("private-token-never-render".into());
    let output = rendered(80, 24, &TranscriptState::new("client"), &mut ui);
    assert!(!output.contains("private-token"));
    assert!(output.contains("••••"));
}
#[test]
fn overlay_removes_covered_controls() {
    let mut ui = UiState::new("thread".into(), "client".into());
    ui.overlay = Some(super::super::cockpit::Overlay::new(
        OverlayKind::Help,
        "Commands",
    ));
    rendered(80, 24, &TranscriptState::new("client"), &mut ui);
    assert!(!ui.hits.iter().any(|hit| hit.action == Action::Send));
}
#[test]
fn small_terminal_and_unicode_do_not_panic() {
    let mut ui = UiState::new("thread".into(), "client".into());
    ui.composer.set_text("界界e\u{301}\n".repeat(20));
    for (width, height) in [(20, 5), (40, 12), (80, 24), (120, 40)] {
        rendered(width, height, &TranscriptState::new("client"), &mut ui);
    }
}
