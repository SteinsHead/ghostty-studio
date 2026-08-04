use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GhosttyProbe {
    pub available: bool,
    pub executable_path: Option<String>,
    pub version: Option<String>,
    pub channel: Option<String>,
    pub raw_version: Option<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigCandidate {
    pub id: String,
    pub label: String,
    pub path: String,
    pub source: String,
    pub format: String,
    pub priority: u8,
    pub exists: bool,
    pub writable: bool,
    pub symlink: bool,
    pub size_bytes: Option<u64>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct EnvironmentReport {
    pub platform: String,
    pub architecture: String,
    pub ghostty: GhosttyProbe,
    pub candidates: Vec<ConfigCandidate>,
    pub warnings: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeOption {
    pub key: String,
    pub description: String,
    pub default_values: Vec<String>,
    pub current_values: Vec<String>,
    pub category: String,
    pub kind: String,
    pub choices: Vec<String>,
    pub repeatable: bool,
    pub platform: Option<String>,
    pub since: Option<String>,
    pub risk: String,
    pub editable: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct RuntimeSchema {
    pub ghostty_version: Option<String>,
    pub schema_hash: String,
    pub options: Vec<RuntimeOption>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigSession {
    pub id: String,
    pub candidate_id: String,
    pub path: String,
    pub revision: String,
    pub read_only: bool,
    pub values: std::collections::BTreeMap<String, Vec<String>>,
    pub diagnostics: Vec<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct DraftChange {
    pub key: String,
    pub before: Vec<String>,
    pub after: Vec<String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChangePreview {
    pub token: String,
    pub revision: String,
    pub changes: Vec<DraftChange>,
    pub unified_diff: String,
    pub diagnostics: Vec<String>,
    pub valid: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub revision: String,
    pub snapshot_id: String,
    pub diagnostics: Vec<String>,
    pub warnings: Vec<String>,
    pub reload_required: bool,
}
