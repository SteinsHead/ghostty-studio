use std::{
    collections::BTreeMap,
    fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::{
    domain::config_graph::{ConfigGraph, ProvenanceEntry},
    models::{ChangeEffectPreview, ConfigCandidate, DraftChange, SettingEffect},
};

/// Source ordering is intentionally version-gated. Ghostty 1.3.1 loads all
/// default roots first and then drains a global breadth-first config-file
/// queue, including a surprising cursor behavior after a nested reset. Every
/// other version must be re-audited before Studio predicts a winning source.
pub fn supports_source_order(version: Option<&str>) -> bool {
    version.is_some_and(|version| version.trim() == "1.3.1")
}

pub fn graph_is_predictable(graph: &ConfigGraph, version: Option<&str>) -> bool {
    supports_source_order(version)
        && graph.complete
        && graph.nodes.iter().all(|node| !node.symlink)
        && !graph.diagnostics.iter().any(|diagnostic| {
            matches!(
                diagnostic.code.as_str(),
                "cycle_or_duplicate" | "external_include_blocked"
            )
        })
}

pub fn setting_effects(
    graph: &ConfigGraph,
    target: &Path,
    keys: impl IntoIterator<Item = String>,
    candidates: &[ConfigCandidate],
    version: Option<&str>,
) -> BTreeMap<String, SettingEffect> {
    let keys = keys.into_iter().collect::<Vec<_>>();
    if !graph_is_predictable(graph, version) {
        return keys
            .into_iter()
            .map(|key| (key, unverified_effect()))
            .collect();
    }
    let Some(target_path) = normalized_path(target) else {
        return keys
            .into_iter()
            .map(|key| (key, unverified_effect()))
            .collect();
    };
    let Some(target_node) = graph
        .nodes
        .iter()
        .find(|node| Path::new(&node.path) == target_path)
    else {
        return keys
            .into_iter()
            .map(|key| (key, unverified_effect()))
            .collect();
    };

    keys.into_iter()
        .map(|key| {
            let effect = match final_assignment(graph, &key) {
                Some(source) if Path::new(&source.source_path) == target_path => {
                    effect_for_source("effective", source, candidates)
                }
                Some(source) if source.load_index > target_node.load_index => {
                    effect_for_source("overridden", source, candidates)
                }
                Some(source) => effect_for_source("inherited", source, candidates),
                None => SettingEffect {
                    status: "inherited".to_string(),
                    source_candidate_id: None,
                    source_label: None,
                },
            };
            (key, effect)
        })
        .collect()
}

pub fn preview_change_effect(
    graph: &ConfigGraph,
    target: &Path,
    changes: &[DraftChange],
    candidates: &[ConfigCandidate],
    version: Option<&str>,
) -> ChangeEffectPreview {
    if !graph_is_predictable(graph, version) {
        return unverified_preview(changes);
    }
    let Some(target_path) = normalized_path(target) else {
        return unverified_preview(changes);
    };
    let Some(target_node) = graph
        .nodes
        .iter()
        .find(|node| Path::new(&node.path) == target_path)
    else {
        return unverified_preview(changes);
    };

    let mut affected_keys = Vec::new();
    let mut later_sources = Vec::<&ProvenanceEntry>::new();
    for change in changes {
        if let Some(source) = final_assignment(graph, &change.key) {
            if Path::new(&source.source_path) != target_path
                && source.load_index > target_node.load_index
            {
                affected_keys.push(change.key.clone());
                later_sources.push(source);
            }
        }
    }

    if affected_keys.is_empty() {
        return ChangeEffectPreview {
            status: "effective".to_string(),
            affected_keys,
            suggested_candidate_id: None,
            suggested_label: None,
        };
    }

    let suggested = later_sources
        .into_iter()
        .max_by_key(|source| (source.load_index, source.line))
        .and_then(|source| candidate_for_path(candidates, Path::new(&source.source_path)))
        .filter(|candidate| candidate.writable && !candidate.symlink);
    ChangeEffectPreview {
        status: "overridden".to_string(),
        affected_keys,
        suggested_candidate_id: suggested.map(|candidate| candidate.id.clone()),
        suggested_label: suggested.map(|candidate| candidate.label.clone()),
    }
}

/// Fingerprint every observed dependency except the file Studio is about to
/// replace. This catches an optional include appearing, a later source being
/// edited, or a default root changing while native confirmation is open.
pub fn dependency_revision(
    graph: &ConfigGraph,
    default_candidates: &[ConfigCandidate],
    target: &Path,
    version: Option<&str>,
) -> String {
    let target = normalized_path(target);
    let mut digest = Sha256::new();
    digest.update(version.unwrap_or("unknown").as_bytes());
    for candidate in default_candidates
        .iter()
        .filter(|candidate| candidate.source != "include")
    {
        digest.update(candidate.path.as_bytes());
        digest.update([u8::from(candidate.exists)]);
    }
    for node in &graph.nodes {
        digest.update(node.path.as_bytes());
        digest.update(node.load_index.to_le_bytes());
        digest.update(node.depth.to_le_bytes());
        digest.update([u8::from(node.symlink)]);
        let is_target = target
            .as_ref()
            .is_some_and(|target| Path::new(&node.path) == target);
        if !is_target {
            digest.update(node.content_revision.as_bytes());
        }
    }
    for edge in &graph.edges {
        digest.update(edge.from_id.as_bytes());
        if let Some(to_id) = &edge.to_id {
            digest.update(to_id.as_bytes());
        }
        digest.update(edge.declared_path.as_bytes());
        digest.update(edge.line.to_le_bytes());
        digest.update([u8::from(edge.optional)]);
        digest.update(edge.status.as_bytes());
    }
    for diagnostic in &graph.diagnostics {
        digest.update(diagnostic.code.as_bytes());
        if let Some(path) = &diagnostic.path {
            digest.update(path.as_bytes());
        }
        digest.update(diagnostic.line.unwrap_or(0).to_le_bytes());
    }
    hex(&digest.finalize())
}

pub fn final_assignment<'a>(graph: &'a ConfigGraph, key: &str) -> Option<&'a ProvenanceEntry> {
    graph
        .provenance
        .iter()
        .filter(|entry| entry.key == key)
        .max_by_key(|entry| (entry.load_index, entry.line))
}

fn effect_for_source(
    status: &str,
    source: &ProvenanceEntry,
    candidates: &[ConfigCandidate],
) -> SettingEffect {
    let candidate = candidate_for_path(candidates, Path::new(&source.source_path));
    SettingEffect {
        status: status.to_string(),
        source_candidate_id: candidate.map(|candidate| candidate.id.clone()),
        source_label: candidate.map(|candidate| candidate.label.clone()),
    }
}

fn candidate_for_path<'a>(
    candidates: &'a [ConfigCandidate],
    path: &Path,
) -> Option<&'a ConfigCandidate> {
    let path = normalized_path(path)?;
    candidates.iter().find(|candidate| {
        normalized_path(Path::new(&candidate.path)).as_deref() == Some(path.as_path())
    })
}

fn normalized_path(path: &Path) -> Option<PathBuf> {
    fs::canonicalize(path).ok().or_else(|| {
        if path.is_absolute() {
            Some(path.to_path_buf())
        } else {
            None
        }
    })
}

fn unverified_effect() -> SettingEffect {
    SettingEffect {
        status: "unverified".to_string(),
        source_candidate_id: None,
        source_label: None,
    }
}

fn unverified_preview(changes: &[DraftChange]) -> ChangeEffectPreview {
    ChangeEffectPreview {
        status: "unverified".to_string(),
        affected_keys: changes.iter().map(|change| change.key.clone()).collect(),
        suggested_candidate_id: None,
        suggested_label: None,
    }
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    struct LayeredFixture {
        xdg_root: PathBuf,
        macos_root: PathBuf,
        xdg_include: PathBuf,
        candidates: Vec<ConfigCandidate>,
    }

    impl LayeredFixture {
        fn new(directory: &Path) -> Self {
            // macOS exposes temporary directories through both `/var` and
            // `/private/var`. Use the canonical spelling so the fixture does
            // not look like a symlinked config source to the fail-closed
            // resolver.
            let directory = fs::canonicalize(directory).unwrap();
            let xdg_directory = directory.join("xdg/ghostty");
            let macos_directory = directory.join("Library/Application Support/ghostty");
            fs::create_dir_all(&xdg_directory).unwrap();
            fs::create_dir_all(&macos_directory).unwrap();

            let xdg_root = xdg_directory.join("config");
            let macos_root = macos_directory.join("config");
            let xdg_include = xdg_directory.join("background.conf");
            fs::write(
                &xdg_root,
                b"background-image = /images/from-xdg.png\nconfig-file = background.conf\n",
            )
            .unwrap();
            fs::write(&macos_root, b"background-image = /images/from-macos.png\n").unwrap();
            fs::write(
                &xdg_include,
                b"background-image = /images/from-include.png\n",
            )
            .unwrap();

            let candidates = vec![
                candidate("xdg-root", "XDG · config", &xdg_root, "xdg", 0),
                candidate("macos-root", "macOS · config", &macos_root, "macos", 2),
                candidate(
                    "xdg-include",
                    "Include · background.conf",
                    &xdg_include,
                    "include",
                    6,
                ),
            ];

            Self {
                xdg_root,
                macos_root,
                xdg_include,
                candidates,
            }
        }

        fn graph(&self) -> ConfigGraph {
            crate::domain::config_graph::build(
                vec![self.xdg_root.clone(), self.macos_root.clone()],
                vec![
                    self.xdg_root.parent().unwrap().to_path_buf(),
                    self.macos_root.parent().unwrap().to_path_buf(),
                ],
            )
            .unwrap()
        }
    }

    fn candidate(
        id: &str,
        label: &str,
        path: &Path,
        source: &str,
        priority: u8,
    ) -> ConfigCandidate {
        ConfigCandidate {
            id: id.to_string(),
            label: label.to_string(),
            path: path.to_string_lossy().to_string(),
            source: source.to_string(),
            format: "legacy".to_string(),
            priority,
            exists: true,
            writable: true,
            symlink: false,
            size_bytes: fs::metadata(path).ok().map(|metadata| metadata.len()),
        }
    }

    fn background_change() -> DraftChange {
        DraftChange {
            key: "background-image".to_string(),
            before: vec!["/images/from-macos.png".to_string()],
            after: vec!["/images/new.png".to_string()],
        }
    }

    #[test]
    fn source_order_is_fail_closed_for_future_versions() {
        assert!(supports_source_order(Some("1.3.1")));
        assert!(!supports_source_order(Some("1.3.0")));
        assert!(!supports_source_order(Some("1.3.2")));
        assert!(!supports_source_order(Some("1.3.99")));
        assert!(!supports_source_order(Some("1.3.1-dev")));
        assert!(!supports_source_order(Some("1.3")));
        assert!(!supports_source_order(Some("1.4.0")));
        assert!(!supports_source_order(None));
    }

    #[test]
    fn xdg_include_loaded_after_both_roots_wins_and_is_the_suggested_target() {
        let directory = tempfile::tempdir().unwrap();
        let fixture = LayeredFixture::new(directory.path());
        let graph = fixture.graph();

        assert!(graph_is_predictable(&graph, Some("1.3.1")));
        assert_eq!(
            graph
                .nodes
                .iter()
                .map(|node| PathBuf::from(&node.path))
                .collect::<Vec<_>>(),
            vec![
                fs::canonicalize(&fixture.xdg_root).unwrap(),
                fs::canonicalize(&fixture.macos_root).unwrap(),
                fs::canonicalize(&fixture.xdg_include).unwrap(),
            ]
        );

        let winning_assignment = final_assignment(&graph, "background-image").unwrap();
        assert_eq!(
            Path::new(&winning_assignment.source_path),
            fs::canonicalize(&fixture.xdg_include).unwrap()
        );

        let effects = setting_effects(
            &graph,
            &fixture.macos_root,
            ["background-image".to_string()],
            &fixture.candidates,
            Some("1.3.1"),
        );
        assert_eq!(effects["background-image"].status, "overridden");
        assert_eq!(
            effects["background-image"].source_candidate_id.as_deref(),
            Some("xdg-include")
        );
        assert_eq!(
            effects["background-image"].source_label.as_deref(),
            Some("Include · background.conf")
        );

        let preview = preview_change_effect(
            &graph,
            &fixture.macos_root,
            &[background_change()],
            &fixture.candidates,
            Some("1.3.1"),
        );
        assert_eq!(preview.status, "overridden");
        assert_eq!(preview.affected_keys, ["background-image"]);
        assert_eq!(
            preview.suggested_candidate_id.as_deref(),
            Some("xdg-include")
        );
        assert_eq!(
            preview.suggested_label.as_deref(),
            Some("Include · background.conf")
        );
    }

    #[test]
    fn saving_to_the_winning_include_is_effective() {
        let directory = tempfile::tempdir().unwrap();
        let fixture = LayeredFixture::new(directory.path());
        let graph = fixture.graph();

        let effects = setting_effects(
            &graph,
            &fixture.xdg_include,
            ["background-image".to_string()],
            &fixture.candidates,
            Some("1.3.1"),
        );
        assert_eq!(effects["background-image"].status, "effective");
        assert_eq!(
            effects["background-image"].source_candidate_id.as_deref(),
            Some("xdg-include")
        );

        let preview = preview_change_effect(
            &graph,
            &fixture.xdg_include,
            &[background_change()],
            &fixture.candidates,
            Some("1.3.1"),
        );
        assert_eq!(preview.status, "effective");
        assert!(preview.affected_keys.is_empty());
        assert!(preview.suggested_candidate_id.is_none());
    }

    #[test]
    fn current_source_is_inherited_when_only_an_earlier_layer_assigns_the_key() {
        let directory = tempfile::tempdir().unwrap();
        let directory = fs::canonicalize(directory.path()).unwrap();
        let xdg = directory.join("xdg-config");
        let macos = directory.join("macos-config");
        fs::write(&xdg, b"background-image = /images/earlier.png\n").unwrap();
        fs::write(&macos, b"font-size = 14\n").unwrap();
        let candidates = vec![
            candidate("xdg", "XDG · config", &xdg, "xdg", 0),
            candidate("macos", "macOS · config", &macos, "macos", 2),
        ];
        let graph = crate::domain::config_graph::build(
            vec![xdg.clone(), macos.clone()],
            vec![directory.clone()],
        )
        .unwrap();

        let effects = setting_effects(
            &graph,
            &macos,
            ["background-image".to_string()],
            &candidates,
            Some("1.3.1"),
        );
        assert_eq!(effects["background-image"].status, "inherited");
        assert_eq!(
            effects["background-image"].source_candidate_id.as_deref(),
            Some("xdg")
        );

        let preview = preview_change_effect(
            &graph,
            &macos,
            &[background_change()],
            &candidates,
            Some("1.3.1"),
        );
        assert_eq!(preview.status, "effective");
    }

    #[test]
    fn unknown_ghostty_versions_never_predict_or_recommend_a_source() {
        let directory = tempfile::tempdir().unwrap();
        let fixture = LayeredFixture::new(directory.path());
        let graph = fixture.graph();

        for version in [None, Some("1.4.0"), Some("2.0.0-dev")] {
            assert!(!graph_is_predictable(&graph, version));

            let effects = setting_effects(
                &graph,
                &fixture.macos_root,
                ["background-image".to_string()],
                &fixture.candidates,
                version,
            );
            assert_eq!(effects["background-image"].status, "unverified");
            assert!(effects["background-image"].source_candidate_id.is_none());

            let preview = preview_change_effect(
                &graph,
                &fixture.macos_root,
                &[background_change()],
                &fixture.candidates,
                version,
            );
            assert_eq!(preview.status, "unverified");
            assert_eq!(preview.affected_keys, ["background-image"]);
            assert!(preview.suggested_candidate_id.is_none());
        }
    }

    #[test]
    fn dependency_revision_ignores_target_content_but_tracks_other_sources() {
        let directory = tempfile::tempdir().unwrap();
        let fixture = LayeredFixture::new(directory.path());
        let initial = dependency_revision(
            &fixture.graph(),
            &fixture.candidates,
            &fixture.macos_root,
            Some("1.3.1"),
        );

        fs::write(
            &fixture.macos_root,
            b"background-image = /images/edited-target.png\n",
        )
        .unwrap();
        let after_target_edit = dependency_revision(
            &fixture.graph(),
            &fixture.candidates,
            &fixture.macos_root,
            Some("1.3.1"),
        );
        assert_eq!(initial, after_target_edit);

        fs::write(
            &fixture.xdg_include,
            b"background-image = /images/edited-dependency.png\n",
        )
        .unwrap();
        let after_dependency_edit = dependency_revision(
            &fixture.graph(),
            &fixture.candidates,
            &fixture.macos_root,
            Some("1.3.1"),
        );
        assert_ne!(initial, after_dependency_edit);
    }
}
