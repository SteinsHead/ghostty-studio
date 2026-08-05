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

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RuntimeCapability {
    pub edit_mode: String,
    pub reason: Option<String>,
    pub activation: String,
    pub constraint_behavior: String,
    pub min: Option<f64>,
    pub max: Option<f64>,
    pub step: Option<f64>,
    pub unit: Option<String>,
    pub platform: Option<String>,
}

#[derive(Debug, Clone, Serialize, PartialEq)]
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
    pub capability: RuntimeCapability,
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
pub struct ConfiguredSetting {
    pub key: String,
    pub occurrence_count: usize,
    pub value_exposure: String,
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
    pub configured_settings: Vec<ConfiguredSetting>,
    pub unrecognized_setting_count: usize,
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
    pub activation: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ApplyResult {
    pub revision: String,
    pub snapshot_id: String,
    pub diagnostics: Vec<String>,
    pub warnings: Vec<String>,
    pub activation: String,
    pub reload_required: bool,
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn capability_and_configured_setting_use_stable_camel_case_fields() {
        let capability = RuntimeCapability {
            edit_mode: "control".to_string(),
            reason: None,
            activation: "reload-new-terminal".to_string(),
            constraint_behavior: "reject".to_string(),
            min: Some(0.0),
            max: Some(1.0),
            step: Some(0.01),
            unit: Some("percent".to_string()),
            platform: None,
        };
        let serialized = serde_json::to_value(capability).unwrap();
        assert_eq!(serialized["editMode"], "control");
        assert_eq!(serialized["constraintBehavior"], "reject");
        assert_eq!(serialized["activation"], "reload-new-terminal");

        let configured = serde_json::to_value(ConfiguredSetting {
            key: "font-size".to_string(),
            occurrence_count: 2,
            value_exposure: "available".to_string(),
        })
        .unwrap();
        assert_eq!(configured["occurrenceCount"], 2);
        assert_eq!(configured["valueExposure"], "available");
    }
}
