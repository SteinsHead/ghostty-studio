use std::collections::BTreeMap;

use sha2::{Digest, Sha256};

use crate::{
    domain::{capability::Catalog, ghostty, runtime_contract},
    error::CommandError,
    models::{RuntimeCapability, RuntimeOption, RuntimeSchema},
};

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservedEntry {
    documentation: String,
    value: String,
}

#[derive(Debug, Clone, PartialEq, Eq)]
struct ObservedOption {
    key: String,
    description: String,
    default_values: Vec<String>,
    entries: Vec<ObservedEntry>,
    repeatable: bool,
}

pub fn load(
    executable: &ghostty::ExecutableIdentity,
    version: Option<String>,
    channel: Option<String>,
) -> Result<RuntimeSchema, CommandError> {
    let document = ghostty::show_default_config_with_docs(executable)?;
    build(&document, version, channel, std::env::consts::OS)
}

fn build(
    document: &str,
    version: Option<String>,
    channel: Option<String>,
    runtime_platform: &str,
) -> Result<RuntimeSchema, CommandError> {
    let schema_hash = hex(&Sha256::digest(document.as_bytes()));
    let catalog = Catalog::bundled()?;
    let mut options = build_runtime_options(
        parse_observed_document(document),
        version.as_deref(),
        runtime_platform,
        &catalog,
    );
    let restriction = runtime_contract::restriction_reason(
        version.as_deref(),
        channel.as_deref(),
        runtime_platform,
        &schema_hash,
    );
    runtime_contract::apply_write_gate(&mut options, restriction);
    let diagnostics = compatibility_diagnostics(
        version.as_deref(),
        channel.as_deref(),
        runtime_platform,
        &schema_hash,
        restriction,
    );
    Ok(RuntimeSchema {
        ghostty_version: version,
        schema_hash,
        options,
        diagnostics,
    })
}

fn parse_observed_document(document: &str) -> Vec<ObservedOption> {
    let mut options = BTreeMap::<String, ObservedOption>::new();
    let mut documentation = Vec::<String>::new();

    for line in document.lines() {
        if let Some(comment) = line.strip_prefix('#') {
            let comment = comment.trim();
            if !comment.is_empty() {
                documentation.push(comment.to_string());
            }
            continue;
        }
        if line.trim().is_empty() {
            continue;
        }
        let Some((raw_key, raw_value)) = line.split_once('=') else {
            documentation.clear();
            continue;
        };
        let key = raw_key.trim();
        if key.is_empty() || key.chars().any(char::is_whitespace) {
            documentation.clear();
            continue;
        }
        let value = raw_value.trim().to_string();
        let description = documentation.join(" ");
        documentation.clear();
        let entry = ObservedEntry {
            documentation: description.clone(),
            value: value.clone(),
        };

        if let Some(existing) = options.get_mut(key) {
            existing.default_values.push(value);
            existing.entries.push(entry);
            existing.repeatable = true;
            continue;
        }
        options.insert(
            key.to_string(),
            ObservedOption {
                key: key.to_string(),
                description,
                default_values: vec![value],
                entries: vec![entry],
                repeatable: known_repeatable(key),
            },
        );
    }

    options.into_values().collect()
}

fn build_runtime_options(
    observed: Vec<ObservedOption>,
    version: Option<&str>,
    runtime_platform: &str,
    catalog: &Catalog,
) -> Vec<RuntimeOption> {
    observed
        .into_iter()
        .map(|observed| {
            let inferred_platform = platform_for(&observed.key, &observed.description);
            let inferred_risk = risk_for(&observed.key);
            let fingerprint = observed_fingerprint(&observed);
            let resolved = catalog.resolve(&observed.key, &fingerprint, version, runtime_platform);

            let (kind, choices, repeatable, risk, mut capability) = match resolved {
                Some(resolution) => {
                    let option = resolution.option;
                    (
                        option.kind,
                        option.choices,
                        observed.repeatable || option.repeatable,
                        option.risk,
                        option.capability,
                    )
                }
                None => {
                    let platform = inferred_platform.clone();
                    let reason = reference_reason(
                        &observed.key,
                        observed.repeatable,
                        inferred_risk,
                        platform.as_deref(),
                        runtime_platform,
                    );
                    (
                        "text".to_string(),
                        Vec::new(),
                        observed.repeatable,
                        inferred_risk.to_string(),
                        RuntimeCapability {
                            edit_mode: "none".to_string(),
                            reason: Some(reason.to_string()),
                            activation: "unknown".to_string(),
                            constraint_behavior: "unknown".to_string(),
                            min: None,
                            max: None,
                            step: None,
                            unit: None,
                            platform,
                        },
                    )
                }
            };

            if repeatable && capability.edit_mode != "none" {
                capability.edit_mode = "none".to_string();
                capability.reason = Some("needs-list-editor".to_string());
            }
            if risk != "normal" && capability.edit_mode != "none" {
                capability.edit_mode = "none".to_string();
                capability.reason = Some("protected".to_string());
            }
            let editable = capability.edit_mode == "control";
            let platform = capability.platform.clone().or(inferred_platform);

            RuntimeOption {
                key: observed.key.clone(),
                description: observed.description.clone(),
                default_values: observed.default_values,
                // `+show-config --default --docs` is a defaults catalog, not
                // the user's complete effective configuration.
                current_values: Vec::new(),
                category: category_for(&observed.key).to_string(),
                kind,
                choices,
                repeatable,
                platform,
                since: since_for(&observed.description),
                risk,
                editable,
                capability,
            }
        })
        .collect()
}

fn compatibility_diagnostics(
    version: Option<&str>,
    channel: Option<&str>,
    runtime_platform: &str,
    schema_hash: &str,
    restriction: Option<&str>,
) -> Vec<String> {
    match restriction {
        None => Vec::new(),
        Some("platform-unavailable") => vec![format!(
            "Ghostty 设置可浏览，但 {runtime_platform} 尚未纳入安全写入验证。"
        )],
        Some("version-not-supported") => vec![format!(
            "Ghostty {}{} 可浏览；完成兼容验证前保持只读。",
            version.unwrap_or("未知版本"),
            channel
                .map(|channel| format!(" ({channel})"))
                .unwrap_or_default()
        )],
        Some("setting-changed") => vec![format!(
            "检测到未经验证的 Ghostty 设置结构（{}…）；完成兼容验证前保持只读。",
            &schema_hash[..schema_hash.len().min(8)]
        )],
        Some(_) => vec!["Ghostty 设置可浏览；当前运行环境保持只读。".to_string()],
    }
}

fn observed_fingerprint(option: &ObservedOption) -> String {
    let mut digest = Sha256::new();
    update_frame(&mut digest, "ghostty-studio-observation-v1");
    update_frame(&mut digest, &option.key);
    for entry in &option.entries {
        update_frame(&mut digest, &entry.documentation);
        update_frame(&mut digest, &entry.value);
    }
    hex(&digest.finalize())
}

fn update_frame(digest: &mut Sha256, value: &str) {
    digest.update((value.len() as u64).to_be_bytes());
    digest.update(value.as_bytes());
}

fn category_for(key: &str) -> &'static str {
    if key.starts_with("font-") || key.starts_with("adjust-font") {
        "font"
    } else if key.starts_with("cursor-") || key.starts_with("adjust-cursor") {
        "cursor"
    } else if key.starts_with("window-")
        || key.starts_with("resize-")
        || key.starts_with("tab-")
        || key.starts_with("split-inherit-")
    {
        "window"
    } else if key.starts_with("quick-terminal-") {
        "quick-terminal"
    } else if key.starts_with("clipboard-") || key.contains("paste") || key.contains("copy") {
        "privacy-security"
    } else if key.starts_with("mouse-") || key.contains("scroll") || key == "focus-follows-mouse" {
        "mouse-scroll"
    } else if key.starts_with("shell-")
        || key == "command"
        || key == "initial-command"
        || key == "env"
    {
        "shell-environment"
    } else if key.starts_with("macos-") {
        "macos"
    } else if key.starts_with("gtk-") || key.starts_with("linux-") || key.starts_with("x11-") {
        "linux-gtk"
    } else if key == "theme"
        || key.starts_with("background-")
        || key == "background"
        || key == "foreground"
        || key == "palette"
        || key == "split-divider-color"
        || key.starts_with("selection-")
    {
        "appearance"
    } else if key == "keybind" || key.starts_with("key-") {
        "keyboard"
    } else {
        "advanced"
    }
}

fn known_repeatable(key: &str) -> bool {
    matches!(
        key,
        "font-family"
            | "font-feature"
            | "font-variation"
            | "palette"
            | "env"
            | "keybind"
            | "config-file"
            | "link"
            | "command-palette-entry"
    )
}

fn risk_for(key: &str) -> &'static str {
    if matches!(
        key,
        "command"
            | "initial-command"
            | "env"
            | "input"
            | "clipboard-read"
            | "clipboard-write"
            | "config-file"
            | "theme"
    ) {
        "sensitive"
    } else if key.contains("shader") || key.starts_with("linux-cgroup") || key == "keybind" {
        "advanced"
    } else {
        "normal"
    }
}

fn reference_reason(
    key: &str,
    repeatable: bool,
    risk: &str,
    platform: Option<&str>,
    runtime_platform: &str,
) -> &'static str {
    if platform.is_some_and(|required| !platform_matches(required, runtime_platform)) {
        "platform-unavailable"
    } else if key == "theme" {
        "needs-theme-picker"
    } else if risk == "sensitive" {
        "protected"
    } else if repeatable {
        "needs-list-editor"
    } else if risk == "advanced" {
        "advanced-setting"
    } else {
        "needs-editor"
    }
}

fn platform_matches(required: &str, runtime: &str) -> bool {
    matches!((required, runtime), ("macOS", "macos") | ("Linux", "linux"))
}

fn platform_for(key: &str, description: &str) -> Option<String> {
    let explicit = if key.starts_with("macos-")
        || matches!(
            key,
            "auto-update"
                | "auto-update-channel"
                | "quick-terminal-animation-duration"
                | "quick-terminal-screen"
                | "undo-timeout"
                | "window-colorspace"
                | "window-position-x"
                | "window-position-y"
                | "window-save-state"
                | "window-vsync"
        ) {
        Some("macOS")
    } else if key.starts_with("gtk-")
        || key.starts_with("linux-")
        || key.starts_with("x11-")
        || matches!(
            key,
            "async-backend"
                | "class"
                | "language"
                | "quick-terminal-keyboard-interactivity"
                | "quit-after-last-window-closed-delay"
                | "window-show-tab-bar"
                | "window-subtitle"
        )
    {
        Some("Linux")
    } else {
        None
    };
    if let Some(platform) = explicit {
        return Some(platform.to_string());
    }

    let lower = description.to_ascii_lowercase();
    if lower.contains("only supported on macos")
        || lower.contains("macos only")
        || lower.contains("only supported currently on macos")
        || lower.contains("currently only supported on macos")
    {
        Some("macOS".to_string())
    } else if lower.contains("only supported on linux")
        || lower.contains("linux only")
        || lower.contains("gtk only")
        || lower.contains("only affects gtk")
        || lower.contains("only supported currently on linux")
    {
        Some("Linux".to_string())
    } else {
        None
    }
}

fn since_for(description: &str) -> Option<String> {
    let marker = "Available since:";
    let remainder = description.split_once(marker)?.1.trim_start();
    let version = remainder
        .split_whitespace()
        .next()?
        .trim_end_matches(|character: char| !character.is_ascii_digit());
    (!version.is_empty()).then(|| version.to_string())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    const AUDITED_FIXTURE: &str =
        include_str!("../../tests/fixtures/ghostty/1.3.1-macos/show-config-default-docs.txt");
    const EXPECTED_CONTRACT: &str =
        include_str!("../../tests/fixtures/ghostty/1.3.1-macos/expected-contract.json");

    fn test_catalog(key: &str, fingerprint: &str) -> Catalog {
        let json = format!(
            r#"{{
              "formatVersion": 1,
              "ghostty": ">=1.3.0, <1.4.0",
              "options": [{{
                "key": "{key}",
                "observedFingerprints": ["{fingerprint}"],
                "kind": "number",
                "choices": [],
                "repeatable": false,
                "risk": "normal",
                "capability": {{
                  "editMode": "control",
                  "reason": null,
                  "activation": "reload",
                  "constraintBehavior": "reject",
                  "min": 0,
                  "max": 100,
                  "step": 1,
                  "unit": null,
                  "platform": null
                }}
              }}]
            }}"#
        );
        Catalog::from_slice(json.as_bytes()).unwrap()
    }

    #[test]
    fn parses_documentation_defaults_and_repeatable_values() {
        let source = "# Font fallback.\nfont-family = JetBrains Mono\n\n# Another fallback.\nfont-family = \n# Cursor.\ncursor-style = block\n";
        let options = parse_observed_document(source);
        let font = options
            .iter()
            .find(|option| option.key == "font-family")
            .unwrap();
        assert!(font.repeatable);
        assert_eq!(font.default_values, ["JetBrains Mono", ""]);
        assert_eq!(font.entries[1].documentation, "Another fallback.");
    }

    #[test]
    fn platform_metadata_covers_prefixed_and_cross_platform_named_settings() {
        assert_eq!(platform_for("macos-hidden", ""), Some("macOS".to_string()));
        assert_eq!(platform_for("gtk-titlebar", ""), Some("Linux".to_string()));
        assert_eq!(platform_for("auto-update", ""), Some("macOS".to_string()));
        assert_eq!(platform_for("language", ""), Some("Linux".to_string()));
        assert_eq!(platform_for("font-size", ""), None);
    }

    #[test]
    fn a_changed_setting_does_not_disable_an_unrelated_setting() {
        let observed = parse_observed_document("# A.\nfont-size = 13\n# B.\nfuture = 1\n");
        let font = observed
            .iter()
            .find(|option| option.key == "font-size")
            .unwrap();
        let catalog = test_catalog("font-size", &observed_fingerprint(font));
        let runtime = build_runtime_options(observed, Some("1.3.1"), "macos", &catalog);
        let font = runtime
            .iter()
            .find(|option| option.key == "font-size")
            .unwrap();
        let future = runtime
            .iter()
            .find(|option| option.key == "future")
            .unwrap();
        assert!(font.editable);
        assert_eq!(font.capability.edit_mode, "control");
        assert!(!future.editable);
        assert_eq!(future.capability.reason.as_deref(), Some("needs-editor"));
    }

    #[test]
    fn fingerprints_are_scoped_to_one_setting() {
        let before = parse_observed_document("# A.\nfont-size = 13\n# B.\nfuture = 1\n");
        let after = parse_observed_document("# A.\nfont-size = 13\n# B changed.\nfuture = 2\n");
        let fingerprint = |options: &[ObservedOption], key: &str| {
            observed_fingerprint(options.iter().find(|option| option.key == key).unwrap())
        };
        assert_eq!(
            fingerprint(&before, "font-size"),
            fingerprint(&after, "font-size")
        );
        assert_ne!(
            fingerprint(&before, "future"),
            fingerprint(&after, "future")
        );
    }

    #[test]
    fn themes_are_classified_as_protected_inputs() {
        let catalog = Catalog::bundled().unwrap();
        let options = build_runtime_options(
            parse_observed_document("theme = Example\n"),
            Some("1.3.1"),
            "macos",
            &catalog,
        );
        assert_eq!(options[0].risk, "sensitive");
        assert!(!options[0].editable);
        assert_eq!(
            options[0].capability.reason.as_deref(),
            Some("needs-theme-picker")
        );
    }

    #[test]
    fn committed_ghostty_fixture_proves_the_complete_writable_contract_offline() {
        let expected: serde_json::Value = serde_json::from_str(EXPECTED_CONTRACT).unwrap();
        assert_eq!(
            expected["version"].as_str(),
            Some(runtime_contract::AUDITED_GHOSTTY_VERSION)
        );
        assert_eq!(
            expected["channel"].as_str(),
            Some(runtime_contract::AUDITED_GHOSTTY_CHANNEL)
        );
        assert_eq!(
            expected["platform"].as_str(),
            Some(runtime_contract::AUDITED_PLATFORM)
        );
        assert_eq!(
            expected["schemaHash"].as_str(),
            Some(runtime_contract::AUDITED_SCHEMA_HASH)
        );
        assert_eq!(
            expected["fixtureBytes"].as_u64(),
            Some(AUDITED_FIXTURE.len() as u64)
        );
        let schema = build(
            AUDITED_FIXTURE,
            Some(runtime_contract::AUDITED_GHOSTTY_VERSION.to_string()),
            Some(runtime_contract::AUDITED_GHOSTTY_CHANNEL.to_string()),
            runtime_contract::AUDITED_PLATFORM,
        )
        .unwrap();
        assert_eq!(schema.schema_hash, expected["schemaHash"]);
        assert_eq!(
            schema.options.len() as u64,
            expected["observedOptionCount"].as_u64().unwrap()
        );
        assert_eq!(
            runtime_contract::AUDITED_CONTRACT_ID,
            expected["contractId"].as_str().unwrap()
        );
        assert!(schema.diagnostics.is_empty());
        let expected_scalar_keys = expected["writableScalarKeys"]
            .as_array()
            .unwrap()
            .iter()
            .map(|key| key.as_str().unwrap())
            .collect::<Vec<_>>();
        let expected_special_editors = expected["specialEditors"]
            .as_array()
            .unwrap()
            .iter()
            .map(|key| key.as_str().unwrap())
            .collect::<Vec<_>>();

        let writable = runtime_contract::writable_options(&schema);
        let scalar_keys = writable
            .values()
            .filter(|option| option.editable)
            .map(|option| option.key.as_str())
            .collect::<Vec<_>>();
        let special_editors = writable
            .values()
            .filter(|option| !option.editable)
            .map(|option| option.key.as_str())
            .collect::<Vec<_>>();
        assert_eq!(scalar_keys, expected_scalar_keys);
        assert_eq!(special_editors, expected_special_editors);

        for (version, channel, platform, expected_reason) in [
            ("1.3.0", "stable", "macos", "version-not-supported"),
            ("1.3.1", "tip", "macos", "version-not-supported"),
            ("1.3.1", "stable", "linux", "platform-unavailable"),
        ] {
            let read_only = build(
                AUDITED_FIXTURE,
                Some(version.to_string()),
                Some(channel.to_string()),
                platform,
            )
            .unwrap();
            assert!(runtime_contract::writable_options(&read_only).is_empty());
            assert!(read_only
                .options
                .iter()
                .filter(|option| expected_scalar_keys.contains(&option.key.as_str()))
                .all(|option| option.capability.reason.as_deref() == Some(expected_reason)));
        }

        let changed_document = format!("{AUDITED_FIXTURE}\n");
        let changed = build(
            &changed_document,
            Some("1.3.1".to_string()),
            Some("stable".to_string()),
            "macos",
        )
        .unwrap();
        assert!(runtime_contract::writable_options(&changed).is_empty());
        assert!(changed
            .options
            .iter()
            .filter(|option| expected_scalar_keys.contains(&option.key.as_str()))
            .all(|option| option.capability.reason.as_deref() == Some("setting-changed")));
    }

    #[test]
    fn installed_ghostty_schema_is_large_when_binary_is_available() {
        let Ok(runtime) = ghostty::resolve() else {
            return;
        };
        let schema = load(
            &runtime.identity,
            runtime.version.clone(),
            runtime.channel.clone(),
        )
        .unwrap();
        assert!(
            schema.options.len() >= 150,
            "found only {} options",
            schema.options.len()
        );
        let unique = schema
            .options
            .iter()
            .map(|option| &option.key)
            .collect::<std::collections::HashSet<_>>();
        assert_eq!(unique.len(), schema.options.len());
        assert!(schema
            .options
            .iter()
            .all(|option| { option.editable == (option.capability.edit_mode == "control") }));
        if runtime.version.as_deref() == Some("1.3.1") {
            assert_eq!(schema.schema_hash, runtime_contract::AUDITED_SCHEMA_HASH);
            assert!(schema
                .options
                .iter()
                .find(|option| option.key == "font-size")
                .is_some_and(|option| option.editable && option.kind == "number"));
            assert!(
                schema
                    .options
                    .iter()
                    .filter(|option| option.editable)
                    .count()
                    >= 20
            );
            let image = schema
                .options
                .iter()
                .find(|option| option.key == "background-image")
                .unwrap();
            assert_eq!(image.capability.reason.as_deref(), Some("needs-editor"));
            assert_eq!(image.capability.activation, "reload");
            let image_opacity = schema
                .options
                .iter()
                .find(|option| option.key == "background-image-opacity")
                .unwrap();
            assert!(image_opacity.editable);
            assert_eq!(image_opacity.capability.min, Some(0.0));
            assert_eq!(image_opacity.capability.max, None);
        }
    }
}
