use std::collections::{BTreeMap, HashSet};

use semver::{Version, VersionReq};
use serde::Deserialize;

use crate::{error::CommandError, models::RuntimeCapability};

const CATALOG_BYTES: &[u8] = include_bytes!("../../contracts/ghostty/capabilities-v1.json");
const CATALOG_FORMAT_VERSION: u32 = 1;
const MAX_OPTIONS: usize = 1_000;
const MAX_CHOICES: usize = 256;
const MAX_FINGERPRINTS: usize = 16;

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct CatalogFile {
    format_version: u32,
    ghostty: String,
    options: Vec<CatalogOption>,
}

#[derive(Debug, Clone, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CatalogOption {
    pub key: String,
    pub observed_fingerprints: Vec<String>,
    pub kind: String,
    #[serde(default)]
    pub choices: Vec<String>,
    #[serde(default)]
    pub repeatable: bool,
    pub risk: String,
    pub capability: RuntimeCapability,
}

#[derive(Debug)]
pub struct Catalog {
    ghostty: VersionReq,
    options: BTreeMap<String, CatalogOption>,
}

#[derive(Debug, Clone)]
pub struct Resolution {
    pub option: CatalogOption,
    #[cfg_attr(not(test), allow(dead_code))]
    pub matched: bool,
}

impl Catalog {
    pub fn bundled() -> Result<Self, CommandError> {
        Self::from_slice(CATALOG_BYTES)
    }

    pub(crate) fn from_slice(bytes: &[u8]) -> Result<Self, CommandError> {
        let file: CatalogFile = serde_json::from_slice(bytes).map_err(|error| {
            CommandError::new(
                "invalid_capability_catalog",
                format!("the built-in Ghostty capability catalog is invalid: {error}"),
            )
        })?;
        validate_catalog(&file)?;
        let ghostty = VersionReq::parse(&file.ghostty).map_err(|error| {
            CommandError::new(
                "invalid_capability_catalog",
                format!("the built-in Ghostty version requirement is invalid: {error}"),
            )
        })?;
        Ok(Self {
            ghostty,
            options: file
                .options
                .into_iter()
                .map(|option| (option.key.clone(), option))
                .collect(),
        })
    }

    pub fn resolve(
        &self,
        key: &str,
        observed_fingerprint: &str,
        installed_version: Option<&str>,
        runtime_platform: &str,
    ) -> Option<Resolution> {
        let mut option = self.options.get(key)?.clone();
        let version_matches = installed_version
            .and_then(|version| Version::parse(version).ok())
            .is_some_and(|version| self.ghostty.matches(&version));
        let observation_matches = option
            .observed_fingerprints
            .iter()
            .any(|fingerprint| fingerprint == observed_fingerprint);
        let platform_matches = option
            .capability
            .platform
            .as_deref()
            .is_none_or(|platform| platform_matches(platform, runtime_platform));

        option.capability.activation =
            resolved_activation(&option.capability.activation, runtime_platform).to_string();
        let matched = version_matches && observation_matches && platform_matches;
        if !matched {
            option.capability.edit_mode = "none".to_string();
            option.capability.reason = Some(
                if !version_matches {
                    "version-not-supported"
                } else if !observation_matches {
                    "setting-changed"
                } else {
                    "platform-unavailable"
                }
                .to_string(),
            );
        }
        Some(Resolution { option, matched })
    }

    #[cfg(test)]
    pub fn option_count(&self) -> usize {
        self.options.len()
    }
}

fn validate_catalog(file: &CatalogFile) -> Result<(), CommandError> {
    if file.format_version != CATALOG_FORMAT_VERSION {
        return invalid("unsupported capability catalog format version");
    }
    VersionReq::parse(&file.ghostty)
        .map_err(|_| invalid_error("invalid Ghostty version requirement"))?;
    if file.options.is_empty() || file.options.len() > MAX_OPTIONS {
        return invalid("capability catalog option count is outside the allowed range");
    }

    let mut keys = HashSet::new();
    for option in &file.options {
        if option.key.is_empty()
            || option.key.len() > 256
            || !option
                .key
                .bytes()
                .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
            || !keys.insert(option.key.as_str())
        {
            return invalid("capability catalog contains an invalid or duplicate key");
        }
        if option.observed_fingerprints.is_empty()
            || option.observed_fingerprints.len() > MAX_FINGERPRINTS
            || option.observed_fingerprints.iter().any(|fingerprint| {
                fingerprint.len() != 64
                    || !fingerprint
                        .bytes()
                        .all(|byte| byte.is_ascii_hexdigit() && !byte.is_ascii_uppercase())
            })
        {
            return invalid("capability catalog contains an invalid observation fingerprint");
        }
        if !matches!(
            option.kind.as_str(),
            "boolean" | "integer" | "number" | "color" | "select" | "duration" | "text"
        ) || !matches!(option.risk.as_str(), "normal" | "sensitive" | "advanced")
        {
            return invalid("capability catalog contains an unsupported kind or risk level");
        }
        if option.choices.len() > MAX_CHOICES
            || option.choices.iter().any(|choice| choice.len() > 256)
            || option.choices.iter().collect::<HashSet<_>>().len() != option.choices.len()
            || (option.kind == "select" && option.choices.is_empty())
            || (option.kind != "select" && !option.choices.is_empty())
        {
            return invalid("capability catalog contains invalid choices");
        }
        validate_capability(option)?;
    }
    Ok(())
}

fn validate_capability(option: &CatalogOption) -> Result<(), CommandError> {
    let capability = &option.capability;
    if !matches!(capability.edit_mode.as_str(), "control" | "raw" | "none")
        || !matches!(
            capability.activation.as_str(),
            "reload" | "reload-new-terminal" | "restart" | "restart-macos" | "unknown"
        )
        || !matches!(
            capability.constraint_behavior.as_str(),
            "reject" | "clamp" | "warn" | "ignore" | "unknown"
        )
    {
        return invalid("capability catalog contains an unsupported behavior value");
    }
    if capability.edit_mode == "control" && (option.repeatable || option.risk != "normal") {
        return invalid("a control capability must be a normal scalar setting");
    }
    if capability.edit_mode == "raw" && (option.repeatable || option.risk != "normal") {
        return invalid("a raw capability must be a normal scalar setting");
    }
    if let Some(reason) = capability.reason.as_deref() {
        if reason.is_empty() || reason.len() > 120 {
            return invalid("capability reason is invalid");
        }
    }
    if [capability.min, capability.max, capability.step]
        .into_iter()
        .flatten()
        .any(|value| !value.is_finite())
        || capability.step.is_some_and(|step| step <= 0.0)
        || matches!((capability.min, capability.max), (Some(min), Some(max)) if min > max)
    {
        return invalid("capability numeric constraints are invalid");
    }
    if let Some(unit) = capability.unit.as_deref() {
        if !matches!(unit, "percent" | "pt" | "px" | "ratio" | "level") {
            return invalid("capability unit is unsupported");
        }
    }
    if let Some(platform) = capability.platform.as_deref() {
        if !matches!(platform, "macOS" | "Linux") {
            return invalid("capability platform is unsupported");
        }
    }
    Ok(())
}

fn platform_matches(required: &str, runtime: &str) -> bool {
    matches!((required, runtime), ("macOS", "macos") | ("Linux", "linux"))
}

fn resolved_activation<'a>(activation: &'a str, runtime_platform: &str) -> &'a str {
    if activation == "restart-macos" {
        if runtime_platform == "macos" {
            "restart"
        } else {
            "reload"
        }
    } else {
        activation
    }
}

fn invalid<T>(message: &str) -> Result<T, CommandError> {
    Err(invalid_error(message))
}

fn invalid_error(message: &str) -> CommandError {
    CommandError::new("invalid_capability_catalog", message)
}

#[cfg(test)]
mod tests {
    use super::*;

    const FINGERPRINT: &str = "0123456789abcdef0123456789abcdef0123456789abcdef0123456789abcdef";

    fn catalog_json(capability: &str) -> Vec<u8> {
        format!(
            r#"{{
              "formatVersion": 1,
              "ghostty": ">=1.3.0, <1.4.0",
              "options": [{{
                "key": "font-size",
                "observedFingerprints": ["{FINGERPRINT}"],
                "kind": "number",
                "choices": [],
                "repeatable": false,
                "risk": "normal",
                "capability": {capability}
              }}]
            }}"#
        )
        .into_bytes()
    }

    const VALID_CAPABILITY: &str = r#"{
      "editMode": "control",
      "reason": null,
      "activation": "reload",
      "constraintBehavior": "clamp",
      "min": 1,
      "max": 255,
      "step": 0.5,
      "unit": "pt",
      "platform": null
    }"#;

    #[test]
    fn bundled_catalog_is_strict_and_nonempty() {
        let catalog = Catalog::bundled().unwrap();
        assert!(catalog.option_count() >= 20);
    }

    #[test]
    fn resolves_each_setting_without_a_global_schema_gate() {
        let catalog = Catalog::from_slice(&catalog_json(VALID_CAPABILITY)).unwrap();
        let matching = catalog
            .resolve("font-size", FINGERPRINT, Some("1.3.1"), "macos")
            .unwrap();
        assert!(matching.matched);
        assert_eq!(matching.option.capability.edit_mode, "control");

        let changed = catalog
            .resolve("font-size", &"f".repeat(64), Some("1.3.1"), "macos")
            .unwrap();
        assert!(!changed.matched);
        assert_eq!(changed.option.capability.edit_mode, "none");
        assert_eq!(
            changed.option.capability.reason.as_deref(),
            Some("setting-changed")
        );
    }

    #[test]
    fn resolves_platform_specific_activation() {
        let capability = VALID_CAPABILITY.replace("\"reload\"", "\"restart-macos\"");
        let catalog = Catalog::from_slice(&catalog_json(&capability)).unwrap();
        assert_eq!(
            catalog
                .resolve("font-size", FINGERPRINT, Some("1.3.1"), "macos")
                .unwrap()
                .option
                .capability
                .activation,
            "restart"
        );
        assert_eq!(
            catalog
                .resolve("font-size", FINGERPRINT, Some("1.3.1"), "linux")
                .unwrap()
                .option
                .capability
                .activation,
            "reload"
        );
        assert_eq!(
            catalog
                .resolve("font-size", &"f".repeat(64), Some("1.3.1"), "macos")
                .unwrap()
                .option
                .capability
                .activation,
            "restart"
        );
    }

    #[test]
    fn rejects_unknown_fields_and_duplicate_keys() {
        let invalid_capability = VALID_CAPABILITY.replace(
            "\"platform\": null",
            "\"platform\": null, \"surprise\": true",
        );
        assert_eq!(
            Catalog::from_slice(&catalog_json(&invalid_capability))
                .unwrap_err()
                .code,
            "invalid_capability_catalog"
        );

        let mut duplicate: serde_json::Value =
            serde_json::from_slice(&catalog_json(VALID_CAPABILITY)).unwrap();
        let clone = duplicate["options"][0].clone();
        duplicate["options"].as_array_mut().unwrap().push(clone);
        assert_eq!(
            Catalog::from_slice(&serde_json::to_vec(&duplicate).unwrap())
                .unwrap_err()
                .code,
            "invalid_capability_catalog"
        );
    }
}
