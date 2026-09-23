use crate::config::Config;
use crate::search::registry::SearchToolParams;
use tinytools::Tool;

pub(crate) fn build(root_config: &Config, _params: SearchToolParams) -> Vec<Box<dyn Tool>> {
    let config = &root_config.searxng;
    if !config.enabled {
        tracing::warn!(
            "[search] SearXNG selected but [searxng] enabled=false; no search tool registered"
        );
        return Vec::new();
    }

    tracing::debug!("[search] active engine = searxng (direct self-hosted web_search)");
    vec![Box::new(
        crate::search::tools::SearxngSearchTool::new_web_search_tool(
            config.base_url.clone(),
            config.max_results,
            config.default_language.clone(),
            config.timeout_secs,
        ),
    )]
}
