use super::*;

#[test]
fn report_lines_cover_every_state() {
    assert_eq!(
        report_line("Telegram", ChannelHealthState::Healthy),
        "  ✅ Telegram  healthy"
    );
    assert!(report_line("Slack", ChannelHealthState::Unhealthy).contains("unhealthy"));
    assert!(report_line("Slack", ChannelHealthState::Timeout).contains("timed out"));
}

#[test]
fn channel_labels_use_definition_display_names() {
    assert_eq!(channel_label("telegram"), "Telegram");
    assert_eq!(channel_label("not-a-channel"), "not-a-channel");
}

#[tokio::test]
async fn doctor_with_no_channels_is_ok() {
    doctor_channels(Config::default()).await.unwrap();
}
