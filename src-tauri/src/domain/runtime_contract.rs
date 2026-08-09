use std::collections::{BTreeMap, HashSet};

use crate::models::{RuntimeOption, RuntimeSchema};

pub const AUDITED_GHOSTTY_VERSION: &str = "1.3.1";
pub const AUDITED_GHOSTTY_CHANNEL: &str = "stable";
pub const AUDITED_PLATFORM: &str = "macos";
pub const AUDITED_SCHEMA_HASH: &str =
    "5e36480fe2ec3d510ffc32de84c617fbaca10e1330c097185301b51ab9c10e6c";
pub const AUDITED_CONTRACT_ID: &str = "ghostty-1.3.1-stable-macos-v1";

const BACKGROUND_IMAGE_KEY: &str = "background-image";

pub fn restriction_reason(
    version: Option<&str>,
    channel: Option<&str>,
    platform: &str,
    schema_hash: &str,
) -> Option<&'static str> {
    if platform != AUDITED_PLATFORM {
        return Some("platform-unavailable");
    }
    if version.map(str::trim) != Some(AUDITED_GHOSTTY_VERSION)
        || channel.map(str::trim) != Some(AUDITED_GHOSTTY_CHANNEL)
    {
        return Some("version-not-supported");
    }
    if schema_hash != AUDITED_SCHEMA_HASH {
        return Some("setting-changed");
    }
    None
}

pub fn apply_write_gate(options: &mut [RuntimeOption], restriction: Option<&str>) {
    let Some(restriction) = restriction else {
        return;
    };
    for option in options.iter_mut().filter(|option| {
        option.editable
            || (option.key == BACKGROUND_IMAGE_KEY
                && option.capability.reason.as_deref() == Some("needs-editor"))
    }) {
        option.editable = false;
        option.capability.edit_mode = "none".to_string();
        option.capability.reason = Some(restriction.to_string());
    }
}

pub fn writable_options(schema: &RuntimeSchema) -> BTreeMap<String, RuntimeOption> {
    schema
        .options
        .iter()
        .filter(|option| scalar_control(option) || background_editor(option))
        .map(|option| (option.key.clone(), option.clone()))
        .collect()
}

pub fn changed_writable_keys(
    previous: Option<&RuntimeSchema>,
    current: &RuntimeSchema,
) -> HashSet<String> {
    let Some(previous) = previous else {
        return writable_options(current).into_keys().collect();
    };
    let previous = writable_options(previous);
    let current = writable_options(current);
    previous
        .keys()
        .chain(current.keys())
        .filter(|key| previous.get(*key) != current.get(*key))
        .cloned()
        .collect()
}

pub fn review_contract(
    writable: &BTreeMap<String, RuntimeOption>,
    keys: impl IntoIterator<Item = String>,
) -> BTreeMap<String, RuntimeOption> {
    keys.into_iter()
        .filter_map(|key| writable.get(&key).cloned().map(|option| (key, option)))
        .collect()
}

pub fn review_contract_matches(
    reviewed: &BTreeMap<String, RuntimeOption>,
    current: &BTreeMap<String, RuntimeOption>,
) -> bool {
    !reviewed.is_empty()
        && reviewed
            .iter()
            .all(|(key, option)| current.get(key) == Some(option))
}

fn scalar_control(option: &RuntimeOption) -> bool {
    option.editable
        && option.capability.edit_mode == "control"
        && !option.repeatable
        && option.risk == "normal"
}

fn background_editor(option: &RuntimeOption) -> bool {
    option.key == BACKGROUND_IMAGE_KEY
        && option.kind == "text"
        && !option.repeatable
        && option.risk == "normal"
        && option.capability.edit_mode == "none"
        && option.capability.reason.as_deref() == Some("needs-editor")
        && option.capability.activation == "reload"
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::models::RuntimeCapability;

    fn option(key: &str) -> RuntimeOption {
        RuntimeOption {
            key: key.to_string(),
            description: "Example".to_string(),
            default_values: vec!["1".to_string()],
            current_values: Vec::new(),
            category: "advanced".to_string(),
            kind: "number".to_string(),
            choices: Vec::new(),
            repeatable: false,
            platform: None,
            since: None,
            risk: "normal".to_string(),
            editable: true,
            capability: RuntimeCapability {
                edit_mode: "control".to_string(),
                reason: None,
                activation: "reload".to_string(),
                constraint_behavior: "reject".to_string(),
                min: Some(0.0),
                max: Some(100.0),
                step: Some(1.0),
                unit: None,
                platform: None,
            },
        }
    }

    fn schema(options: Vec<RuntimeOption>) -> RuntimeSchema {
        RuntimeSchema {
            ghostty_version: Some(AUDITED_GHOSTTY_VERSION.to_string()),
            schema_hash: AUDITED_SCHEMA_HASH.to_string(),
            options,
            diagnostics: Vec::new(),
        }
    }

    #[test]
    fn only_the_exact_audited_runtime_is_writable() {
        assert_eq!(
            restriction_reason(
                Some(AUDITED_GHOSTTY_VERSION),
                Some(AUDITED_GHOSTTY_CHANNEL),
                AUDITED_PLATFORM,
                AUDITED_SCHEMA_HASH,
            ),
            None
        );
        assert_eq!(
            restriction_reason(
                Some("1.3.2"),
                Some(AUDITED_GHOSTTY_CHANNEL),
                AUDITED_PLATFORM,
                AUDITED_SCHEMA_HASH,
            ),
            Some("version-not-supported")
        );
        assert_eq!(
            restriction_reason(
                Some(AUDITED_GHOSTTY_VERSION),
                Some("tip"),
                AUDITED_PLATFORM,
                AUDITED_SCHEMA_HASH,
            ),
            Some("version-not-supported")
        );
        assert_eq!(
            restriction_reason(
                Some(AUDITED_GHOSTTY_VERSION),
                Some(AUDITED_GHOSTTY_CHANNEL),
                "linux",
                AUDITED_SCHEMA_HASH,
            ),
            Some("platform-unavailable")
        );
        assert_eq!(
            restriction_reason(
                Some(AUDITED_GHOSTTY_VERSION),
                Some(AUDITED_GHOSTTY_CHANNEL),
                AUDITED_PLATFORM,
                "changed",
            ),
            Some("setting-changed")
        );
    }

    #[test]
    fn a_runtime_restriction_removes_every_write_surface() {
        let mut options = vec![option("font-size")];
        apply_write_gate(&mut options, Some("version-not-supported"));
        assert!(writable_options(&schema(options.clone())).is_empty());
        assert!(!options[0].editable);
        assert_eq!(
            options[0].capability.reason.as_deref(),
            Some("version-not-supported")
        );
    }

    #[test]
    fn review_contract_detects_only_reviewed_option_changes() {
        let previous =
            writable_options(&schema(vec![option("font-size"), option("cursor-opacity")]));
        let reviewed = review_contract(&previous, ["font-size".to_string()]);
        let mut unrelated = previous.clone();
        unrelated.get_mut("cursor-opacity").unwrap().capability.max = Some(0.9);
        assert!(review_contract_matches(&reviewed, &unrelated));

        let mut changed = previous;
        changed.get_mut("font-size").unwrap().capability.max = Some(255.0);
        assert!(!review_contract_matches(&reviewed, &changed));
    }
}
