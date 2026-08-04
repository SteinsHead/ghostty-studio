use std::collections::{BTreeMap, HashSet};

use semver::{Version, VersionReq};
use serde::{Deserialize, Serialize};

use crate::error::CommandError;

const MANIFEST_VERSION: u32 = 1;
const HOST_API_VERSION: &str = "1.0.0";
const MAX_MANIFEST_BYTES: usize = 512 * 1024;
const MAX_CONTRIBUTIONS: usize = 1_000;
const ALLOWED_CAPABILITIES: &[&str] = &[
    "schema.metadata",
    "presets",
    "migrations.declarative",
    "preview.declarative",
    "core.override",
];

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ExtensionManifest {
    pub manifest_version: u32,
    pub id: String,
    pub name: String,
    pub version: String,
    pub host_api: String,
    #[serde(default)]
    pub ghostty: Option<String>,
    #[serde(default)]
    pub capabilities: Vec<String>,
    #[serde(default)]
    pub contributes: Contributions,
}

#[derive(Debug, Clone, Default, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Contributions {
    #[serde(default)]
    pub settings: Vec<SettingMetadata>,
    #[serde(default)]
    pub presets: Vec<Preset>,
    #[serde(default)]
    pub migrations: Vec<Migration>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SettingMetadata {
    pub key: String,
    pub category: String,
    #[serde(default)]
    pub label: Option<String>,
    #[serde(default)]
    pub description: Option<String>,
    #[serde(default)]
    pub kind: Option<String>,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub aliases: Vec<String>,
    #[serde(default)]
    pub risk: Option<String>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Preset {
    pub id: String,
    pub name: String,
    pub values: BTreeMap<String, Vec<String>>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Migration {
    pub from_key: String,
    pub to_key: String,
    #[serde(default)]
    pub value_map: BTreeMap<String, String>,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ValidatedExtension {
    pub id: String,
    pub name: String,
    pub version: String,
    pub capabilities: Vec<String>,
    pub setting_count: usize,
    pub preset_count: usize,
    pub migration_count: usize,
    pub trusted: bool,
}

pub fn validate_manifest(
    bytes: &[u8],
    trusted: bool,
    core_keys: &HashSet<String>,
) -> Result<ValidatedExtension, CommandError> {
    if bytes.len() > MAX_MANIFEST_BYTES {
        return Err(CommandError::new(
            "extension_too_large",
            "extension manifest exceeds the 512 KiB limit",
        ));
    }
    let manifest: ExtensionManifest = serde_json::from_slice(bytes).map_err(|error| {
        CommandError::new(
            "invalid_extension_manifest",
            format!("extension manifest is not valid strict JSON: {error}"),
        )
    })?;
    if manifest.manifest_version != MANIFEST_VERSION {
        return Err(CommandError::new(
            "unsupported_manifest_version",
            format!(
                "manifest version {} is not supported",
                manifest.manifest_version
            ),
        ));
    }
    validate_identifier(&manifest.id, "extension id")?;
    validate_short_text(&manifest.name, "extension name", 120)?;
    Version::parse(&manifest.version).map_err(|error| {
        CommandError::new(
            "invalid_extension_version",
            format!("extension version must be semantic versioning: {error}"),
        )
    })?;
    let host_requirement = VersionReq::parse(&manifest.host_api).map_err(|error| {
        CommandError::new(
            "invalid_host_requirement",
            format!("hostApi must be a semantic version requirement: {error}"),
        )
    })?;
    let host_version = Version::parse(HOST_API_VERSION).expect("constant host API is valid semver");
    if !host_requirement.matches(&host_version) {
        return Err(CommandError::new(
            "incompatible_host_api",
            format!(
                "extension requires host API {}, app provides {HOST_API_VERSION}",
                manifest.host_api
            ),
        ));
    }
    if let Some(requirement) = &manifest.ghostty {
        VersionReq::parse(requirement).map_err(|error| {
            CommandError::new(
                "invalid_ghostty_requirement",
                format!("ghostty must be a semantic version requirement: {error}"),
            )
        })?;
    }

    let mut unique_capabilities = HashSet::new();
    for capability in &manifest.capabilities {
        if !ALLOWED_CAPABILITIES.contains(&capability.as_str()) {
            return Err(CommandError::new(
                "unknown_extension_capability",
                format!("extension requests unsupported capability {capability}"),
            ));
        }
        if !unique_capabilities.insert(capability) {
            return Err(CommandError::new(
                "duplicate_extension_capability",
                format!("extension repeats capability {capability}"),
            ));
        }
    }
    if manifest
        .capabilities
        .iter()
        .any(|item| item == "core.override")
        && !trusted
    {
        return Err(CommandError::new(
            "untrusted_core_override",
            "only a locally trusted, integrity-pinned extension may override core metadata",
        ));
    }

    let contribution_count = manifest.contributes.settings.len()
        + manifest.contributes.presets.len()
        + manifest.contributes.migrations.len();
    if contribution_count > MAX_CONTRIBUTIONS {
        return Err(CommandError::new(
            "too_many_extension_contributions",
            "extension contains more than 1,000 contributions",
        ));
    }
    validate_settings(&manifest, trusted, core_keys)?;
    validate_presets(&manifest)?;
    validate_migrations(&manifest)?;

    Ok(ValidatedExtension {
        id: manifest.id,
        name: manifest.name,
        version: manifest.version,
        capabilities: manifest.capabilities,
        setting_count: manifest.contributes.settings.len(),
        preset_count: manifest.contributes.presets.len(),
        migration_count: manifest.contributes.migrations.len(),
        trusted,
    })
}

fn validate_settings(
    manifest: &ExtensionManifest,
    trusted: bool,
    core_keys: &HashSet<String>,
) -> Result<(), CommandError> {
    let can_override = trusted
        && manifest
            .capabilities
            .iter()
            .any(|item| item == "core.override");
    let mut seen = HashSet::new();
    for setting in &manifest.contributes.settings {
        validate_setting_key(&setting.key)?;
        if !seen.insert(&setting.key) {
            return Err(CommandError::new(
                "duplicate_extension_setting",
                format!("extension repeats setting metadata for {}", setting.key),
            ));
        }
        if core_keys.contains(&setting.key) && !can_override {
            return Err(CommandError::new(
                "extension_core_collision",
                format!("{} is a core setting and cannot be overridden", setting.key),
            ));
        }
        validate_short_text(&setting.category, "setting category", 80)?;
        if let Some(label) = &setting.label {
            validate_short_text(label, "setting label", 120)?;
        }
        if setting
            .description
            .as_ref()
            .is_some_and(|text| text.len() > 4_000)
        {
            return Err(CommandError::new(
                "extension_text_too_long",
                "setting description exceeds 4,000 bytes",
            ));
        }
        if setting.choices.len() > 512 || setting.aliases.len() > 64 {
            return Err(CommandError::new(
                "extension_list_too_large",
                format!("{} contributes too many choices or aliases", setting.key),
            ));
        }
        if let Some(kind) = &setting.kind {
            if ![
                "boolean", "integer", "number", "color", "select", "duration", "text",
            ]
            .contains(&kind.as_str())
            {
                return Err(CommandError::new(
                    "invalid_extension_control",
                    format!("{} requests unknown control kind {kind}", setting.key),
                ));
            }
        }
        if let Some(risk) = &setting.risk {
            if !["normal", "sensitive", "advanced"].contains(&risk.as_str()) {
                return Err(CommandError::new(
                    "invalid_extension_risk",
                    format!("{} has invalid risk classification {risk}", setting.key),
                ));
            }
        }
    }
    Ok(())
}

fn validate_presets(manifest: &ExtensionManifest) -> Result<(), CommandError> {
    let mut seen = HashSet::new();
    for preset in &manifest.contributes.presets {
        validate_identifier(&preset.id, "preset id")?;
        validate_short_text(&preset.name, "preset name", 120)?;
        if !seen.insert(&preset.id) {
            return Err(CommandError::new(
                "duplicate_extension_preset",
                format!("extension repeats preset {}", preset.id),
            ));
        }
        if preset.values.len() > 256 {
            return Err(CommandError::new(
                "extension_preset_too_large",
                format!("preset {} contains too many settings", preset.id),
            ));
        }
        for (key, values) in &preset.values {
            validate_setting_key(key)?;
            if values.len() > 64 || values.iter().any(|value| value.len() > 64 * 1024) {
                return Err(CommandError::new(
                    "extension_value_too_large",
                    format!("preset {} contains an oversized value", preset.id),
                ));
            }
        }
    }
    Ok(())
}

fn validate_migrations(manifest: &ExtensionManifest) -> Result<(), CommandError> {
    for migration in &manifest.contributes.migrations {
        validate_setting_key(&migration.from_key)?;
        validate_setting_key(&migration.to_key)?;
        if migration.value_map.len() > 512 {
            return Err(CommandError::new(
                "extension_migration_too_large",
                "migration value map exceeds 512 entries",
            ));
        }
    }
    Ok(())
}

fn validate_identifier(value: &str, label: &str) -> Result<(), CommandError> {
    if value.is_empty()
        || value.len() > 128
        || value.starts_with('.')
        || value.ends_with('.')
        || !value.bytes().all(|byte| {
            byte.is_ascii_lowercase() || byte.is_ascii_digit() || matches!(byte, b'.' | b'-')
        })
    {
        return Err(CommandError::new(
            "invalid_extension_identifier",
            format!("{label} must use lowercase reverse-DNS-safe characters"),
        ));
    }
    Ok(())
}

fn validate_setting_key(key: &str) -> Result<(), CommandError> {
    if key.is_empty()
        || key.len() > 128
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(CommandError::new(
            "invalid_extension_setting",
            format!("invalid Ghostty setting key {key}"),
        ));
    }
    Ok(())
}

fn validate_short_text(value: &str, label: &str, max: usize) -> Result<(), CommandError> {
    if value.trim().is_empty() || value.len() > max || value.contains(['\n', '\r', '\0']) {
        return Err(CommandError::new(
            "invalid_extension_text",
            format!("{label} must be non-empty, single-line, and at most {max} bytes"),
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    fn core_keys() -> HashSet<String> {
        ["font-size", "theme"]
            .into_iter()
            .map(str::to_string)
            .collect()
    }

    #[test]
    fn accepts_a_strict_data_only_extension() {
        let bytes = br#"{
          "manifestVersion": 1,
          "id": "dev.example.workflow",
          "name": "Example workflow metadata",
          "version": "1.2.0",
          "hostApi": "^1.0",
          "ghostty": ">=1.3",
          "capabilities": ["schema.metadata", "presets"],
          "contributes": {
            "settings": [{"key":"example-mode","category":"Example","kind":"select","choices":["a","b"]}],
            "presets": [{"id":"dev.example.fast","name":"Fast","values":{"example-mode":["a"]}}]
          }
        }"#;
        let validated = validate_manifest(bytes, false, &core_keys()).unwrap();
        assert_eq!(validated.setting_count, 1);
        assert_eq!(validated.preset_count, 1);
    }

    #[test]
    fn rejects_unknown_fields_and_executable_payloads() {
        let bytes = br#"{
          "manifestVersion":1,"id":"dev.example.bad","name":"Bad","version":"1.0.0",
          "hostApi":"^1","capabilities":[],"entrypoint":"curl bad.example"
        }"#;
        let error = validate_manifest(bytes, false, &core_keys()).unwrap_err();
        assert_eq!(error.code, "invalid_extension_manifest");
    }

    #[test]
    fn rejects_untrusted_core_metadata_override() {
        let bytes = br#"{
          "manifestVersion":1,"id":"dev.example.override","name":"Override","version":"1.0.0",
          "hostApi":"^1","capabilities":["schema.metadata"],
          "contributes":{"settings":[{"key":"font-size","category":"Wrong"}]}
        }"#;
        let error = validate_manifest(bytes, false, &core_keys()).unwrap_err();
        assert_eq!(error.code, "extension_core_collision");
    }

    #[test]
    fn core_override_requires_both_trust_and_capability() {
        let bytes = br#"{
          "manifestVersion":1,"id":"dev.example.override","name":"Override","version":"1.0.0",
          "hostApi":"^1","capabilities":["schema.metadata","core.override"],
          "contributes":{"settings":[{"key":"font-size","category":"Typography"}]}
        }"#;
        let untrusted = validate_manifest(bytes, false, &core_keys()).unwrap_err();
        assert_eq!(untrusted.code, "untrusted_core_override");
        assert!(validate_manifest(bytes, true, &core_keys()).is_ok());
    }
}
