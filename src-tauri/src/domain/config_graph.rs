use std::{
    collections::{HashMap, VecDeque},
    fs,
    path::{Path, PathBuf},
};

use serde::Serialize;
use sha2::{Digest, Sha256};

use crate::{
    domain::{config_document::ConfigDocument, safe_write},
    error::CommandError,
};

const MAX_GRAPH_FILES: usize = 64;
const MAX_GRAPH_DEPTH: usize = 16;
const MAX_TOTAL_BYTES: u64 = 8 * 1024 * 1024;
const MAX_GRAPH_EDGES: usize = 4_096;
const MAX_ASSIGNMENTS_PER_FILE: usize = 20_000;
const MAX_GRAPH_DIAGNOSTICS: usize = 512;

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigGraph {
    pub complete: bool,
    pub semantics_known: bool,
    pub nodes: Vec<ConfigNode>,
    pub edges: Vec<ConfigEdge>,
    pub provenance: Vec<ProvenanceEntry>,
    pub diagnostics: Vec<GraphDiagnostic>,
    pub total_bytes: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigNode {
    pub id: String,
    pub path: String,
    pub load_index: usize,
    pub depth: usize,
    pub assignment_count: usize,
    pub symlink: bool,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ConfigEdge {
    pub from_id: String,
    pub to_id: Option<String>,
    pub declared_path: String,
    pub line: usize,
    pub optional: bool,
    pub status: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProvenanceEntry {
    pub key: String,
    pub source_id: String,
    pub source_path: String,
    pub line: usize,
    pub load_index: usize,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GraphDiagnostic {
    pub code: String,
    pub message: String,
    pub path: Option<String>,
    pub line: Option<usize>,
}

struct QueueEntry {
    path: PathBuf,
    depth: usize,
    edge_index: Option<usize>,
}

pub fn build(
    roots: Vec<PathBuf>,
    allowed_roots: Vec<PathBuf>,
) -> Result<ConfigGraph, CommandError> {
    let allowed_roots = allowed_roots
        .into_iter()
        // Keep the declared directory identity. Canonicalizing a symlinked
        // parent here could silently authorize its much broader real target.
        .filter(|path| path.is_absolute())
        .map(|path| {
            let inside_home = std::env::var_os("HOME")
                .map(PathBuf::from)
                .is_some_and(|home| path.starts_with(home));
            if inside_home {
                path
            } else {
                fs::canonicalize(&path).unwrap_or(path)
            }
        })
        .collect::<Vec<_>>();
    let mut queue = roots
        .into_iter()
        .filter(|path| path.is_file())
        .map(|path| QueueEntry {
            path,
            depth: 0,
            edge_index: None,
        })
        .collect::<VecDeque<_>>();
    let mut visited = HashMap::<PathBuf, String>::new();
    let mut nodes = Vec::new();
    let mut edges: Vec<ConfigEdge> = Vec::new();
    let mut provenance = Vec::new();
    let mut diagnostics = Vec::new();
    let mut total_bytes = 0_u64;
    let mut parse_was_incomplete = false;

    while let Some(item) = queue.pop_front() {
        if nodes.len() >= MAX_GRAPH_FILES {
            diagnostics.push(diagnostic(
                "graph_file_limit",
                format!("配置图超过 {MAX_GRAPH_FILES} 个文件，已停止继续加载。"),
                None,
                None,
            ));
            break;
        }
        if item.depth > MAX_GRAPH_DEPTH {
            diagnostics.push(diagnostic(
                "graph_depth_limit",
                format!("include 深度超过 {MAX_GRAPH_DEPTH} 层。"),
                Some(&item.path),
                None,
            ));
            continue;
        }

        let normalized = match fs::canonicalize(&item.path) {
            Ok(path) => path,
            Err(error) => {
                if let Some(edge_index) = item.edge_index {
                    if let Some(edge) = edges.get_mut(edge_index) {
                        edge.status = "missing".to_string();
                    }
                }
                diagnostics.push(diagnostic(
                    "config_read_failed",
                    format!("无法读取配置文件：{error}"),
                    Some(&item.path),
                    None,
                ));
                continue;
            }
        };
        if let Some(existing_id) = visited.get(&normalized) {
            if let Some(edge_index) = item.edge_index {
                if let Some(edge) = edges.get_mut(edge_index) {
                    edge.to_id = Some(existing_id.clone());
                    edge.status = "cycle_or_duplicate".to_string();
                }
            }
            diagnostics.push(diagnostic(
                "cycle_or_duplicate",
                "同一配置文件被重复引用；Ghostty 会将其视为 cycle/duplicate。".to_string(),
                Some(&normalized),
                None,
            ));
            continue;
        }
        if item.depth > 0 && !is_within_allowed_roots(&normalized, &allowed_roots) {
            if let Some(edge_index) = item.edge_index {
                if let Some(edge) = edges.get_mut(edge_index) {
                    edge.status = "permission_required".to_string();
                }
            }
            diagnostics.push(diagnostic(
                "external_include_blocked",
                "include 位于已授权 Ghostty 目录之外，需要单独授权后才能读取。".to_string(),
                Some(&normalized),
                None,
            ));
            continue;
        }

        let bytes = safe_write::read_regular_target_file(&normalized)?;
        total_bytes = total_bytes.saturating_add(bytes.len() as u64);
        if total_bytes > MAX_TOTAL_BYTES {
            diagnostics.push(diagnostic(
                "graph_byte_limit",
                "配置图总大小超过 8 MiB，已停止继续加载。".to_string(),
                Some(&normalized),
                None,
            ));
            break;
        }
        let document = match ConfigDocument::parse(&bytes) {
            Ok(document) => document,
            Err(error) => {
                parse_was_incomplete = true;
                diagnostics.push(diagnostic(
                    error.code,
                    error.message,
                    Some(&normalized),
                    None,
                ));
                continue;
            }
        };
        let assignments = document.assignments();
        if assignments.len() > MAX_ASSIGNMENTS_PER_FILE {
            diagnostics.push(diagnostic(
                "assignment_limit",
                format!("单个配置文件超过 {MAX_ASSIGNMENTS_PER_FILE} 个赋值，已停止构建来源图。"),
                Some(&normalized),
                None,
            ));
            break;
        }
        let id = path_id(&normalized);
        let load_index = nodes.len();
        visited.insert(normalized.clone(), id.clone());
        if let Some(edge_index) = item.edge_index {
            if let Some(edge) = edges.get_mut(edge_index) {
                edge.to_id = Some(id.clone());
                edge.status = "loaded".to_string();
            }
        }
        nodes.push(ConfigNode {
            id: id.clone(),
            path: normalized.to_string_lossy().to_string(),
            load_index,
            depth: item.depth,
            assignment_count: assignments.len(),
            symlink: fs::symlink_metadata(&item.path)
                .map(|metadata| metadata.file_type().is_symlink())
                .unwrap_or(false)
                || item.path != normalized,
        });

        for assignment in assignments {
            if assignment.key == "config-file" {
                if edges.len() >= MAX_GRAPH_EDGES || queue.len() >= MAX_GRAPH_EDGES {
                    diagnostics.push(diagnostic(
                        "graph_edge_limit",
                        format!("配置图超过 {MAX_GRAPH_EDGES} 条 include 边，已停止继续排队。"),
                        Some(&normalized),
                        Some(assignment.line),
                    ));
                    break;
                }
                let parsed = parse_include_value(&assignment.value);
                let target = resolve_include(&normalized, &parsed.path);
                let edge_index = edges.len();
                edges.push(ConfigEdge {
                    from_id: id.clone(),
                    to_id: None,
                    declared_path: parsed.path.clone(),
                    line: assignment.line,
                    optional: parsed.optional,
                    status: "queued".to_string(),
                });
                if !target.exists() && parsed.optional {
                    if let Some(edge) = edges.get_mut(edge_index) {
                        edge.status = "optional_missing".to_string();
                    }
                    continue;
                }
                queue.push_back(QueueEntry {
                    path: target,
                    depth: item.depth + 1,
                    edge_index: Some(edge_index),
                });
            } else {
                provenance.push(ProvenanceEntry {
                    key: assignment.key,
                    source_id: id.clone(),
                    source_path: normalized.to_string_lossy().to_string(),
                    line: assignment.line,
                    load_index,
                });
            }
        }
    }

    let diagnostics_were_truncated = diagnostics.len() > MAX_GRAPH_DIAGNOSTICS;
    let complete = !parse_was_incomplete
        && !diagnostics_were_truncated
        && !diagnostics.iter().any(|item| {
            matches!(
                item.code.as_str(),
                "graph_file_limit"
                    | "graph_depth_limit"
                    | "config_read_failed"
                    | "external_include_blocked"
                    | "graph_byte_limit"
                    | "assignment_limit"
                    | "graph_edge_limit"
            )
        });
    diagnostics.truncate(MAX_GRAPH_DIAGNOSTICS);

    Ok(ConfigGraph {
        complete,
        // This graph records assignment provenance only. It intentionally does
        // not claim scalar/append/reset/map merge semantics yet.
        semantics_known: false,
        nodes,
        edges,
        provenance,
        diagnostics,
        total_bytes,
    })
}

struct ParsedInclude {
    path: String,
    optional: bool,
}

fn parse_include_value(value: &str) -> ParsedInclude {
    let trimmed = value.trim();
    let (optional, remaining) = if let Some(rest) = trimmed.strip_prefix('?') {
        (true, rest.trim())
    } else {
        (false, trimmed)
    };
    ParsedInclude {
        path: unquote(remaining).to_string(),
        optional,
    }
}

fn unquote(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|rest| rest.strip_suffix('"'))
        .unwrap_or(value)
}

fn resolve_include(source: &Path, declared: &str) -> PathBuf {
    if let Some(rest) = declared.strip_prefix("~/") {
        if let Some(home) = std::env::var_os("HOME") {
            return PathBuf::from(home).join(rest);
        }
    }
    let path = PathBuf::from(declared);
    if path.is_absolute() {
        path
    } else {
        source.parent().unwrap_or_else(|| Path::new(".")).join(path)
    }
}

fn is_within_allowed_roots(path: &Path, roots: &[PathBuf]) -> bool {
    roots.iter().any(|root| path.starts_with(root))
}

fn path_id(path: &Path) -> String {
    format!(
        "node-{}",
        hex(&Sha256::digest(path.as_os_str().as_encoded_bytes())[..12])
    )
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn diagnostic(
    code: impl Into<String>,
    message: impl Into<String>,
    path: Option<&Path>,
    line: Option<usize>,
) -> GraphDiagnostic {
    GraphDiagnostic {
        code: code.into(),
        message: message.into(),
        path: path.map(|value| value.to_string_lossy().to_string()),
        line,
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn follows_includes_breadth_first_and_records_provenance() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        let first = directory.path().join("first.conf");
        let second = directory.path().join("second.conf");
        let nested = directory.path().join("nested.conf");
        fs::write(
            &root,
            b"font-size = 12\nconfig-file = first.conf\nconfig-file = second.conf\n",
        )
        .unwrap();
        fs::write(&first, b"background = 000000\nconfig-file = nested.conf\n").unwrap();
        fs::write(&second, b"foreground = ffffff\n").unwrap();
        fs::write(&nested, b"font-size = 14\n").unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
        assert!(graph.complete);
        assert!(!graph.semantics_known);
        let names = graph
            .nodes
            .iter()
            .map(|node| {
                Path::new(&node.path)
                    .file_name()
                    .unwrap()
                    .to_string_lossy()
                    .to_string()
            })
            .collect::<Vec<_>>();
        assert_eq!(
            names,
            ["config", "first.conf", "second.conf", "nested.conf"]
        );
        assert_eq!(
            graph
                .provenance
                .iter()
                .filter(|item| item.key == "font-size")
                .count(),
            2
        );
    }

    #[test]
    fn blocks_external_includes_without_reading_them() {
        let allowed = tempfile::tempdir().unwrap();
        let external = tempfile::tempdir().unwrap();
        let root = allowed.path().join("config");
        let secret = external.path().join("secret.conf");
        fs::write(&secret, b"env = TOKEN=secret\n").unwrap();
        fs::write(
            &root,
            format!("config-file = {}\n", secret.display()).as_bytes(),
        )
        .unwrap();

        let graph = build(vec![root], vec![allowed.path().to_path_buf()]).unwrap();
        assert!(!graph.complete);
        assert_eq!(graph.nodes.len(), 1);
        assert_eq!(graph.edges[0].status, "permission_required");
        assert!(!graph.provenance.iter().any(|item| item.key == "env"));
    }

    #[test]
    fn optional_missing_include_is_not_an_error() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        fs::write(&root, b"config-file = ?missing.conf\n").unwrap();
        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
        assert_eq!(graph.edges[0].status, "optional_missing");
        assert!(graph.diagnostics.is_empty());
    }

    #[test]
    fn non_utf8_files_make_the_observation_graph_incomplete() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        fs::write(&root, [0xff, 0xfe, b'=', b'1']).unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
        assert!(!graph.complete);
        assert!(graph.nodes.is_empty());
        assert!(graph
            .diagnostics
            .iter()
            .any(|diagnostic| diagnostic.code == "invalid_encoding"));
    }
}
