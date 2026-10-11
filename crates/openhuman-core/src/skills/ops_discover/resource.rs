//! OpenHuman discovery context around `tinyskills` resource reads.

use super::api::load_workflow_metadata;
use std::path::Path;

pub fn read_workflow_resource(
    workspace_dir: &Path,
    skill_id: &str,
    relative_path: &Path,
) -> Result<String, String> {
    if skill_id.trim().is_empty() {
        return Err("skill_id must not be empty".to_string());
    }
    let skill = tinyskills::resolve_skill(load_workflow_metadata(workspace_dir), skill_id)?;
    tinyskills::read_resource(&skill, relative_path).map_err(|error| error.to_string())
}
