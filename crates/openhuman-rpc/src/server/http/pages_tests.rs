use super::{error_html, escape_html, success_html};

#[test]
fn success_page_renders_and_escapes_message() {
    let html = success_html("Connected <safely> & \"securely\"");

    assert!(html.contains("<title>OpenHuman &#8212; Connected</title>"));
    assert!(html.contains("<h1>Connected!</h1>"));
    assert!(html.contains("Connected &lt;safely&gt; &amp; &quot;securely&quot;"));
    assert!(!html.contains("Connected <safely>"));
}

#[test]
fn error_page_renders_and_escapes_message() {
    let html = error_html("OAuth failed: <denied> & 'retry'");

    assert!(html.contains("<title>OpenHuman &#8212; Error</title>"));
    assert!(html.contains("<h1>Something went wrong</h1>"));
    assert!(html.contains("OAuth failed: &lt;denied&gt; &amp; &#x27;retry&#x27;"));
    assert!(!html.contains("OAuth failed: <denied>"));
}

#[test]
fn escape_html_escapes_all_special_chars() {
    let raw = r#"<script>alert("x&y'z")</script>"#;
    let escaped = escape_html(raw);
    assert!(!escaped.contains('<'));
    assert!(!escaped.contains('>'));
    assert!(!escaped.contains('"'));
    assert!(!escaped.contains('\''));
    assert!(escaped.contains("&lt;"));
    assert!(escaped.contains("&gt;"));
    assert!(escaped.contains("&quot;"));
    assert!(escaped.contains("&#x27;"));
    // `&` must be escaped first so later substitutions don't double-encode.
    assert!(escaped.contains("&amp;y"));
}

#[test]
fn escape_html_is_noop_for_safe_text() {
    assert_eq!(escape_html("safe text 123"), "safe text 123");
    assert_eq!(escape_html(""), "");
}
