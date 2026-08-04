use std::{collections::BTreeMap, path::Path};

use sha2::{Digest, Sha256};

use crate::{
    domain::ghostty,
    error::CommandError,
    models::{RuntimeOption, RuntimeSchema},
};

const AUDITED_GHOSTTY_VERSION: &str = "1.3.1";
const AUDITED_SCHEMA_HASH: &str =
    "5e36480fe2ec3d510ffc32de84c617fbaca10e1330c097185301b51ab9c10e6c";

pub fn load(executable: &Path, version: Option<String>) -> Result<RuntimeSchema, CommandError> {
    let document = ghostty::show_default_config_with_docs(executable)?;
    let schema_hash = hex(&Sha256::digest(document.as_bytes()));
    let contract_matches =
        version.as_deref() == Some(AUDITED_GHOSTTY_VERSION) && schema_hash == AUDITED_SCHEMA_HASH;
    let options = parse_document(&document, contract_matches);
    let diagnostics = if contract_matches {
        Vec::new()
    } else {
        vec![format!(
            "当前 Ghostty 版本尚未适配，设置暂时只读（检测到 {}）。",
            version.as_deref().unwrap_or("未知版本")
        )]
    };
    Ok(RuntimeSchema {
        ghostty_version: version,
        schema_hash,
        options,
        diagnostics,
    })
}

fn parse_document(document: &str, contract_matches: bool) -> Vec<RuntimeOption> {
    let mut options = BTreeMap::<String, RuntimeOption>::new();
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

        if let Some(existing) = options.get_mut(key) {
            existing.default_values.push(value);
            existing.repeatable = true;
            existing.editable = false;
            continue;
        }
        let contract = contract_matches.then(|| audited_contract(key)).flatten();
        let (kind, choices) = match contract {
            Some((kind, choices)) => (
                kind,
                choices.iter().map(|choice| (*choice).to_string()).collect(),
            ),
            None => ("text", Vec::new()),
        };
        let platform = platform_for(&description);
        let repeatable = known_repeatable(key);
        let risk = risk_for(key);
        options.insert(
            key.to_string(),
            RuntimeOption {
                key: key.to_string(),
                description,
                default_values: vec![value.clone()],
                // `+show-config --default --docs` is a defaults catalog, not
                // the user's complete effective configuration.
                current_values: Vec::new(),
                category: category_for(key).to_string(),
                kind: kind.to_string(),
                choices,
                repeatable,
                platform,
                since: None,
                risk: risk.to_string(),
                editable: contract.is_some() && !repeatable && risk == "normal",
            },
        );
    }

    options.into_values().collect()
}

fn category_for(key: &str) -> &'static str {
    if key.starts_with("font-") || key.starts_with("adjust-font") {
        "字体"
    } else if key.starts_with("cursor-") || key.starts_with("adjust-cursor") {
        "光标"
    } else if key.starts_with("window-") || key.starts_with("resize-") {
        "窗口"
    } else if key.starts_with("quick-terminal-") {
        "快速终端"
    } else if key.starts_with("clipboard-") || key.contains("paste") || key.contains("copy") {
        "隐私与安全"
    } else if key.starts_with("mouse-") || key.contains("scroll") {
        "鼠标与滚动"
    } else if key.starts_with("shell-")
        || key == "command"
        || key == "initial-command"
        || key == "env"
    {
        "Shell 与环境"
    } else if key.starts_with("macos-") {
        "macOS"
    } else if key.starts_with("gtk-") || key.starts_with("linux-") || key.starts_with("x11-") {
        "Linux / GTK"
    } else if key == "theme"
        || key == "background"
        || key == "foreground"
        || key == "palette"
        || key.starts_with("selection-")
    {
        "外观"
    } else if key == "keybind" || key.starts_with("key-") {
        "快捷键"
    } else {
        "高级"
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

/// Positive allowlist for the generic renderer-to-Rust scalar edit path.
/// New Ghostty keys intentionally default to non-editable until their side
/// effects and override semantics have been reviewed.
fn audited_contract(key: &str) -> Option<(&'static str, &'static [&'static str])> {
    const NO_CHOICES: &[&str] = &[];
    const CURSOR_STYLES: &[&str] = &["block", "bar", "underline", "block_hollow"];
    match key {
        "font-size"
        | "minimum-contrast"
        | "background-opacity"
        | "cursor-opacity"
        | "unfocused-split-opacity" => Some(("number", NO_CHOICES)),
        "background"
        | "foreground"
        | "selection-foreground"
        | "selection-background"
        | "cursor-color"
        | "split-divider-color" => Some(("color", NO_CHOICES)),
        "cursor-style" => Some(("select", CURSOR_STYLES)),
        _ => None,
    }
}

fn platform_for(description: &str) -> Option<String> {
    let lower = description.to_ascii_lowercase();
    if lower.contains("only supported on macos") || lower.contains("macos only") {
        Some("macOS".to_string())
    } else if lower.contains("only supported on linux") || lower.contains("gtk only") {
        Some("Linux".to_string())
    } else {
        None
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_documentation_defaults_and_repeatable_values() {
        let source = "# Font fallback.\nfont-family = JetBrains Mono\n\n# Another fallback.\nfont-family = \n# Cursor.\ncursor-style = block\n";
        let options = parse_document(source, true);
        let font = options
            .iter()
            .find(|option| option.key == "font-family")
            .unwrap();
        assert!(font.repeatable);
        assert_eq!(font.default_values, ["JetBrains Mono", ""]);
        let cursor = options
            .iter()
            .find(|option| option.key == "cursor-style")
            .unwrap();
        assert_eq!(cursor.kind, "select");
        assert!(cursor.choices.contains(&"bar".to_string()));
    }

    #[test]
    fn themes_are_classified_as_sensitive_full_config_inputs() {
        let options = parse_document("theme = Example\n", true);
        assert_eq!(options[0].key, "theme");
        assert_eq!(options[0].risk, "sensitive");
        assert!(!options[0].editable);
    }

    #[test]
    fn generic_edits_use_a_positive_allowlist() {
        let options = parse_document(
            "font-size = 13\nbackground-blur = false\ncommand = /bin/sh\nfuture-unknown-setting = value\n",
            true,
        );
        let editable = options
            .iter()
            .map(|option| (option.key.as_str(), option.editable))
            .collect::<std::collections::HashMap<_, _>>();
        assert!(editable["font-size"]);
        assert!(!editable["background-blur"]);
        assert!(!editable["command"]);
        assert!(!editable["future-unknown-setting"]);
        let font_size = options
            .iter()
            .find(|option| option.key == "font-size")
            .unwrap();
        assert_eq!(font_size.kind, "number");
    }

    #[test]
    fn schema_mismatch_disables_even_known_contract_keys() {
        let options = parse_document("font-size = 13\nbackground = 000000\n", false);
        assert!(options.iter().all(|option| !option.editable));
    }

    #[test]
    fn installed_ghostty_schema_is_large_when_binary_is_available() {
        let Some(executable) = ghostty::locate() else {
            return;
        };
        let probe = ghostty::probe();
        let schema = load(&executable, probe.version.clone()).unwrap();
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
        if probe.version.as_deref() == Some(AUDITED_GHOSTTY_VERSION) {
            assert_eq!(schema.schema_hash, AUDITED_SCHEMA_HASH);
            assert!(schema
                .options
                .iter()
                .find(|option| option.key == "font-size")
                .is_some_and(|option| option.editable && option.kind == "number"));
        }
    }
}
