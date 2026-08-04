use std::collections::BTreeMap;

use crate::error::CommandError;

const MAX_CONFIG_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug, Clone, PartialEq, Eq)]
pub enum LineKind {
    Blank,
    Comment,
    Assignment { key: String, value: String },
    Opaque,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigLine {
    pub raw: String,
    pub ending: String,
    pub kind: LineKind,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ConfigDocument {
    bom: bool,
    lines: Vec<ConfigLine>,
}

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct AssignmentView {
    pub line: usize,
    pub key: String,
    pub value: String,
}

impl ConfigDocument {
    pub fn parse(bytes: &[u8]) -> Result<Self, CommandError> {
        if bytes.len() > MAX_CONFIG_BYTES {
            return Err(CommandError::new(
                "config_too_large",
                format!("configuration exceeds {MAX_CONFIG_BYTES} bytes"),
            ));
        }

        let (bom, payload) = if bytes.starts_with(&[0xEF, 0xBB, 0xBF]) {
            (true, &bytes[3..])
        } else {
            (false, bytes)
        };
        let text = std::str::from_utf8(payload).map_err(|_| {
            CommandError::new(
                "invalid_encoding",
                "configuration is not valid UTF-8; it can only be opened read-only",
            )
        })?;

        let mut lines = Vec::new();
        let mut cursor = 0;
        let raw_bytes = text.as_bytes();
        while cursor < raw_bytes.len() {
            let newline = raw_bytes[cursor..]
                .iter()
                .position(|byte| *byte == b'\n')
                .map(|offset| cursor + offset);
            let (content_end, next, ending) = match newline {
                Some(index) if index > cursor && raw_bytes[index - 1] == b'\r' => {
                    (index - 1, index + 1, "\r\n")
                }
                Some(index) => (index, index + 1, "\n"),
                None => (raw_bytes.len(), raw_bytes.len(), ""),
            };
            let raw = text[cursor..content_end].to_string();
            lines.push(ConfigLine {
                kind: parse_line_kind(&raw),
                raw,
                ending: ending.to_string(),
            });
            cursor = next;
        }

        Ok(Self { bom, lines })
    }

    pub fn render(&self) -> Vec<u8> {
        let capacity = self
            .lines
            .iter()
            .map(|line| line.raw.len() + line.ending.len())
            .sum::<usize>()
            + if self.bom { 3 } else { 0 };
        let mut output = Vec::with_capacity(capacity);
        if self.bom {
            output.extend_from_slice(&[0xEF, 0xBB, 0xBF]);
        }
        for line in &self.lines {
            output.extend_from_slice(line.raw.as_bytes());
            output.extend_from_slice(line.ending.as_bytes());
        }
        output
    }

    pub fn values(&self) -> BTreeMap<String, Vec<String>> {
        let mut values = BTreeMap::<String, Vec<String>>::new();
        for line in &self.lines {
            if let LineKind::Assignment { key, value } = &line.kind {
                values.entry(key.clone()).or_default().push(value.clone());
            }
        }
        values
    }

    pub fn assignments(&self) -> Vec<AssignmentView> {
        self.lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| match &line.kind {
                LineKind::Assignment { key, value } => Some(AssignmentView {
                    line: index + 1,
                    key: key.clone(),
                    value: value.clone(),
                }),
                _ => None,
            })
            .collect()
    }

    pub fn set_scalar(&mut self, key: &str, value: &str) -> Result<(), CommandError> {
        validate_edit(key, value)?;
        let matching = self
            .lines
            .iter()
            .enumerate()
            .filter_map(|(index, line)| match &line.kind {
                LineKind::Assignment { key: existing, .. } if existing == key => Some(index),
                _ => None,
            })
            .next_back();

        if let Some(index) = matching {
            let line = &mut self.lines[index];
            let equals = line.raw.find('=').ok_or_else(|| {
                CommandError::new(
                    "document_invariant_failed",
                    "an assignment lost its equals delimiter; refusing to rewrite the document",
                )
            })?;
            let right = &line.raw[equals + 1..];
            let trimmed_start = right.trim_start_matches([' ', '\t']);
            let leading_len = right.len() - trimmed_start.len();
            let trimmed = trimmed_start.trim_end_matches([' ', '\t']);
            let trailing_start = leading_len + trimmed.len();
            let before_value = &line.raw[..equals + 1];
            let leading = &right[..leading_len];
            let trailing = &right[trailing_start..];
            line.raw = format!("{before_value}{leading}{value}{trailing}");
            line.kind = LineKind::Assignment {
                key: key.to_string(),
                value: value.to_string(),
            };
            return Ok(());
        }

        let ending = self.dominant_ending().to_string();
        let had_trailing_newline = self
            .lines
            .last()
            .is_some_and(|line| !line.ending.is_empty());
        if let Some(last) = self.lines.last_mut() {
            if last.ending.is_empty() {
                last.ending = ending.clone();
            }
        }
        self.lines.push(ConfigLine {
            raw: format!("{key} = {value}"),
            ending: if had_trailing_newline {
                ending
            } else {
                String::new()
            },
            kind: LineKind::Assignment {
                key: key.to_string(),
                value: value.to_string(),
            },
        });
        Ok(())
    }

    pub fn duplicate_count(&self, key: &str) -> usize {
        self.lines
            .iter()
            .filter(|line| {
                matches!(&line.kind, LineKind::Assignment { key: existing, .. } if existing == key)
            })
            .count()
    }

    fn dominant_ending(&self) -> &str {
        let crlf = self
            .lines
            .iter()
            .filter(|line| line.ending == "\r\n")
            .count();
        let lf = self.lines.iter().filter(|line| line.ending == "\n").count();
        if crlf > lf {
            "\r\n"
        } else {
            "\n"
        }
    }
}

fn parse_line_kind(raw: &str) -> LineKind {
    let trimmed = raw.trim();
    if trimmed.is_empty() {
        return LineKind::Blank;
    }
    if raw.trim_start().starts_with('#') {
        return LineKind::Comment;
    }
    let Some(equals) = raw.find('=') else {
        return LineKind::Opaque;
    };
    let key = raw[..equals].trim();
    if key.is_empty() || key.chars().any(char::is_whitespace) {
        return LineKind::Opaque;
    }
    LineKind::Assignment {
        key: key.to_string(),
        value: raw[equals + 1..].trim().to_string(),
    }
}

fn validate_edit(key: &str, value: &str) -> Result<(), CommandError> {
    if key.is_empty()
        || !key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
    {
        return Err(CommandError::new(
            "invalid_key",
            "setting keys may contain lowercase ASCII letters, digits, and hyphens",
        ));
    }
    if value.contains(['\n', '\r']) {
        return Err(CommandError::new(
            "invalid_value",
            "a setting value cannot contain a newline",
        ));
    }
    if value.len() > 64 * 1024 {
        return Err(CommandError::new(
            "value_too_large",
            "a setting value cannot exceed 64 KiB",
        ));
    }
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn untouched_document_round_trips_exactly() {
        let input =
            b"\xEF\xBB\xBF# hello\r\nfont-family = \"JetBrains Mono\"\r\n\r\nbackground = #1e1e2e";
        let document = ConfigDocument::parse(input).unwrap();
        assert_eq!(document.render(), input);
    }

    #[test]
    fn editing_changes_only_the_last_matching_assignment() {
        let input = b"font-size=12\n# keep me\nfont-size = 13  \nbackground=000000\n";
        let mut document = ConfigDocument::parse(input).unwrap();
        document.set_scalar("font-size", "14").unwrap();
        assert_eq!(
            document.render(),
            b"font-size=12\n# keep me\nfont-size = 14  \nbackground=000000\n"
        );
    }

    #[test]
    fn appending_preserves_crlf_and_trailing_newline_policy() {
        let mut with_newline = ConfigDocument::parse(b"font-size = 13\r\n").unwrap();
        with_newline.set_scalar("background", "000000").unwrap();
        assert_eq!(
            with_newline.render(),
            b"font-size = 13\r\nbackground = 000000\r\n"
        );

        let mut without_newline = ConfigDocument::parse(b"font-size = 13").unwrap();
        without_newline.set_scalar("background", "000000").unwrap();
        assert_eq!(
            without_newline.render(),
            b"font-size = 13\nbackground = 000000"
        );
    }

    #[test]
    fn values_may_contain_equals_and_hashes() {
        let document =
            ConfigDocument::parse(b"keybind = ctrl+a=text:a=b\nbackground = #1e1e2e\n").unwrap();
        let values = document.values();
        assert_eq!(values["keybind"], ["ctrl+a=text:a=b"]);
        assert_eq!(values["background"], ["#1e1e2e"]);
    }

    #[test]
    fn rejects_newline_injected_edits() {
        let mut document = ConfigDocument::parse(b"font-size = 13\n").unwrap();
        let error = document
            .set_scalar("font-size", "13\ncommand = bad")
            .unwrap_err();
        assert_eq!(error.code, "invalid_value");
    }
}
