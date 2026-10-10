use super::*;

#[test]
fn wrapping_retains_wide_and_combining_characters() {
    assert_eq!(wrap_cells("界e\u{301}界", 3), vec!["界e\u{301}", "界"]);
}

#[test]
fn large_transcript_uses_wide_offsets_and_only_returns_the_viewport() {
    let mut state = TranscriptState::new("test");
    for _ in 0..40000 {
        state.push_system("one line");
    }
    let mut cache = ViewportCache::default();
    let (rows, max_scroll) = cache.rows(&state, 80, 20, 0);
    assert_eq!(rows.len(), 20);
    assert_eq!(max_scroll, 79980);
    assert_eq!(rows[0].entry, 39990);
    let (rows, _) = cache.rows(&state, 80, 20, max_scroll);
    assert_eq!(rows[0].entry, 0);
    assert!(
        cache
            .blocks
            .iter()
            .filter(|block| !block.rows.is_empty())
            .count()
            <= 193
    );
}

#[test]
fn changing_a_message_invalidates_only_its_cached_block() {
    let mut state = TranscriptState::new("test");
    state.begin_user_turn("hi");
    let mut cache = ViewportCache::default();
    cache.rows(&state, 80, 20, 0);
    state.push_system("new");
    let (rows, _) = cache.rows(&state, 80, 20, 0);
    assert!(rows.iter().any(|row| row.text == "new"));
}
