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
    pub graph_revision: String,
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
    #[serde(skip_serializing)]
    pub content_revision: String,
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
    /// Index in Ghostty's mutable RepeatablePath list. Default roots are
    /// loaded before that list is drained and therefore have no index.
    include_index: Option<usize>,
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
            include_index: None,
        })
        .collect::<VecDeque<_>>();
    let mut visited = HashMap::<PathBuf, String>::new();
    let mut nodes = Vec::new();
    let mut edges: Vec<ConfigEdge> = Vec::new();
    let mut provenance = Vec::new();
    let mut diagnostics = Vec::new();
    let mut total_bytes = 0_u64;
    let mut parse_was_incomplete = false;
    // Mirrors Config.@"config-file".value.items in Ghostty 1.3.1. A bare
    // value clears this whole list, even while loadRecursiveFiles is already
    // iterating it. Keeping the vector indices is important: Ghostty's `i`
    // still increments after the current include, so entries newly appended
    // at indices <= i are skipped rather than loaded.
    let mut config_file_edges = Vec::<usize>::new();

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
                        edge.status =
                            if edge.optional && error.kind() == std::io::ErrorKind::NotFound {
                                "optional_missing".to_string()
                            } else {
                                "missing".to_string()
                            };
                        if edge.optional && error.kind() == std::io::ErrorKind::NotFound {
                            continue;
                        }
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
            content_revision: safe_write::revision(&bytes),
        });

        for assignment in assignments {
            if assignment.key == "config-file" {
                if edges.len() >= MAX_GRAPH_EDGES {
                    diagnostics.push(diagnostic(
                        "graph_edge_limit",
                        format!("配置图超过 {MAX_GRAPH_EDGES} 条 include 边，已停止继续排队。"),
                        Some(&normalized),
                        Some(assignment.line),
                    ));
                    break;
                }
                match parse_include_value(&assignment.value) {
                    IncludeAction::Reset => {
                        edges.push(ConfigEdge {
                            from_id: id.clone(),
                            to_id: None,
                            declared_path: String::new(),
                            line: assignment.line,
                            optional: false,
                            status: "queue_reset".to_string(),
                        });
                        reset_config_file_list(&mut queue, &mut edges, &mut config_file_edges);
                    }
                    IncludeAction::IgnoredEmpty { optional } => {
                        edges.push(ConfigEdge {
                            from_id: id.clone(),
                            to_id: None,
                            declared_path: String::new(),
                            line: assignment.line,
                            optional,
                            status: "ignored_empty".to_string(),
                        });
                    }
                    IncludeAction::Path(parsed) => {
                        if queue.len() >= MAX_GRAPH_EDGES {
                            diagnostics.push(diagnostic(
                                "graph_edge_limit",
                                format!(
                                    "配置图超过 {MAX_GRAPH_EDGES} 条 include 边，已停止继续排队。"
                                ),
                                Some(&normalized),
                                Some(assignment.line),
                            ));
                            break;
                        }
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
                        let include_index = config_file_edges.len();
                        config_file_edges.push(edge_index);

                        // Exact Ghostty 1.3.1 behavior when an include clears
                        // config-file while loadRecursiveFiles is at index i:
                        // the loop increments i after the file returns. Any
                        // newly appended entries at indices 0..=i are never
                        // visited. This looks surprising, but predicting a
                        // source Ghostty did not load would be unsafe.
                        if item
                            .include_index
                            .is_some_and(|current| include_index <= current)
                        {
                            if let Some(edge) = edges.get_mut(edge_index) {
                                edge.status = "skipped_by_reset_cursor".to_string();
                            }
                            continue;
                        }
                        queue.push_back(QueueEntry {
                            path: target,
                            depth: item.depth + 1,
                            edge_index: Some(edge_index),
                            include_index: Some(include_index),
                        });
                    }
                }
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

    let graph_revision = graph_revision(complete, &nodes, &edges, &provenance, &diagnostics);

    Ok(ConfigGraph {
        graph_revision,
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

fn graph_revision(
    complete: bool,
    nodes: &[ConfigNode],
    edges: &[ConfigEdge],
    provenance: &[ProvenanceEntry],
    diagnostics: &[GraphDiagnostic],
) -> String {
    let mut digest = Sha256::new();
    digest.update(if complete {
        b"complete".as_slice()
    } else {
        b"incomplete".as_slice()
    });
    for node in nodes {
        digest.update(node.path.as_bytes());
        digest.update([0]);
        digest.update(node.content_revision.as_bytes());
        digest.update(node.load_index.to_le_bytes());
        digest.update(node.depth.to_le_bytes());
        digest.update([u8::from(node.symlink)]);
    }
    for edge in edges {
        digest.update(edge.from_id.as_bytes());
        digest.update([0]);
        if let Some(to_id) = &edge.to_id {
            digest.update(to_id.as_bytes());
        }
        digest.update([0]);
        digest.update(edge.declared_path.as_bytes());
        digest.update(edge.line.to_le_bytes());
        digest.update([u8::from(edge.optional)]);
        digest.update(edge.status.as_bytes());
    }
    for entry in provenance {
        digest.update(entry.key.as_bytes());
        digest.update([0]);
        digest.update(entry.source_id.as_bytes());
        digest.update(entry.line.to_le_bytes());
        digest.update(entry.load_index.to_le_bytes());
    }
    for diagnostic in diagnostics {
        digest.update(diagnostic.code.as_bytes());
        digest.update([0]);
        if let Some(path) = &diagnostic.path {
            digest.update(path.as_bytes());
        }
        digest.update(diagnostic.line.unwrap_or(0).to_le_bytes());
    }
    hex(&digest.finalize())
}

struct ParsedInclude {
    path: String,
    optional: bool,
}

enum IncludeAction {
    Reset,
    IgnoredEmpty { optional: bool },
    Path(ParsedInclude),
}

fn parse_include_value(value: &str) -> IncludeAction {
    let trimmed = value.trim();
    let (optional, remaining) = if let Some(rest) = trimmed.strip_prefix('?') {
        (true, rest.trim())
    } else {
        (false, trimmed)
    };
    if !optional && trimmed.is_empty() {
        return IncludeAction::Reset;
    }
    let path = unquote(remaining);
    if path.is_empty() {
        return IncludeAction::IgnoredEmpty { optional };
    }
    IncludeAction::Path(ParsedInclude {
        path: path.to_string(),
        optional,
    })
}

fn reset_config_file_list(
    queue: &mut VecDeque<QueueEntry>,
    edges: &mut [ConfigEdge],
    config_file_edges: &mut Vec<usize>,
) {
    queue.retain(|entry| {
        let Some(edge_index) = entry.edge_index else {
            // Default roots are not RepeatablePath entries and survive a
            // `config-file =` reset. Only config-file includes are discarded.
            return true;
        };
        if let Some(edge) = edges.get_mut(edge_index) {
            edge.status = "cancelled_by_reset".to_string();
        }
        false
    });
    for edge_index in config_file_edges.drain(..) {
        if let Some(edge) = edges.get_mut(edge_index) {
            if edge.status == "skipped_by_reset_cursor" {
                edge.status = "cancelled_by_reset".to_string();
            }
        }
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
    fn bare_empty_include_resets_pending_includes_but_keeps_default_roots() {
        let directory = tempfile::tempdir().unwrap();
        let first_root = directory.path().join("config");
        let second_root = directory.path().join("config.ghostty");
        let cancelled = directory.path().join("cancelled.conf");
        let surviving = directory.path().join("surviving.conf");
        fs::write(
            &first_root,
            b"config-file = cancelled.conf\nconfig-file =\nfont-size = 12\n",
        )
        .unwrap();
        fs::write(&second_root, b"config-file = surviving.conf\n").unwrap();
        fs::write(&cancelled, b"background = 000000\n").unwrap();
        fs::write(&surviving, b"foreground = ffffff\n").unwrap();

        let graph = build(
            vec![first_root, second_root],
            vec![directory.path().to_path_buf()],
        )
        .unwrap();
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

        assert_eq!(names, ["config", "config.ghostty", "surviving.conf"]);
        assert_eq!(graph.edges[0].status, "cancelled_by_reset");
        assert_eq!(graph.edges[1].status, "queue_reset");
        assert_eq!(graph.edges[2].status, "loaded");
        assert!(!graph
            .provenance
            .iter()
            .any(|entry| entry.key == "background"));
        assert!(graph
            .provenance
            .iter()
            .any(|entry| entry.key == "foreground"));
    }

    #[test]
    fn reset_in_first_include_skips_first_new_entry_at_the_current_cursor() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        let first = directory.path().join("first.conf");
        let cancelled = directory.path().join("cancelled.conf");
        let surviving = directory.path().join("surviving.conf");
        fs::write(
            &root,
            b"config-file = first.conf\nconfig-file = cancelled.conf\n",
        )
        .unwrap();
        fs::write(&first, b"config-file =\nconfig-file = surviving.conf\n").unwrap();
        fs::write(&cancelled, b"background = 000000\n").unwrap();
        fs::write(&surviving, b"foreground = ffffff\n").unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
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

        assert_eq!(names, ["config", "first.conf"]);
        assert_eq!(graph.edges[0].status, "loaded");
        assert_eq!(graph.edges[1].status, "cancelled_by_reset");
        assert_eq!(graph.edges[2].status, "queue_reset");
        assert_eq!(graph.edges[3].status, "skipped_by_reset_cursor");
        assert!(!graph
            .provenance
            .iter()
            .any(|entry| entry.key == "foreground"));
    }

    #[test]
    fn reset_in_later_include_skips_through_the_current_recursive_index() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        let first = directory.path().join("first.conf");
        let resetter = directory.path().join("resetter.conf");
        let skipped_a = directory.path().join("skipped-a.conf");
        let skipped_b = directory.path().join("skipped-b.conf");
        let loaded_c = directory.path().join("loaded-c.conf");
        fs::write(
            &root,
            b"config-file = first.conf\nconfig-file = resetter.conf\n",
        )
        .unwrap();
        fs::write(&first, b"font-size = 11\n").unwrap();
        fs::write(
            &resetter,
            b"config-file =\nconfig-file = skipped-a.conf\nconfig-file = skipped-b.conf\nconfig-file = loaded-c.conf\n",
        )
        .unwrap();
        fs::write(&skipped_a, b"background = 111111\n").unwrap();
        fs::write(&skipped_b, b"background = 222222\n").unwrap();
        fs::write(&loaded_c, b"background = 333333\n").unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
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
            ["config", "first.conf", "resetter.conf", "loaded-c.conf"]
        );
        assert_eq!(graph.edges[0].status, "loaded");
        assert_eq!(graph.edges[1].status, "loaded");
        assert_eq!(graph.edges[2].status, "queue_reset");
        assert_eq!(graph.edges[3].status, "skipped_by_reset_cursor");
        assert_eq!(graph.edges[4].status, "skipped_by_reset_cursor");
        assert_eq!(graph.edges[5].status, "loaded");
        assert_eq!(
            final_assignment_value(&graph, "background"),
            Some("loaded-c.conf")
        );
    }

    #[test]
    fn optional_missing_include_still_consumes_a_recursive_cursor_slot() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        let resetter = directory.path().join("resetter.conf");
        let skipped_a = directory.path().join("skipped-a.conf");
        let skipped_b = directory.path().join("skipped-b.conf");
        let loaded_c = directory.path().join("loaded-c.conf");
        fs::write(
            &root,
            b"config-file = ?missing.conf\nconfig-file = resetter.conf\n",
        )
        .unwrap();
        fs::write(
            &resetter,
            b"config-file =\nconfig-file = skipped-a.conf\nconfig-file = skipped-b.conf\nconfig-file = loaded-c.conf\n",
        )
        .unwrap();
        fs::write(&skipped_a, b"foreground = 111111\n").unwrap();
        fs::write(&skipped_b, b"foreground = 222222\n").unwrap();
        fs::write(&loaded_c, b"foreground = 333333\n").unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();

        assert!(graph.complete);
        assert_eq!(graph.edges[0].status, "optional_missing");
        assert_eq!(graph.edges[1].status, "loaded");
        assert_eq!(graph.edges[3].status, "skipped_by_reset_cursor");
        assert_eq!(graph.edges[4].status, "skipped_by_reset_cursor");
        assert_eq!(graph.edges[5].status, "loaded");
        assert_eq!(
            final_assignment_value(&graph, "foreground"),
            Some("loaded-c.conf")
        );
    }

    #[test]
    fn quoted_and_optional_empty_include_values_are_ignored() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        let included = directory.path().join("included.conf");
        fs::write(
            &root,
            b"config-file = \"\"\nconfig-file = ?\nconfig-file = ?\"\"\nconfig-file = included.conf\n",
        )
        .unwrap();
        fs::write(&included, b"font-size = 14\n").unwrap();

        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();

        assert_eq!(graph.nodes.len(), 2);
        assert_eq!(graph.edges.len(), 4);
        assert_eq!(graph.edges[0].status, "ignored_empty");
        assert!(!graph.edges[0].optional);
        assert_eq!(graph.edges[1].status, "ignored_empty");
        assert!(graph.edges[1].optional);
        assert_eq!(graph.edges[2].status, "ignored_empty");
        assert!(graph.edges[2].optional);
        assert_eq!(graph.edges[3].status, "loaded");
        assert!(graph.diagnostics.is_empty());
    }

    #[test]
    fn edge_reset_status_contributes_to_graph_revision() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("config");
        fs::write(&root, b"config-file =\n").unwrap();
        let graph = build(vec![root], vec![directory.path().to_path_buf()]).unwrap();
        let mut changed_edges = graph.edges.clone();
        changed_edges[0].status = "ignored_empty".to_string();

        let changed_revision = graph_revision(
            graph.complete,
            &graph.nodes,
            &changed_edges,
            &graph.provenance,
            &graph.diagnostics,
        );
        assert_ne!(graph.graph_revision, changed_revision);
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

    fn final_assignment_value<'a>(graph: &'a ConfigGraph, key: &str) -> Option<&'a str> {
        graph
            .provenance
            .iter()
            .filter(|entry| entry.key == key)
            .max_by_key(|entry| (entry.load_index, entry.line))
            .and_then(|entry| Path::new(&entry.source_path).file_name())
            .and_then(|name| name.to_str())
    }
}
