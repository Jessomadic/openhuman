use crate::config::Config;

#[test]
fn disabled_engine_registers_no_search_tools() {
    let mut cfg = Config::default();
    cfg.search.engine = "disabled".to_string();
    cfg.searxng.enabled = true;

    let tools = super::build_search_tools(&cfg);

    assert!(tools.is_empty());
}

#[test]
fn selected_searxng_registers_direct_canonical_search_without_a_key() {
    let mut cfg = Config::default();
    cfg.search.engine = "searxng".to_string();
    cfg.searxng.enabled = true;
    cfg.searxng.base_url = "http://127.0.0.1:8888".to_string();

    let tools = super::build_search_tools(&cfg);

    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name(), "web_search_tool");
    assert!(tools[0].description().contains("SearXNG"));
}

#[test]
fn selected_but_disabled_searxng_does_not_fall_back_to_managed() {
    let mut cfg = Config::default();
    cfg.search.engine = "searxng".to_string();

    assert!(super::build_search_tools(&cfg).is_empty());
}

#[test]
fn searxng_rpc_enablement_does_not_override_selected_managed_engine() {
    let mut cfg = Config::default();
    cfg.searxng.enabled = true;

    let tools = super::build_search_tools(&cfg);

    assert_eq!(tools.len(), 1);
    assert_eq!(tools[0].name(), "web_search_tool");
    assert!(!tools[0].description().contains("SearXNG"));
}

#[test]
fn managed_engine_registers_unified_web_search_tool() {
    let mut cfg = Config::default();
    cfg.search.engine = "managed".to_string();

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(names, vec!["web_search_tool"]);
}

#[test]
fn exa_engine_registers_the_byok_exa_family() {
    let mut cfg = Config::default();
    cfg.search.engine = "exa".to_string();
    cfg.search.exa.api_key = Some("test-key".to_string());

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(
        names,
        vec![
            "web_search_tool",
            "exa_search",
            "exa_find_similar",
            "exa_get_contents"
        ]
    );
}

#[test]
fn exa_without_a_key_falls_back_to_the_managed_surface() {
    let mut cfg = Config::default();
    cfg.search.engine = "exa".to_string();

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(names, vec!["web_search_tool"]);
}

#[test]
fn brave_engine_registers_brave_search_family() {
    let mut cfg = Config::default();
    cfg.search.engine = "brave".to_string();
    cfg.search.brave.api_key = Some("test-key".to_string());

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(
        names,
        vec![
            "web_search_tool",
            "brave_news_search",
            "brave_image_search",
            "brave_video_search"
        ]
    );
}

#[test]
fn tavily_engine_registers_the_byok_tavily_family() {
    let mut cfg = Config::default();
    cfg.search.engine = "tavily".to_string();
    cfg.search.tavily.api_key = Some("test-key".to_string());

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(
        names,
        vec!["web_search_tool", "tavily_search", "tavily_extract"]
    );
}

#[test]
fn tavily_without_a_key_falls_back_to_the_managed_surface() {
    let mut cfg = Config::default();
    cfg.search.engine = "tavily".to_string();

    let tools = super::build_search_tools(&cfg);
    let names = tools.iter().map(|tool| tool.name()).collect::<Vec<_>>();

    assert_eq!(names, vec!["web_search_tool"]);
}
