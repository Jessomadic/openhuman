//! OpenHuman-compatible names for the portable `tinyskills` model.

pub use tinyskills::{
    Skill as Workflow, SkillFrontmatter as WorkflowFrontmatter, SkillScope as WorkflowScope,
    MAX_DESCRIPTION_LEN, MAX_NAME_LEN, MAX_RESOURCE_BYTES as MAX_WORKFLOW_RESOURCE_BYTES,
    RESOURCE_DIRS, SKILL_JSON, SKILL_MD, WORKFLOW_MD,
};

// Host-owned sidecar names and the trust marker are OpenHuman policy.

/// Filename for the OpenHuman skill configuration sidecar.
pub const SKILL_TOML: &str = "skill.toml";

/// Filename for the OpenHuman workflow configuration sidecar.
pub const WORKFLOW_TOML: &str = "workflow.toml";

pub(crate) const TRUST_MARKER: &str = "trust";
