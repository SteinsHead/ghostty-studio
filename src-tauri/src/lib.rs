mod domain;
mod error;
mod models;

use std::{
    collections::{BTreeMap, HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex, MutexGuard,
    },
};

use domain::{
    background_assets,
    config_document::ConfigDocument,
    config_graph, discovery, effective_config, ghostty, runtime_contract,
    safe_write::{self, revision},
    schema,
};
use error::CommandError;
use models::{
    ApplyResult, BackgroundAssetImportFailure, BackgroundAssetImportResult, BackgroundAssetPreview,
    BackgroundAssetReference, BackgroundAssetSummary, BackgroundAssetUsage, ChangeEffectPreview,
    ChangePreview, ConfigCandidate, ConfigSession, ConfiguredSetting, DraftChange,
    EnvironmentReport, PublicConfigCandidate, PublicGhosttyInfo, RuntimeOption, RuntimeSchema,
};
use tauri::{Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use uuid::Uuid;

#[derive(Clone)]
struct OpenSession {
    candidate_id: String,
    path: PathBuf,
    revision: String,
    read_only: bool,
    original_bytes: Vec<u8>,
    document: ConfigDocument,
}

#[derive(Clone)]
struct StagedCandidate {
    session_id: String,
    revision: String,
    bytes: Vec<u8>,
    changes: Vec<DraftChange>,
    diagnostics: Vec<String>,
    valid: bool,
    activation: String,
    background_asset_id: Option<String>,
    effect: ChangeEffectPreview,
    dependency_revision: String,
    review_contract: BTreeMap<String, RuntimeOption>,
    runtime_identity: ghostty::ExecutableIdentity,
}

struct PreparedSnapshotRestore {
    current_bytes: Vec<u8>,
    restored_bytes: Vec<u8>,
    validation: ghostty::ValidationReport,
    snapshot: safe_write::SnapshotInfo,
    changed_keys: Vec<String>,
    runtime_identity: ghostty::ExecutableIdentity,
}

struct CurrentRuntimeContract {
    executable: ghostty::ExecutableIdentity,
    ghostty_version: Option<String>,
    editable_keys: HashSet<String>,
    editable_options: HashMap<String, RuntimeOption>,
    writable_options: BTreeMap<String, RuntimeOption>,
    changed_writable_keys: HashSet<String>,
}

#[derive(Default)]
struct AppState {
    candidates: Mutex<HashMap<String, ConfigCandidate>>,
    sessions: Mutex<HashMap<String, OpenSession>>,
    stages: Mutex<HashMap<String, StagedCandidate>>,
    runtime_schema: Mutex<Option<RuntimeSchema>>,
    mutation_in_flight: AtomicBool,
    asset_store: Mutex<()>,
}

const BACKGROUND_IMAGE_KEY: &str = "background-image";
const MANAGED_BACKGROUND_PREFIX: &str = "managed-image:";
const EXTERNAL_BACKGROUND_TOKEN: &str = "external-image";
const RESET_BACKGROUND_TOKEN: &str = "reset-background-image";
const MAX_BACKGROUND_IMPORT_BATCH: usize = 20;

#[derive(Debug)]
struct MutationGuard<'a>(&'a AtomicBool);

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
fn probe_environment(state: State<'_, AppState>) -> Result<EnvironmentReport, CommandError> {
    let default_candidates = discovery::discover_config_candidates();
    let existing_count = default_candidates
        .iter()
        .filter(|candidate| candidate.exists)
        .count();
    let mut warnings = Vec::new();
    if existing_count > 1 {
        warnings.push(format!(
            "检测到 {existing_count} 个 Ghostty 默认配置层；最终值可能来自不同文件。"
        ));
    }
    if default_candidates.iter().any(|candidate| candidate.symlink) {
        warnings.push("检测到符号链接；写入前需要单独确认真实目标。".to_string());
    }
    let candidates = match build_config_graph_for(&default_candidates) {
        Ok(graph) => {
            if graph
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "external_include_blocked")
            {
                warnings.push(
                    "有 include 位于 Ghostty 默认配置目录之外；尚未授权前，生效来源保持只读。"
                        .to_string(),
                );
            } else if !graph.complete {
                warnings
                    .push("配置来源未能完整读取；确认完整关系前，相关设置保持只读。".to_string());
            } else if graph
                .diagnostics
                .iter()
                .any(|diagnostic| diagnostic.code == "cycle_or_duplicate")
            {
                warnings.push(
                    "配置中存在重复或循环 include；确认 Ghostty 的处理结果前，相关设置保持只读。"
                        .to_string(),
                );
            }
            workspace_candidates(&default_candidates, &graph)
        }
        Err(_) => {
            warnings.push("部分 include 来源无法安全读取；生效来源会保持未确认状态。".to_string());
            default_candidates.clone()
        }
    };
    let mut candidate_store = state
        .candidates
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "candidate state is unavailable"))?;
    candidate_store.clear();
    candidate_store.extend(
        candidates
            .iter()
            .cloned()
            .map(|candidate| (candidate.id.clone(), candidate)),
    );
    drop(candidate_store);
    let runtime = ghostty::resolve().ok();
    let runtime_creation_eligible = runtime
        .as_ref()
        .is_some_and(runtime_allows_automatic_creation);
    let has_existing_config = candidates.iter().any(|candidate| candidate.exists);
    let visible_candidates = candidates
        .iter()
        .map(|candidate| {
            let target = Path::new(&candidate.path);
            let safe_target = creation_root_for(candidate, target)
                .and_then(|root| safe_write::preflight_new_config(target, &root))
                .is_ok();
            let creation_eligible = runtime_creation_eligible
                && !has_existing_config
                && !candidate.exists
                && candidate.writable
                && !candidate.symlink
                && safe_target;
            public_candidate(candidate, creation_eligible)
        })
        .collect();

    Ok(EnvironmentReport {
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        ghostty: PublicGhosttyInfo {
            available: runtime.is_some(),
            version: runtime.as_ref().and_then(|runtime| runtime.version.clone()),
            channel: runtime.as_ref().and_then(|runtime| runtime.channel.clone()),
        },
        candidates: visible_candidates,
        warnings,
    })
}

fn runtime_allows_automatic_creation(runtime: &ghostty::ResolvedRuntime) -> bool {
    if runtime.version.as_deref().map(str::trim) != Some(runtime_contract::AUDITED_GHOSTTY_VERSION)
        || runtime.channel.as_deref().map(str::trim)
            != Some(runtime_contract::AUDITED_GHOSTTY_CHANNEL)
        || std::env::consts::OS != runtime_contract::AUDITED_PLATFORM
    {
        return false;
    }
    schema::load(
        &runtime.identity,
        runtime.version.clone(),
        runtime.channel.clone(),
    )
    .is_ok_and(|schema| !runtime_contract::writable_options(&schema).is_empty())
}

fn public_candidate(candidate: &ConfigCandidate, creation_eligible: bool) -> PublicConfigCandidate {
    let label = match (candidate.source.as_str(), candidate.format.as_str()) {
        ("xdg", "ghostty") => "XDG · config.ghostty".to_string(),
        ("xdg", _) => "XDG · config".to_string(),
        ("macos", "ghostty") => "macOS · config.ghostty".to_string(),
        ("macos", _) => "macOS · config".to_string(),
        ("include", _) => format!(
            "Include · layer {}",
            candidate.priority.saturating_sub(3).max(1)
        ),
        _ => "Custom configuration".to_string(),
    };
    PublicConfigCandidate {
        id: candidate.id.clone(),
        label,
        source: candidate.source.clone(),
        format: candidate.format.clone(),
        priority: candidate.priority,
        exists: candidate.exists,
        writable: candidate.writable,
        symlink: candidate.symlink,
        size_bytes: candidate.size_bytes,
        creation_eligible,
    }
}

#[tauri::command]
fn load_runtime_schema(state: State<'_, AppState>) -> Result<RuntimeSchema, CommandError> {
    let _mutation_guard = acquire_mutation(&state)?;
    let runtime_schema = match ghostty::resolve() {
        Ok(runtime) => schema::load(&runtime.identity, runtime.version, runtime.channel)?,
        Err(error) if error.code == "ghostty_unavailable" => RuntimeSchema {
            ghostty_version: None,
            schema_hash: "offline".to_string(),
            options: Vec::new(),
            diagnostics: vec!["没有找到 Ghostty，设置暂时只读。".to_string()],
        },
        Err(error) => return Err(error),
    };
    install_runtime_schema(&state, runtime_schema.clone())?;
    Ok(runtime_schema)
}

#[tauri::command]
fn load_config_graph() -> Result<config_graph::ConfigGraph, CommandError> {
    let candidates = discovery::discover_config_candidates();
    let graph = build_config_graph_for(&candidates)?;
    Ok(public_config_graph(graph))
}

fn public_config_graph(mut graph: config_graph::ConfigGraph) -> config_graph::ConfigGraph {
    let id_map = graph
        .nodes
        .iter()
        .map(|node| {
            (
                node.id.clone(),
                (
                    format!("layer-{}", node.load_index + 1),
                    format!("配置层 {}", node.load_index + 1),
                ),
            )
        })
        .collect::<HashMap<_, _>>();
    let path_labels = graph
        .nodes
        .iter()
        .filter_map(|node| {
            id_map
                .get(&node.id)
                .map(|(_, label)| (node.path.clone(), label.clone()))
        })
        .collect::<HashMap<_, _>>();
    for node in &mut graph.nodes {
        if let Some((opaque_id, label)) = id_map.get(&node.id) {
            node.id = opaque_id.clone();
            node.path = label.clone();
        }
    }
    for edge in &mut graph.edges {
        edge.declared_path = edge
            .to_id
            .as_ref()
            .and_then(|id| id_map.get(id).map(|(_, label)| label.clone()))
            .unwrap_or_else(|| "未公开的 include 路径".to_string());
        if let Some((opaque_id, _)) = id_map.get(&edge.from_id) {
            edge.from_id = opaque_id.clone();
        }
        if let Some(to_id) = &mut edge.to_id {
            if let Some((opaque_id, _)) = id_map.get(to_id) {
                *to_id = opaque_id.clone();
            }
        }
    }
    for source in &mut graph.provenance {
        if let Some((opaque_id, label)) = id_map.get(&source.source_id) {
            source.source_id = opaque_id.clone();
            source.source_path = label.clone();
        }
    }
    for diagnostic in &mut graph.diagnostics {
        diagnostic.message = diagnostic.code.clone();
        if let Some(path) = &mut diagnostic.path {
            *path = path_labels
                .get(path)
                .cloned()
                .unwrap_or_else(|| "未公开路径".to_string());
        }
    }
    graph
}

fn build_config_graph_for(
    candidates: &[ConfigCandidate],
) -> Result<config_graph::ConfigGraph, CommandError> {
    let roots = candidates
        .iter()
        .filter(|candidate| candidate.source != "include" && candidate.exists)
        .map(|candidate| PathBuf::from(&candidate.path))
        .collect::<Vec<_>>();
    let allowed_roots = candidates
        .iter()
        .filter(|candidate| candidate.source != "include")
        .filter_map(|candidate| PathBuf::from(&candidate.path).parent().map(PathBuf::from))
        .collect::<Vec<_>>();
    config_graph::build(roots, allowed_roots)
}

fn workspace_candidates(
    default_candidates: &[ConfigCandidate],
    graph: &config_graph::ConfigGraph,
) -> Vec<ConfigCandidate> {
    let root_paths = default_candidates
        .iter()
        .filter(|candidate| candidate.exists)
        .filter_map(|candidate| std::fs::canonicalize(&candidate.path).ok())
        .collect::<HashSet<_>>();
    let mut result = default_candidates.to_vec();
    let mut ids = result
        .iter()
        .map(|candidate| candidate.id.clone())
        .collect::<HashSet<_>>();
    for node in &graph.nodes {
        let path = PathBuf::from(&node.path);
        if root_paths.contains(&path) {
            continue;
        }
        let candidate = discovery::include_candidate(path, node.load_index, node.symlink);
        if candidate.exists && ids.insert(candidate.id.clone()) {
            result.push(candidate);
        }
    }
    result.sort_by_key(|candidate| candidate.priority);
    result
}

#[tauri::command]
fn list_background_assets(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<Vec<BackgroundAssetSummary>, CommandError> {
    let _asset_guard = lock_asset_store(&state)?;
    let data_root = app_data_root(&app)?;
    Ok(annotate_background_asset_usage(
        &data_root,
        background_assets::list(&data_root)?,
    ))
}

#[tauri::command]
fn get_background_asset_preview(
    app: tauri::AppHandle,
    asset_id: String,
    state: State<'_, AppState>,
) -> Result<BackgroundAssetPreview, CommandError> {
    let _asset_guard = lock_asset_store(&state)?;
    background_assets::preview(&app_data_root(&app)?, &asset_id)
}

fn document_references_background_path(
    document: &ConfigDocument,
    source_config: Option<&Path>,
    path: &Path,
) -> bool {
    document
        .values()
        .get(BACKGROUND_IMAGE_KEY)
        .is_some_and(|values| {
            values.iter().any(|value| {
                background_assets::configured_image_path(source_config, value)
                    .is_some_and(|value| equivalent_existing_paths(path, &value))
            })
        })
}

fn loaded_background_references(
) -> Result<HashMap<PathBuf, Vec<BackgroundAssetReference>>, CommandError> {
    let discovered = discovery::discover_config_candidates();
    loaded_background_references_for(&discovered)
}

fn loaded_background_references_for(
    discovered: &[ConfigCandidate],
) -> Result<HashMap<PathBuf, Vec<BackgroundAssetReference>>, CommandError> {
    let graph = build_config_graph_for(discovered).map_err(|_| {
        CommandError::new(
            "background_asset_usage_unknown",
            "the current Ghostty configuration graph could not be checked",
        )
    })?;
    if !graph.complete {
        return Err(CommandError::new(
            "background_asset_usage_unknown",
            "the current Ghostty configuration graph is incomplete",
        ));
    }
    let candidates = workspace_candidates(discovered, &graph);
    let candidate_paths = candidates
        .iter()
        .filter_map(|candidate| {
            std::fs::canonicalize(&candidate.path)
                .ok()
                .map(|path| (path, candidate))
        })
        .collect::<HashMap<_, _>>();
    let mut references = HashMap::<PathBuf, Vec<BackgroundAssetReference>>::new();

    for node in &graph.nodes {
        let node_path = PathBuf::from(&node.path);
        let bytes = safe_write::read_regular_target_file(&node_path).map_err(|_| {
            CommandError::new(
                "background_asset_usage_unknown",
                "a loaded Ghostty configuration could not be checked",
            )
        })?;
        if safe_write::revision(&bytes) != node.content_revision {
            return Err(CommandError::new(
                "background_asset_usage_unknown",
                "a Ghostty configuration changed while image usage was being checked",
            ));
        }
        let document = ConfigDocument::parse(&bytes).map_err(|_| {
            CommandError::new(
                "background_asset_usage_unknown",
                "a loaded Ghostty configuration could not be parsed",
            )
        })?;
        let candidate = candidate_paths.get(&node_path);
        let reference = BackgroundAssetReference {
            candidate_id: candidate.map(|candidate| candidate.id.clone()),
            source_label: candidate.map(|candidate| candidate.label.clone()),
            writable: candidate.is_some_and(|candidate| candidate.writable && !candidate.symlink),
        };
        let Some(values) = document.values().remove(BACKGROUND_IMAGE_KEY) else {
            continue;
        };
        for value in values {
            let Some(path) = background_assets::configured_image_path(Some(&node_path), &value)
            else {
                continue;
            };
            let Ok(identity) = std::fs::canonicalize(path) else {
                continue;
            };
            let entries = references.entry(identity).or_default();
            if !entries.iter().any(|existing| {
                existing.candidate_id == reference.candidate_id
                    && existing.source_label == reference.source_label
            }) {
                entries.push(reference.clone());
            }
        }
    }
    Ok(references)
}

fn annotate_background_asset_usage(
    data_root: &Path,
    mut assets: Vec<BackgroundAssetSummary>,
) -> Vec<BackgroundAssetSummary> {
    let Ok(references) = loaded_background_references() else {
        for asset in &mut assets {
            asset.usage = BackgroundAssetUsage {
                status: "unknown".to_string(),
                references: Vec::new(),
            };
        }
        return assets;
    };

    for asset in &mut assets {
        let identity = background_assets::resolve_asset_path(data_root, &asset.id)
            .ok()
            .and_then(|path| std::fs::canonicalize(path).ok());
        match identity {
            Some(identity) if references.contains_key(&identity) => {
                asset.usage = BackgroundAssetUsage {
                    status: "referenced".to_string(),
                    references: references.get(&identity).cloned().unwrap_or_default(),
                };
            }
            Some(_) => {
                asset.usage = BackgroundAssetUsage {
                    status: "available".to_string(),
                    references: Vec::new(),
                };
            }
            None => {
                asset.usage = BackgroundAssetUsage {
                    status: "unknown".to_string(),
                    references: Vec::new(),
                };
            }
        }
    }
    assets
}

fn background_asset_usage(
    data_root: &Path,
    path: &Path,
    state: &AppState,
) -> Result<(bool, usize), CommandError> {
    let sessions = state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .values()
        .cloned()
        .collect::<Vec<_>>();
    let session_targets = sessions
        .iter()
        .map(|session| session.path.clone())
        .collect::<HashSet<_>>();
    let identity = std::fs::canonicalize(path).map_err(|_| {
        CommandError::new(
            "background_asset_usage_unknown",
            "the managed image identity could not be checked",
        )
    })?;
    if loaded_background_references()?.contains_key(&identity) {
        return Ok((true, 0));
    }

    let mut snapshot_references = 0_usize;
    for target in session_targets {
        for snapshot in safe_write::list_snapshots(data_root, &target)? {
            let bytes = safe_write::read_snapshot(data_root, &target, &snapshot.id)?;
            if document_references_background_path(
                &ConfigDocument::parse(&bytes)?,
                Some(&target),
                path,
            ) {
                snapshot_references = snapshot_references.saturating_add(1);
            }
        }
    }
    Ok((false, snapshot_references))
}

fn invalidate_background_stages(path: &Path, state: &AppState) -> Result<(), CommandError> {
    let session_paths = state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .iter()
        .map(|(id, session)| (id.clone(), session.path.clone()))
        .collect::<HashMap<_, _>>();
    let staged = state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
        .iter()
        .map(|(token, stage)| {
            (
                token.clone(),
                stage.bytes.clone(),
                session_paths.get(&stage.session_id).cloned(),
            )
        })
        .collect::<Vec<_>>();
    let mut invalidated = Vec::new();
    for (token, bytes, source_config) in staged {
        if document_references_background_path(
            &ConfigDocument::parse(&bytes)?,
            source_config.as_deref(),
            path,
        ) {
            invalidated.push(token);
        }
    }
    if invalidated.is_empty() {
        return Ok(());
    }
    let mut stages = state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?;
    for token in invalidated {
        stages.remove(&token);
    }
    Ok(())
}

#[tauri::command]
async fn delete_background_asset(
    app: tauri::AppHandle,
    asset_id: String,
    locale: String,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    let locale = UiLocale::parse(&locale)?;
    let _mutation_guard = acquire_mutation(&state)?;
    let data_root = app_data_root(&app)?;
    let (asset_path, snapshot_references, display_name) = {
        let _asset_guard = lock_asset_store(&state)?;
        let asset_path = background_assets::resolve_asset_path(&data_root, &asset_id)?;
        let (in_use, snapshot_references) =
            background_asset_usage(&data_root, &asset_path, &state)?;
        if in_use {
            return Err(CommandError::new(
                "background_asset_in_use",
                "the image is still used by a Ghostty configuration",
            ));
        }
        let display_name = background_assets::list(&data_root)?
            .into_iter()
            .find(|asset| asset.id == asset_id)
            .map(|asset| asset.display_name)
            .unwrap_or_else(|| "Background image".to_string());
        (asset_path, snapshot_references, display_name)
    };
    let (message, confirm_label, cancel_label) = match locale {
        UiLocale::ZhCn => (
            format!(
                "从图片库删除“{display_name}”？\n\n原始文件不受影响。{}",
                if snapshot_references > 0 {
                    format!(
                        "\n\n{snapshot_references} 个恢复点仍引用此图片，删除后无法恢复图片。"
                    )
                } else {
                    String::new()
                }
            ),
            "删除图片".to_string(),
            "取消".to_string(),
        ),
        UiLocale::En => (
            format!(
                "Delete “{display_name}” from the image library?\n\nYour original file is unaffected.{}",
                if snapshot_references > 0 {
                    format!(
                        "\n\n{snapshot_references} restore {} still reference this image and will no longer restore it.",
                        if snapshot_references == 1 { "point" } else { "points" }
                    )
                } else {
                    String::new()
                }
            ),
            "Delete image".to_string(),
            "Cancel".to_string(),
        ),
    };
    require_native_confirmation(&app, message, confirm_label, cancel_label).await?;
    let _asset_guard = lock_asset_store(&state)?;
    let confirmed_path = background_assets::resolve_asset_path(&data_root, &asset_id)?;
    if confirmed_path != asset_path
        || background_asset_usage(&data_root, &confirmed_path, &state)?.0
    {
        return Err(CommandError::new(
            "background_asset_in_use",
            "the image became active while deletion was being confirmed",
        ));
    }
    // A canceled or rejected deletion must not disturb a reviewed change.
    // Invalidate dependent stages only after the final reference check passes.
    invalidate_background_stages(&confirmed_path, &state)?;
    background_assets::remove(&data_root, &asset_id)
}

#[tauri::command]
async fn choose_background_images(
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<BackgroundAssetImportResult, CommandError> {
    let picker_app = app.clone();
    let selected = tauri::async_runtime::spawn_blocking(move || {
        picker_app
            .dialog()
            .file()
            .add_filter("PNG and JPEG images", &["png", "jpg", "jpeg", "jfif"])
            .blocking_pick_files()
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "background_picker_failed",
            format!("the system image picker did not finish: {error}"),
        )
    })?;
    let Some(selected) = selected else {
        return Ok(BackgroundAssetImportResult {
            canceled: true,
            assets: Vec::new(),
            rejected: Vec::new(),
        });
    };
    if selected.len() > MAX_BACKGROUND_IMPORT_BATCH {
        return Err(CommandError::new(
            "background_import_batch_too_large",
            "select no more than 20 images at once",
        ));
    }
    let _asset_guard = lock_asset_store(&state)?;
    let data_root = app_data_root(&app)?;
    let mut assets = Vec::new();
    let mut rejected = Vec::new();
    for selected_path in selected {
        let path = match selected_path.into_path() {
            Ok(path) => path,
            Err(_) => {
                rejected.push(BackgroundAssetImportFailure {
                    display_name: "Selected image".to_string(),
                    code: "background_image_unreadable".to_string(),
                });
                continue;
            }
        };
        let display_name = background_assets::display_name_for_path(&path);
        match background_assets::import(&data_root, &path) {
            Ok(asset) => assets.push(asset),
            Err(error) => rejected.push(BackgroundAssetImportFailure {
                display_name,
                code: error.code.to_string(),
            }),
        }
    }
    let mut seen = HashSet::new();
    assets.retain(|asset| seen.insert(asset.id.clone()));
    let assets = annotate_background_asset_usage(&data_root, assets);
    Ok(BackgroundAssetImportResult {
        canceled: false,
        assets,
        rejected,
    })
}

#[tauri::command]
fn open_config(
    app: tauri::AppHandle,
    candidate_id: String,
    state: State<'_, AppState>,
) -> Result<ConfigSession, CommandError> {
    let _mutation_guard = acquire_mutation(&state)?;
    let data_root = app_data_root(&app)?;
    open_config_session(&candidate_id, &data_root, &state)
}

fn open_config_session(
    candidate_id: &str,
    data_root: &Path,
    state: &AppState,
) -> Result<ConfigSession, CommandError> {
    if candidate_id.len() > 128 {
        return Err(CommandError::new(
            "invalid_candidate",
            "candidate id is too long",
        ));
    }
    let candidate = state
        .candidates
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "candidate state is unavailable"))?
        .get(candidate_id)
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "unknown_candidate",
                "configuration candidate was not issued by this application session",
            )
        })?;
    if !candidate.exists {
        return Err(CommandError::new(
            "missing_config",
            "configuration file does not exist; creation requires a separate reviewed flow",
        ));
    }
    let path = PathBuf::from(&candidate.path);
    let bytes = if candidate.symlink {
        safe_write::read_regular_readonly_file(&path)?
    } else {
        safe_write::read_regular_target_file(&path)?
    };
    let document = ConfigDocument::parse(&bytes)?;
    let revision = revision(&bytes);
    let session_id = Uuid::new_v4().to_string();
    let read_only = !candidate.writable || candidate.symlink;
    let (safe_options, known_keys, schema_version) = {
        let schema = state
            .runtime_schema
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))?;
        let schema = schema.as_ref().ok_or_else(|| {
            CommandError::new(
                "schema_not_loaded",
                "the runtime schema must be loaded before configuration values can be exposed or edited",
            )
        })?;
        let known_keys = schema
            .options
            .iter()
            .filter(|option| is_public_setting_key(&option.key))
            .map(|option| option.key.clone())
            .collect::<HashSet<_>>();
        (
            editable_options_from_schema(schema),
            known_keys,
            schema.ghostty_version.clone(),
        )
    };
    let safe_keys = safe_options.keys().cloned().collect::<HashSet<_>>();
    let all_values = document.values();
    let background_image = background_assets::state_for_value(
        data_root,
        Some(&path),
        all_values
            .get(BACKGROUND_IMAGE_KEY)
            .and_then(|values| values.last())
            .map(String::as_str),
    );
    let configured_settings = all_values
        .iter()
        .filter(|(key, _)| known_keys.contains(*key))
        .map(|(key, configured_values)| {
            let value_exposure = safe_options
                .get(key)
                .and_then(|option| public_scalar_values(option, configured_values))
                .is_some();
            ConfiguredSetting {
                key: key.clone(),
                occurrence_count: configured_values.len(),
                value_exposure: if value_exposure {
                    "available"
                } else {
                    "protected"
                }
                .to_string(),
            }
        })
        .collect();
    let unrecognized_setting_count = all_values
        .keys()
        .filter(|key| !known_keys.contains(*key))
        .count();
    let hidden_value_count = all_values
        .iter()
        .filter(|(key, values)| {
            known_keys.contains(*key)
                && safe_options
                    .get(*key)
                    .and_then(|option| public_scalar_values(option, values))
                    .is_none()
        })
        .count();
    let values = all_values
        .clone()
        .into_iter()
        .filter_map(|(key, values)| {
            let values = safe_options
                .get(&key)
                .and_then(|option| public_scalar_values(option, &values))?;
            Some((key, values))
        })
        .collect();
    let mut configured_effect_keys = safe_keys.iter().cloned().collect::<Vec<_>>();
    configured_effect_keys.push(BACKGROUND_IMAGE_KEY.to_string());
    let default_candidates = discovery::discover_config_candidates();
    let mut effect_analysis = build_config_graph_for(&default_candidates)
        .ok()
        .map(|graph| {
            let candidates = workspace_candidates(&default_candidates, &graph);
            effective_config::setting_effects(
                &graph,
                &path,
                configured_effect_keys.clone(),
                &candidates,
                schema_version.as_deref(),
            )
        })
        .unwrap_or_else(|| {
            configured_effect_keys
                .iter()
                .cloned()
                .map(|key| {
                    (
                        key,
                        models::SettingEffect {
                            status: "unverified".to_string(),
                            source_candidate_id: None,
                            source_label: None,
                        },
                    )
                })
                .collect()
        });
    let (effective_values_known, effective_values, effective_background_image) =
        read_effective_values(data_root, &safe_options);
    if !effective_values_known {
        for effect in effect_analysis.values_mut() {
            effect.status = "unverified".to_string();
            effect.source_candidate_id = None;
            effect.source_label = None;
        }
    }
    let mut diagnostics = Vec::new();
    if candidate.symlink {
        diagnostics.push("这份配置通过符号链接载入，因此当前只能查看。".to_string());
    }
    if hidden_value_count > 0 {
        diagnostics.push(format!("{hidden_value_count} 个设置的值已隐藏。"));
    }
    if unrecognized_setting_count > 0 {
        diagnostics.push(format!(
            "另有 {unrecognized_setting_count} 个 Ghostty 当前未识别的配置项；名称和值均未载入界面。"
        ));
    }
    let opened = OpenSession {
        candidate_id: candidate_id.to_string(),
        path: path.clone(),
        revision: revision.clone(),
        read_only,
        original_bytes: bytes,
        document,
    };
    let mut sessions = state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?;
    let expired_sessions = sessions
        .iter()
        .filter(|(_, session)| session.candidate_id == candidate_id)
        .map(|(id, _)| id.clone())
        .collect::<HashSet<_>>();
    sessions.retain(|id, _| !expired_sessions.contains(id));
    sessions.insert(session_id.clone(), opened);
    drop(sessions);
    if !expired_sessions.is_empty() {
        state
            .stages
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
            .retain(|_, stage| !expired_sessions.contains(&stage.session_id));
    }

    Ok(ConfigSession {
        id: session_id,
        candidate_id: candidate_id.to_string(),
        revision,
        read_only,
        values,
        configured_settings,
        unrecognized_setting_count,
        diagnostics,
        background_image,
        effective_values_known,
        effective_values,
        effective_background_image,
        setting_effects: effect_analysis,
    })
}

fn read_effective_values(
    data_root: &Path,
    safe_options: &HashMap<String, RuntimeOption>,
) -> (
    bool,
    std::collections::BTreeMap<String, Vec<String>>,
    models::BackgroundImageState,
) {
    let unavailable = || {
        (
            false,
            std::collections::BTreeMap::new(),
            models::BackgroundImageState {
                kind: "none".to_string(),
                asset_id: None,
            },
        )
    };
    let Ok(runtime) = ghostty::resolve() else {
        return unavailable();
    };
    let Ok(validation) = ghostty::validate_default_config(&runtime.identity) else {
        return unavailable();
    };
    if !validation.valid {
        return unavailable();
    }
    let Ok(output) = ghostty::show_effective_config(&runtime.identity) else {
        return unavailable();
    };
    let Ok(document) = ConfigDocument::parse(output.as_bytes()) else {
        return unavailable();
    };
    let all_values = document.values();
    let effective_background_image = background_assets::state_for_value(
        data_root,
        None,
        all_values
            .get(BACKGROUND_IMAGE_KEY)
            .and_then(|values| values.last())
            .map(String::as_str),
    );
    let mut public_values = BTreeMap::new();
    for (key, values) in all_values {
        let Some(option) = safe_options.get(&key) else {
            continue;
        };
        if matches!(values.as_slice(), [value] if value.is_empty()) {
            if option.default_values.iter().any(String::is_empty) {
                continue;
            }
            return unavailable();
        }
        let Some(values) = public_scalar_values(option, &values) else {
            return unavailable();
        };
        public_values.insert(key, values);
    }
    (true, public_values, effective_background_image)
}

#[tauri::command]
async fn create_config(
    candidate_id: String,
    locale: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ConfigSession, CommandError> {
    let locale = UiLocale::parse(&locale)?;
    let _mutation_guard = acquire_mutation(&state)?;
    if candidate_id.len() > 128 {
        return Err(CommandError::new(
            "invalid_candidate",
            "candidate id is too long",
        ));
    }
    let issued_candidate = state
        .candidates
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "candidate state is unavailable"))?
        .get(&candidate_id)
        .cloned()
        .ok_or_else(|| {
            CommandError::new(
                "unknown_candidate",
                "configuration candidate was not issued by this application session",
            )
        })?;
    let candidate = fresh_creation_candidate(&candidate_id, &issued_candidate)?;
    let contract = current_runtime_contract(&state)?;
    let path = PathBuf::from(&candidate.path);
    let home = creation_root_for(&candidate, &path)?;
    safe_write::preflight_new_config(&path, &home)?;
    require_valid_empty_config(&contract.executable)?;
    let baseline = ghostty::validate_default_config(&contract.executable)?;
    if !baseline.valid {
        return Err(CommandError::new(
            "baseline_validation_failed",
            "Ghostty's current default configuration is already invalid; no file was created",
        ));
    }
    let visible_path = display_path(&path);
    let (message, confirm_label, cancel_label) = match locale {
        UiLocale::ZhCn => (
            format!(
                "在 {visible_path} 创建空白 Ghostty 配置？\n\n如果文件已经存在，将取消创建且不会覆盖。"
            ),
            "创建配置".to_string(),
            "取消".to_string(),
        ),
        UiLocale::En => (
            format!(
                "Create an empty Ghostty configuration at {visible_path}?\n\nIf the file already exists, creation will be cancelled without overwriting it."
            ),
            "Create configuration".to_string(),
            "Cancel".to_string(),
        ),
    };
    require_native_confirmation(&app, message, confirm_label, cancel_label).await?;
    let confirmed_candidate = fresh_creation_candidate(&candidate_id, &issued_candidate)?;
    if confirmed_candidate.path != candidate.path {
        return Err(CommandError::new(
            "candidate_changed",
            "the issued configuration target changed while confirmation was open",
        ));
    }
    let confirmed_contract = current_runtime_contract(&state)?;
    require_same_runtime_identity(&contract.executable, &confirmed_contract.executable)?;
    require_valid_empty_config(&confirmed_contract.executable)?;
    safe_write::preflight_new_config(&path, &home)?;
    confirmed_contract.executable.verify()?;
    let outcome = match safe_write::create_new_config(&path, &home) {
        Ok(outcome) => outcome,
        Err(error) => {
            // openat may already have created the file before chmod/fsync or a
            // readback failed. Always reconcile instead of inferring the phase
            // from an I/O error code.
            reconcile_state_after_creation_failure(&state)?;
            return Err(error);
        }
    };

    let result = (|| {
        let final_validation = ghostty::validate_default_config(&confirmed_contract.executable);
        let validation_failure = match final_validation {
            Ok(report) if report.valid => None,
            Ok(_) => {
                Some("the complete Ghostty configuration was rejected after creation".to_string())
            }
            Err(error) => Some(format!(
                "the complete Ghostty configuration could not be validated after creation: {}",
                error.message
            )),
        };
        if let Some(failure) = validation_failure {
            safe_write::verify_created_config(&path, &home, &outcome)?;
            return Err(CommandError::new(
                "post_creation_validation_failed",
                format!(
                    "{failure}; the unchanged empty file was intentionally preserved because portable POSIX deletion cannot atomically prove inode identity"
                ),
            ));
        }
        safe_write::verify_created_config(&path, &home, &outcome)?;

        let discovered = discovery::discover_config_candidates();
        let created =
            require_unique_created_candidate(&discovered, &candidate_id, &candidate.path)?;
        if created.symlink || created.size_bytes != Some(0) {
            return Err(CommandError::new(
                "post_creation_conflict",
                "the created configuration no longer has the expected file identity",
            ));
        }
        replace_discovered_candidates(&state, discovered)?;
        state
            .sessions
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
            .clear();
        state
            .stages
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
            .clear();
        let data_root = app_data_root(&app)?;
        let mut session = open_config_session(&candidate_id, &data_root, &state)?;
        if session.revision != outcome.revision {
            return Err(CommandError::new(
                "post_creation_conflict",
                "the new configuration changed before the editing session opened; the newer file was kept",
            ));
        }
        session
            .diagnostics
            .push("已创建空白配置；首次保存前仍会再次验证并创建快照。".to_string());
        session.diagnostics.extend(baseline.diagnostics);
        session.diagnostics.extend(outcome.warnings);
        Ok(session)
    })();

    if result.is_err() {
        reconcile_state_after_creation_failure(&state)?;
    }
    result
}

fn fresh_creation_candidate(
    candidate_id: &str,
    issued: &ConfigCandidate,
) -> Result<ConfigCandidate, CommandError> {
    let candidates = discovery::discover_config_candidates();
    if candidates.iter().any(|candidate| candidate.exists) {
        return Err(CommandError::new(
            "existing_config_prevents_creation",
            "a default Ghostty configuration already exists; v1 creation will not add another layer",
        ));
    }
    let fresh = candidates
        .into_iter()
        .find(|candidate| candidate.id == candidate_id)
        .ok_or_else(|| {
            CommandError::new(
                "unknown_candidate",
                "the issued configuration candidate is no longer discoverable",
            )
        })?;
    if fresh.path != issued.path
        || fresh.source != issued.source
        || fresh.format != issued.format
        || fresh.label != issued.label
        || fresh.exists
        || fresh.symlink
        || !fresh.writable
    {
        return Err(CommandError::new(
            "candidate_changed",
            "the configuration candidate changed and is no longer eligible for creation",
        ));
    }
    Ok(fresh)
}

fn require_unique_created_candidate<'a>(
    candidates: &'a [ConfigCandidate],
    candidate_id: &str,
    candidate_path: &str,
) -> Result<&'a ConfigCandidate, CommandError> {
    let mut existing = candidates.iter().filter(|candidate| candidate.exists);
    let created = existing.next().ok_or_else(|| {
        CommandError::new(
            "post_creation_unverified",
            "fresh discovery did not find the newly created configuration",
        )
    })?;
    if existing.next().is_some() {
        return Err(CommandError::new(
            "post_creation_conflict",
            "another default configuration layer appeared during creation; all files were preserved",
        ));
    }
    if created.id != candidate_id || created.path != candidate_path {
        return Err(CommandError::new(
            "post_creation_conflict",
            "fresh discovery found a different default configuration layer; all files were preserved",
        ));
    }
    Ok(created)
}

fn creation_root_for(candidate: &ConfigCandidate, target: &Path) -> Result<PathBuf, CommandError> {
    let home = std::env::var_os("HOME").map(PathBuf::from).ok_or_else(|| {
        CommandError::new(
            "home_unavailable",
            "the user home is unavailable; configuration creation is disabled",
        )
    })?;
    if home.to_str().is_none() {
        return Err(CommandError::new(
            "non_utf8_config_root",
            "automatic creation is disabled because HOME cannot cross the UTF-8 application boundary without loss",
        ));
    }
    if std::env::var_os("XDG_CONFIG_HOME")
        .as_deref()
        .is_some_and(|value| value.to_str().is_none())
    {
        return Err(CommandError::new(
            "non_utf8_config_root",
            "automatic creation is disabled because XDG_CONFIG_HOME cannot be represented without changing its bytes",
        ));
    }
    if candidate.source == "xdg" {
        if let Some(xdg) = std::env::var_os("XDG_CONFIG_HOME").map(PathBuf::from) {
            if !xdg.is_absolute() {
                return Err(CommandError::new(
                    "relative_xdg_config_home",
                    "automatic creation ignores a relative XDG_CONFIG_HOME",
                ));
            }
            if !xdg.starts_with(&home) {
                return Err(CommandError::new(
                    "creation_outside_approved_root",
                    "v1 requires manual creation when XDG_CONFIG_HOME is outside the user home",
                ));
            }
        }
    }
    if !target.starts_with(&home) {
        return Err(CommandError::new(
            "creation_outside_approved_root",
            "v1 only creates default Ghostty configurations inside the user home",
        ));
    }
    Ok(home)
}

fn require_valid_empty_config(
    executable: &ghostty::ExecutableIdentity,
) -> Result<(), CommandError> {
    let validation = safe_write::validate_empty_config(executable)?;
    if validation.valid {
        Ok(())
    } else {
        Err(CommandError::new(
            "validation_failed",
            "Ghostty rejected an empty candidate; no configuration file was created",
        ))
    }
}

fn replace_discovered_candidates(
    state: &AppState,
    candidates: Vec<ConfigCandidate>,
) -> Result<(), CommandError> {
    let mut store = state
        .candidates
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "candidate state is unavailable"))?;
    store.clear();
    store.extend(
        candidates
            .into_iter()
            .map(|candidate| (candidate.id.clone(), candidate)),
    );
    Ok(())
}

fn reconcile_state_after_creation_failure(state: &AppState) -> Result<(), CommandError> {
    replace_discovered_candidates(state, discovery::discover_config_candidates())?;
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .clear();
    state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
        .clear();
    Ok(())
}

#[tauri::command]
fn stage_changes(
    app: tauri::AppHandle,
    session_id: String,
    revision: String,
    changes: Vec<DraftChange>,
    state: State<'_, AppState>,
) -> Result<ChangePreview, CommandError> {
    let _mutation_guard = acquire_mutation(&state)?;
    require_canonical_uuid(&session_id, "invalid_session_id", "session id")?;
    require_revision(&revision)?;
    if changes.is_empty() || changes.len() > 128 {
        return Err(CommandError::new(
            "invalid_change_set",
            "a change set must contain between 1 and 128 settings",
        ));
    }
    let change_payload_bytes = changes.iter().fold(0_usize, |total, change| {
        total
            .saturating_add(change.key.len())
            .saturating_add(change.before.iter().map(String::len).sum::<usize>())
            .saturating_add(change.after.iter().map(String::len).sum::<usize>())
    });
    if change_payload_bytes > 1024 * 1024 {
        return Err(CommandError::new(
            "change_set_too_large",
            "the change set exceeds the 1 MiB IPC safety limit",
        ));
    }
    require_unique_draft_keys(&changes)?;
    let session = state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| CommandError::new("unknown_session", "configuration session has expired"))?;
    if session.revision != revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the UI revision does not match the open configuration session",
        ));
    }
    if session.read_only {
        return Err(CommandError::new(
            "read_only_session",
            "this session has not been granted write access",
        ));
    }
    let current_bytes = safe_write::read_regular_target_file(&session.path)?;
    if safe_write::revision(&current_bytes) != session.revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the configuration changed outside Ghostty Studio; reload before reviewing",
        ));
    }

    let contract = current_runtime_contract(&state)?;
    let data_root = app_data_root(&app)?;
    let mut candidate_document = session.document.clone();
    let mut trusted_changes = Vec::with_capacity(changes.len());
    let mut background_asset_id = None;
    for change in changes {
        if !contract.editable_keys.contains(&change.key) {
            return Err(CommandError::new(
                "setting_requires_specialized_editor",
                format!(
                    "{} is sensitive, repeatable, advanced, or unknown and cannot use the generic scalar write path",
                    change.key
                ),
            ));
        }
        if change.after.len() > 1 {
            return Err(CommandError::new(
                "complex_setting_requires_editor",
                format!(
                    "{} has multiple values and requires the ordered-list editor",
                    change.key
                ),
            ));
        }
        if candidate_document.duplicate_count(&change.key) > 1 {
            return Err(CommandError::new(
                "duplicate_setting_requires_editor",
                format!(
                    "{} appears more than once; changing it requires provenance-aware editing",
                    change.key
                ),
            ));
        }
        let before = candidate_document
            .values()
            .remove(&change.key)
            .unwrap_or_default();
        if change.key == BACKGROUND_IMAGE_KEY {
            let expected_before = public_background_values(background_assets::state_for_value(
                &data_root,
                Some(&session.path),
                before.last().map(String::as_str),
            ));
            if change.before != expected_before {
                return Err(CommandError::new(
                    "background_draft_changed",
                    "the background image draft no longer matches the open configuration",
                ));
            }
            let next_token = change.after.first().map(String::as_str).unwrap_or_default();
            if change.after.len() > 1 {
                return Err(CommandError::new(
                    "complex_setting_requires_editor",
                    "background-image accepts one managed image",
                ));
            }
            if next_token.is_empty() {
                candidate_document.remove_scalar(BACKGROUND_IMAGE_KEY)?;
            } else if next_token == RESET_BACKGROUND_TOKEN {
                // An empty Ghostty value is an explicit reset to the default.
                // Removing the line would instead expose an earlier source.
                candidate_document.set_scalar(BACKGROUND_IMAGE_KEY, "")?;
            } else {
                let asset_id = next_token
                    .strip_prefix(MANAGED_BACKGROUND_PREFIX)
                    .ok_or_else(|| {
                        CommandError::new(
                            "invalid_background_selection",
                            "background-image can only select an imported managed image",
                        )
                    })?;
                let managed_path = background_assets::resolve_asset_path(&data_root, asset_id)?;
                let managed_value = managed_path.to_str().ok_or_else(|| {
                    CommandError::new(
                        "background_asset_path_unavailable",
                        "the managed image path is not valid UTF-8",
                    )
                })?;
                candidate_document.set_scalar(BACKGROUND_IMAGE_KEY, managed_value)?;
                background_asset_id = Some(asset_id.to_string());
            }
            if expected_before == change.after && next_token != RESET_BACKGROUND_TOKEN {
                continue;
            }
            trusted_changes.push(DraftChange {
                key: change.key,
                before: expected_before,
                after: change.after,
            });
            continue;
        }

        let option = contract.editable_options.get(&change.key).ok_or_else(|| {
            CommandError::new(
                "setting_requires_specialized_editor",
                format!("{} is not available to the scalar editor", change.key),
            )
        })?;
        if !before.is_empty() && public_scalar_values(option, &before).is_none() {
            return Err(CommandError::new(
                "existing_setting_value_invalid",
                "an existing setting cannot be represented safely by its audited editor",
            ));
        }
        let next = change.after.first().cloned().unwrap_or_default();
        if !next.is_empty() {
            validate_setting_value(option, &next)?;
        }
        if next.is_empty() {
            candidate_document.remove_scalar(&change.key)?;
        } else {
            candidate_document.set_scalar(&change.key, &next)?;
        }
        let after = if next.is_empty() {
            Vec::new()
        } else {
            vec![next]
        };
        if before == after {
            continue;
        }
        trusted_changes.push(DraftChange {
            key: change.key,
            before,
            after,
        });
    }
    if trusted_changes.is_empty() {
        return Err(CommandError::new(
            "no_effective_changes",
            "the requested draft does not change the selected configuration file",
        ));
    }
    let candidate_bytes = candidate_document.render();
    if candidate_bytes.len() > 4 * 1024 * 1024 {
        return Err(CommandError::new(
            "candidate_too_large",
            "the rendered configuration exceeds the 4 MiB safety limit",
        ));
    }
    let validation =
        safe_write::validate_candidate(&contract.executable, &session.path, &candidate_bytes)?;
    let default_candidates = discovery::discover_config_candidates();
    let (effect, dependency_revision) = match build_config_graph_for(&default_candidates) {
        Ok(graph) => {
            let candidates = workspace_candidates(&default_candidates, &graph);
            (
                effective_config::preview_change_effect(
                    &graph,
                    &session.path,
                    &trusted_changes,
                    &candidates,
                    contract.ghostty_version.as_deref(),
                ),
                effective_config::dependency_revision(
                    &graph,
                    &default_candidates,
                    &session.path,
                    contract.ghostty_version.as_deref(),
                ),
            )
        }
        Err(_) => (
            ChangeEffectPreview {
                status: "unverified".to_string(),
                affected_keys: trusted_changes
                    .iter()
                    .map(|change| change.key.clone())
                    .collect(),
                suggested_candidate_id: None,
                suggested_label: None,
            },
            "unavailable".to_string(),
        ),
    };
    let review_contract = runtime_contract::review_contract(
        &contract.writable_options,
        trusted_changes.iter().map(|change| change.key.clone()),
    );
    if review_contract.len()
        != trusted_changes
            .iter()
            .map(|change| &change.key)
            .collect::<HashSet<_>>()
            .len()
    {
        return Err(CommandError::new(
            "ghostty_contract_changed",
            "the writable Ghostty contract changed while this review was being prepared",
        ));
    }
    let public_changes = public_review_changes(&trusted_changes, &review_contract)?;
    let token = Uuid::new_v4().to_string();
    let unified_diff = render_setting_diff(&public_changes);
    let activation = activation_for_changes(&trusted_changes, &contract.editable_options);
    let staged = StagedCandidate {
        session_id: session_id.clone(),
        revision: revision.clone(),
        bytes: candidate_bytes,
        changes: trusted_changes.clone(),
        diagnostics: validation.diagnostics.clone(),
        valid: validation.valid,
        activation: activation.clone(),
        background_asset_id,
        effect: effect.clone(),
        dependency_revision,
        review_contract,
        runtime_identity: contract.executable.clone(),
    };
    let mut stages = state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?;
    stages.retain(|_, existing| existing.session_id != session_id);
    if stages.len() >= 8 {
        return Err(CommandError::new(
            "too_many_active_reviews",
            "too many configuration reviews are active; reopen the application",
        ));
    }
    stages.insert(token.clone(), staged);

    Ok(ChangePreview {
        token,
        revision,
        changes: public_changes,
        unified_diff,
        diagnostics: validation.diagnostics,
        valid: validation.valid,
        activation,
        effect,
    })
}

#[tauri::command]
async fn apply_changes(
    app: tauri::AppHandle,
    session_id: String,
    revision: String,
    token: String,
    locale: String,
    state: State<'_, AppState>,
) -> Result<ApplyResult, CommandError> {
    let locale = UiLocale::parse(&locale)?;
    require_canonical_uuid(&session_id, "invalid_session_id", "session id")?;
    require_canonical_uuid(&token, "invalid_stage_token", "review token")?;
    require_revision(&revision)?;
    let _mutation_guard = acquire_mutation(&state)?;
    let stage = state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
        .remove(&token)
        .ok_or_else(|| CommandError::new("unknown_stage", "review token is invalid or expired"))?;
    if stage.session_id != session_id || stage.revision != revision {
        return Err(CommandError::new(
            "stage_mismatch",
            "review token does not belong to this session and revision",
        ));
    }
    if !stage.valid {
        return Err(CommandError::new(
            "validation_failed",
            "Ghostty rejected the staged configuration",
        ));
    }
    require_effective_write_plan(&stage.effect)?;

    let session = state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .get(&session_id)
        .cloned()
        .ok_or_else(|| CommandError::new("unknown_session", "configuration session has expired"))?;
    if session.read_only {
        return Err(CommandError::new(
            "read_only_session",
            "this session has not been granted write access",
        ));
    }
    let data_root = app_data_root(&app)?;
    if let Some(asset_id) = stage.background_asset_id.as_deref() {
        background_assets::resolve_asset_path(&data_root, asset_id)?;
    }
    let contract = current_runtime_contract(&state)?;
    require_same_runtime_identity(&stage.runtime_identity, &contract.executable)?;
    require_review_contract(&stage, &contract)?;
    require_unchanged_review_contract(&stage.changes, &contract.changed_writable_keys)?;
    require_current_change_keys(&stage.changes, &contract.editable_keys)?;
    require_current_effective_plan(&stage, &session, &contract)?;
    let public_changes = public_review_changes(&stage.changes, &stage.review_contract)?;
    let trusted_summary = native_change_summary(&public_changes, locale);
    let trusted_target = display_path(&session.path);
    let (message, confirm_label, cancel_label) = match locale {
        UiLocale::ZhCn => (
            format!(
                "保存位置：{trusted_target}\n\n请核对 {} 项修改：\n{trusted_summary}\n\n保存前会自动创建恢复点。",
                stage.changes.len(),
            ),
            "保存配置".to_string(),
            "取消".to_string(),
        ),
        UiLocale::En => (
            format!(
                "Save destination: {trusted_target}\n\nReview {} {}:\n{trusted_summary}\n\nA restore point will be created first.",
                stage.changes.len(),
                if stage.changes.len() == 1 {
                    "change"
                } else {
                    "changes"
                },
            ),
            "Save configuration".to_string(),
            "Cancel".to_string(),
        ),
    };
    require_native_confirmation(&app, message, confirm_label, cancel_label).await?;
    if let Some(asset_id) = stage.background_asset_id.as_deref() {
        background_assets::resolve_asset_path(&data_root, asset_id)?;
    }
    let contract = current_runtime_contract(&state)?;
    require_same_runtime_identity(&stage.runtime_identity, &contract.executable)?;
    require_review_contract(&stage, &contract)?;
    require_unchanged_review_contract(&stage.changes, &contract.changed_writable_keys)?;
    require_current_change_keys(&stage.changes, &contract.editable_keys)?;
    require_current_effective_plan(&stage, &session, &contract)?;
    let current_validation =
        safe_write::validate_candidate(&contract.executable, &session.path, &stage.bytes)?;
    if !current_validation.valid {
        return Err(CommandError::new(
            "validation_failed_after_confirmation",
            format!(
                "the current Ghostty binary rejected the reviewed candidate: {}",
                diagnostic_summary(&current_validation.diagnostics)
            ),
        ));
    }
    contract.executable.verify()?;
    let outcome = write_for_open_session(&data_root, &state, &session_id, &session, &stage.bytes)?;
    rollback_if_runtime_changed(
        &contract.executable,
        &data_root,
        &state,
        &session_id,
        &session,
        &session.original_bytes,
        &outcome.revision,
    )?;

    let final_validation = ghostty::validate_default_config(&contract.executable);
    let validation_failure = match final_validation {
        Ok(report) if report.valid => None,
        Ok(report) => Some(format!(
            "the complete Ghostty configuration was rejected: {}",
            diagnostic_summary(&report.diagnostics)
        )),
        Err(error) => Some(format!(
            "the complete Ghostty configuration could not be validated: {}",
            error.message
        )),
    };
    if let Some(failure) = validation_failure {
        return Err(rollback_written_change(
            &data_root,
            &state,
            &session_id,
            &session,
            &session.original_bytes,
            &outcome.revision,
            "post_write_validation_failed",
            "post_write_validation_rollback_failed",
            &failure,
        ));
    }

    if let Err(error) = require_current_effective_plan(&stage, &session, &contract) {
        return Err(rollback_written_change(
            &data_root,
            &state,
            &session_id,
            &session,
            &session.original_bytes,
            &outcome.revision,
            "post_write_effect_verification_failed",
            "post_write_effect_rollback_failed",
            &error.message,
        ));
    }
    let exact_effect_verified = match verify_effective_changes(&stage, &contract, &data_root) {
        Ok(exact) => exact,
        Err(error) => {
            return Err(rollback_written_change(
                &data_root,
                &state,
                &session_id,
                &session,
                &session.original_bytes,
                &outcome.revision,
                "post_write_effect_verification_failed",
                "post_write_effect_rollback_failed",
                &error.message,
            ));
        }
    };
    if let Err(error) = require_current_effective_plan(&stage, &session, &contract) {
        return Err(rollback_written_change(
            &data_root,
            &state,
            &session_id,
            &session,
            &session.original_bytes,
            &outcome.revision,
            "post_write_effect_verification_failed",
            "post_write_effect_rollback_failed",
            &error.message,
        ));
    }
    rollback_if_runtime_changed(
        &contract.executable,
        &data_root,
        &state,
        &session_id,
        &session,
        &session.original_bytes,
        &outcome.revision,
    )?;

    let committed_revision =
        refresh_session_after_verified_write(&state, &session_id, &session, &outcome.revision)?;

    let mut diagnostics = stage.diagnostics;
    diagnostics.push(format!("已应用 {} 项经过验证的更改。", stage.changes.len()));
    Ok(ApplyResult {
        revision: committed_revision,
        snapshot_id: outcome.snapshot_id,
        diagnostics,
        warnings: outcome.warnings,
        activation: stage.activation,
        reload_required: true,
        effective_status: if exact_effect_verified {
            "verified"
        } else {
            "resolved"
        }
        .to_string(),
    })
}

fn require_effective_write_plan(effect: &ChangeEffectPreview) -> Result<(), CommandError> {
    match effect.status.as_str() {
        "effective" => Ok(()),
        "overridden" => Err(CommandError::new(
            "change_would_be_overridden",
            "a later configuration source would override this change",
        )),
        _ => Err(CommandError::new(
            "effective_source_unverified",
            "the effective configuration source could not be verified",
        )),
    }
}

fn require_current_effective_plan(
    stage: &StagedCandidate,
    session: &OpenSession,
    contract: &CurrentRuntimeContract,
) -> Result<(), CommandError> {
    let default_candidates = discovery::discover_config_candidates();
    let graph = build_config_graph_for(&default_candidates)?;
    let candidates = workspace_candidates(&default_candidates, &graph);
    let dependency_revision = effective_config::dependency_revision(
        &graph,
        &default_candidates,
        &session.path,
        contract.ghostty_version.as_deref(),
    );
    if dependency_revision != stage.dependency_revision {
        return Err(CommandError::new(
            "effective_sources_changed",
            "another configuration source changed after review",
        ));
    }
    let effect = effective_config::preview_change_effect(
        &graph,
        &session.path,
        &stage.changes,
        &candidates,
        contract.ghostty_version.as_deref(),
    );
    require_effective_write_plan(&effect)
}

fn verify_effective_changes(
    stage: &StagedCandidate,
    contract: &CurrentRuntimeContract,
    data_root: &Path,
) -> Result<bool, CommandError> {
    let output = ghostty::show_effective_config(&contract.executable)?;
    let document = ConfigDocument::parse(output.as_bytes())?;
    let effective = document.values();
    let mut exact = true;
    for change in &stage.changes {
        let actual_values = effective.get(&change.key).ok_or_else(|| {
            CommandError::new(
                "effective_value_mismatch",
                "Ghostty did not return the reviewed setting",
            )
        })?;
        let [actual] = actual_values.as_slice() else {
            return Err(CommandError::new(
                "effective_value_mismatch",
                "Ghostty returned an unexpected number of effective values for a reviewed setting",
            ));
        };
        let expected = change.after.last();
        let matches = match change.key.as_str() {
            BACKGROUND_IMAGE_KEY if expected.is_none() => {
                exact = false;
                true
            }
            BACKGROUND_IMAGE_KEY
                if expected.is_some_and(|value| value == RESET_BACKGROUND_TOKEN) =>
            {
                unquote_value(actual).is_empty()
            }
            BACKGROUND_IMAGE_KEY => {
                let asset_id = stage.background_asset_id.as_deref().ok_or_else(|| {
                    CommandError::new(
                        "effective_value_mismatch",
                        "the reviewed managed image identity is unavailable",
                    )
                })?;
                let expected_path = background_assets::resolve_asset_path(data_root, asset_id)?;
                equivalent_existing_paths(&expected_path, Path::new(unquote_value(actual)))
            }
            _ => {
                let option = contract.editable_options.get(&change.key).ok_or_else(|| {
                    CommandError::new(
                        "effective_value_mismatch",
                        "the reviewed scalar setting is no longer in the audited runtime contract",
                    )
                })?;
                validate_effective_setting_value(option, actual)?;
                match expected {
                    Some(expected) => scalar_values_match(option, expected, actual),
                    None => {
                        exact = false;
                        true
                    }
                }
            }
        };
        if !matches {
            return Err(CommandError::new(
                "effective_value_mismatch",
                "Ghostty's final setting does not match the reviewed value",
            ));
        }
    }
    Ok(exact)
}

fn validate_effective_setting_value(
    option: &RuntimeOption,
    value: &str,
) -> Result<(), CommandError> {
    let value = unquote_value(value).trim();
    let default_allows_empty = value.is_empty()
        && option
            .default_values
            .iter()
            .any(|default| unquote_value(default).trim().is_empty());
    if default_allows_empty || validate_setting_value(option, value).is_ok() {
        Ok(())
    } else {
        Err(CommandError::new(
            "effective_value_mismatch",
            "Ghostty returned an effective value outside the audited editor contract",
        ))
    }
}

fn scalar_values_match(option: &RuntimeOption, expected: &str, actual: &str) -> bool {
    let expected = unquote_value(expected).trim();
    let actual = unquote_value(actual).trim();
    match option.kind.as_str() {
        "number" => {
            let expected = expected.parse::<f64>().ok();
            let actual = actual.parse::<f64>().ok();
            matches!((expected, actual), (Some(left), Some(right)) if (left - right).abs() <= 1e-9)
        }
        "boolean" => expected.eq_ignore_ascii_case(actual),
        "color" => expected
            .strip_prefix('#')
            .unwrap_or(expected)
            .eq_ignore_ascii_case(actual.strip_prefix('#').unwrap_or(actual)),
        _ => expected == actual,
    }
}

fn unquote_value(value: &str) -> &str {
    value
        .strip_prefix('"')
        .and_then(|remaining| remaining.strip_suffix('"'))
        .unwrap_or(value)
}

fn equivalent_existing_paths(expected: &Path, actual: &Path) -> bool {
    match (
        std::fs::canonicalize(expected),
        std::fs::canonicalize(actual),
    ) {
        (Ok(expected), Ok(actual)) => expected == actual,
        _ => false,
    }
}

#[tauri::command]
fn list_snapshots(
    app: tauri::AppHandle,
    session_id: String,
    state: State<'_, AppState>,
) -> Result<Vec<safe_write::SnapshotInfo>, CommandError> {
    let data_root = app_data_root(&app)?;
    list_snapshots_for_session(&data_root, &session_id, &state)
}

#[tauri::command]
async fn restore_snapshot(
    app: tauri::AppHandle,
    session_id: String,
    revision: String,
    snapshot_id: String,
    locale: String,
    state: State<'_, AppState>,
) -> Result<ApplyResult, CommandError> {
    let locale = UiLocale::parse(&locale)?;
    require_canonical_uuid(&snapshot_id, "invalid_snapshot_id", "snapshot id")?;
    require_revision(&revision)?;
    let _mutation_guard = acquire_mutation(&state)?;
    let session = open_session(&state, &session_id)?;
    if session.read_only {
        return Err(CommandError::new(
            "read_only_session",
            "this session has not been granted write access",
        ));
    }
    if session.revision != revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the UI revision does not match the open configuration session",
        ));
    }
    let data_root = app_data_root(&app)?;
    let contract = current_runtime_contract(&state)?;
    let mut prepared = prepare_snapshot_restore(
        &data_root,
        &contract.executable,
        &session,
        &revision,
        &snapshot_id,
    )?;
    enforce_snapshot_restore_policy(
        &prepared,
        &contract.editable_options,
        &contract.editable_keys,
    )?;
    let trusted_target = bounded_text(&display_path(&session.path), 240);
    let snapshot_time = format_utc_timestamp(prepared.snapshot.created_at_ms);
    let snapshot_short_id = prepared.snapshot.id.chars().take(8).collect::<String>();
    let changed_keys = native_key_summary(&prepared.changed_keys, locale);
    let (message, confirm_label, cancel_label) = match locale {
        UiLocale::ZhCn => (
            format!(
                "恢复位置：{trusted_target}\n快照：{snapshot_time} · {snapshot_short_id}\n涉及设置：{changed_keys}\n\n当前配置会先备份。"
            ),
            "恢复配置".to_string(),
            "取消".to_string(),
        ),
        UiLocale::En => (
            format!(
                "Restore destination: {trusted_target}\nSnapshot: {snapshot_time} · {snapshot_short_id}\nChanged settings: {changed_keys}\n\nThe current configuration will be backed up first."
            ),
            "Restore configuration".to_string(),
            "Cancel".to_string(),
        ),
    };
    require_native_confirmation(&app, message, confirm_label, cancel_label).await?;
    let contract = current_runtime_contract(&state)?;
    require_same_runtime_identity(&prepared.runtime_identity, &contract.executable)?;
    enforce_snapshot_restore_policy(
        &prepared,
        &contract.editable_options,
        &contract.editable_keys,
    )?;
    let current_validation = safe_write::validate_candidate(
        &contract.executable,
        &session.path,
        &prepared.restored_bytes,
    )?;
    if !current_validation.valid {
        return Err(CommandError::new(
            "snapshot_validation_failed_after_confirmation",
            format!(
                "the current Ghostty binary rejected the reviewed snapshot: {}",
                diagnostic_summary(&current_validation.diagnostics)
            ),
        ));
    }
    prepared.validation = current_validation;
    let activation = activation_for_keys(&prepared.changed_keys, &contract.editable_options);
    apply_prepared_snapshot_restore(
        &data_root,
        &contract.executable,
        &session_id,
        &revision,
        prepared,
        activation,
        &state,
    )
}

fn list_snapshots_for_session(
    data_root: &Path,
    session_id: &str,
    state: &AppState,
) -> Result<Vec<safe_write::SnapshotInfo>, CommandError> {
    let session = open_session(state, session_id)?;
    safe_write::list_snapshots(data_root, &session.path)
}

#[cfg(test)]
fn restore_snapshot_for_session(
    data_root: &Path,
    executable: &Path,
    session_id: &str,
    expected_revision: &str,
    snapshot_id: &str,
    state: &AppState,
) -> Result<ApplyResult, CommandError> {
    require_canonical_uuid(snapshot_id, "invalid_snapshot_id", "snapshot id")?;
    let session = open_session(state, session_id)?;
    if session.read_only {
        return Err(CommandError::new(
            "read_only_session",
            "this session has not been granted write access",
        ));
    }
    if session.revision != expected_revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the UI revision does not match the open configuration session",
        ));
    }

    let executable = ghostty::ExecutableIdentity::capture(executable)?;
    let prepared = prepare_snapshot_restore(
        data_root,
        &executable,
        &session,
        expected_revision,
        snapshot_id,
    )?;
    apply_prepared_snapshot_restore(
        data_root,
        &executable,
        session_id,
        expected_revision,
        prepared,
        "reload".to_string(),
        state,
    )
}

fn prepare_snapshot_restore(
    data_root: &Path,
    executable: &ghostty::ExecutableIdentity,
    session: &OpenSession,
    expected_revision: &str,
    snapshot_id: &str,
) -> Result<PreparedSnapshotRestore, CommandError> {
    if session.revision != expected_revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the UI revision does not match the open configuration session",
        ));
    }
    let current_bytes = safe_write::read_regular_target_file(&session.path)?;
    if safe_write::revision(&current_bytes) != session.revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the configuration changed outside Ghostty Studio; reload before restoring",
        ));
    }
    let snapshot = safe_write::list_snapshots(data_root, &session.path)?
        .into_iter()
        .find(|snapshot| snapshot.id == snapshot_id)
        .ok_or_else(|| {
            CommandError::new(
                "unknown_snapshot",
                "snapshot is unavailable, expired, or belongs to another target",
            )
        })?;
    let restored_bytes = safe_write::read_snapshot(data_root, &session.path, snapshot_id)?;
    let current_document = ConfigDocument::parse(&current_bytes)?;
    let restored_document = ConfigDocument::parse(&restored_bytes)?;
    let current_values = current_document.values();
    let restored_values = restored_document.values();
    let mut changed_keys = current_values
        .keys()
        .chain(restored_values.keys())
        .collect::<HashSet<_>>()
        .into_iter()
        .filter(|key| current_values.get(*key) != restored_values.get(*key))
        .cloned()
        .collect::<Vec<_>>();
    changed_keys.sort();
    let validation = safe_write::validate_candidate(executable, &session.path, &restored_bytes)?;
    if !validation.valid {
        return Err(CommandError::new(
            "snapshot_validation_failed",
            format!(
                "Ghostty rejected the snapshot before restore: {}",
                diagnostic_summary(&validation.diagnostics)
            ),
        ));
    }
    Ok(PreparedSnapshotRestore {
        current_bytes,
        restored_bytes,
        validation,
        snapshot,
        changed_keys,
        runtime_identity: executable.clone(),
    })
}

fn enforce_snapshot_restore_policy(
    prepared: &PreparedSnapshotRestore,
    options: &HashMap<String, RuntimeOption>,
    editable_keys: &HashSet<String>,
) -> Result<(), CommandError> {
    let blocked_count = prepared
        .changed_keys
        .iter()
        .filter(|key| !options.contains_key(*key) && !editable_keys.contains(*key))
        .count();
    if blocked_count > 0 {
        return Err(CommandError::new(
            "snapshot_requires_specialized_restore",
            format!(
                "这个快照包含 {blocked_count} 个当前版本无法安全恢复的设置，因此不能自动恢复。"
            ),
        ));
    }

    let current_document = ConfigDocument::parse(&prepared.current_bytes)?;
    let restored_document = ConfigDocument::parse(&prepared.restored_bytes)?;
    let restored_values = restored_document.values();
    for key in &prepared.changed_keys {
        if key == BACKGROUND_IMAGE_KEY && editable_keys.contains(key) {
            if current_document.duplicate_count(key) > 1
                || restored_document.duplicate_count(key) > 1
            {
                return Err(CommandError::new(
                    "snapshot_requires_specialized_restore",
                    "这个快照涉及多处重复背景图片设置，需要先在配置文件中确认来源。",
                ));
            }
            if let Some(values) = restored_values.get(key) {
                if values.len() > 1
                    || values
                        .iter()
                        .any(|value| value.len() > 4096 || value.chars().any(char::is_control))
                {
                    return Err(CommandError::new(
                        "snapshot_setting_invalid",
                        "快照中的背景图片路径不符合当前安全规则。",
                    ));
                }
            }
            continue;
        }
        let option = options.get(key).ok_or_else(|| {
            CommandError::new(
                "snapshot_requires_specialized_restore",
                "这个快照包含当前版本无法安全恢复的设置。",
            )
        })?;
        if current_document.duplicate_count(key) > 1 || restored_document.duplicate_count(key) > 1 {
            return Err(CommandError::new(
                "snapshot_requires_specialized_restore",
                "这个快照涉及多处重复设置，需要先在配置文件中确认来源。",
            ));
        }
        if let Some(values) = restored_values.get(key) {
            if values.len() > 1 {
                return Err(CommandError::new(
                    "snapshot_requires_specialized_restore",
                    "这个快照包含多值设置，需要专用编辑方式。",
                ));
            }
            if let Some(value) = values.first() {
                validate_setting_value(option, value).map_err(|_| {
                    CommandError::new(
                        "snapshot_setting_invalid",
                        format!("快照中的 {key} 不符合当前 Ghostty 的取值规则。"),
                    )
                })?;
            }
        }
    }
    Ok(())
}

fn apply_prepared_snapshot_restore(
    data_root: &Path,
    executable: &ghostty::ExecutableIdentity,
    session_id: &str,
    expected_revision: &str,
    prepared: PreparedSnapshotRestore,
    activation: String,
    state: &AppState,
) -> Result<ApplyResult, CommandError> {
    let session = open_session(state, session_id)?;
    if session.read_only || session.revision != expected_revision {
        return Err(CommandError::new(
            "revision_conflict",
            "configuration session changed while the restore was being reviewed",
        ));
    }
    require_same_runtime_identity(&prepared.runtime_identity, executable)?;
    let restored_snapshot_id = prepared.snapshot.id.clone();

    executable.verify()?;
    let outcome = write_for_open_session(
        data_root,
        state,
        session_id,
        &session,
        &prepared.restored_bytes,
    )?;
    rollback_if_runtime_changed(
        executable,
        data_root,
        state,
        session_id,
        &session,
        &prepared.current_bytes,
        &outcome.revision,
    )?;

    let final_validation = ghostty::validate_default_config(executable);
    let validation_failure = match final_validation {
        Ok(report) if report.valid => None,
        Ok(report) => Some(format!(
            "the complete Ghostty configuration was rejected after restore: {}",
            diagnostic_summary(&report.diagnostics)
        )),
        Err(error) => Some(format!(
            "the complete Ghostty configuration could not be validated after restore: {}",
            error.message
        )),
    };
    if let Some(failure) = validation_failure {
        return Err(rollback_written_change(
            data_root,
            state,
            session_id,
            &session,
            &prepared.current_bytes,
            &outcome.revision,
            "post_restore_validation_failed",
            "post_restore_validation_rollback_failed",
            &failure,
        ));
    }
    rollback_if_runtime_changed(
        executable,
        data_root,
        state,
        session_id,
        &session,
        &prepared.current_bytes,
        &outcome.revision,
    )?;

    let restored_revision =
        refresh_session_after_verified_write(state, session_id, &session, &outcome.revision)?;
    let mut diagnostics = prepared.validation.diagnostics;
    diagnostics.push(format!(
        "已恢复快照 {restored_snapshot_id}；恢复前状态已保存为回滚快照 {}。",
        outcome.snapshot_id
    ));
    Ok(ApplyResult {
        revision: restored_revision,
        snapshot_id: outcome.snapshot_id,
        diagnostics,
        warnings: outcome.warnings,
        activation,
        reload_required: true,
        effective_status: "unverified".to_string(),
    })
}

fn rollback_if_runtime_changed(
    executable: &ghostty::ExecutableIdentity,
    data_root: &Path,
    state: &AppState,
    session_id: &str,
    session: &OpenSession,
    original_bytes: &[u8],
    written_revision: &str,
) -> Result<(), CommandError> {
    executable.verify().map_err(|error| {
        rollback_written_change(
            data_root,
            state,
            session_id,
            session,
            original_bytes,
            written_revision,
            "ghostty_runtime_changed_after_write",
            "ghostty_runtime_change_rollback_failed",
            &error.message,
        )
    })
}

#[allow(clippy::too_many_arguments)]
fn rollback_written_change(
    data_root: &Path,
    state: &AppState,
    session_id: &str,
    session: &OpenSession,
    original_bytes: &[u8],
    written_revision: &str,
    validation_error_code: &'static str,
    rollback_error_code: &'static str,
    validation_failure: &str,
) -> CommandError {
    match safe_write::write_atomically(&session.path, original_bytes, written_revision, data_root) {
        Ok(rollback_outcome) => {
            let refresh_result = ConfigDocument::parse(original_bytes).and_then(|document| {
                replace_open_session(
                    state,
                    session_id,
                    session,
                    original_bytes.to_vec(),
                    document,
                )
            });
            if !rollback_outcome.warnings.is_empty() {
                let refresh_status = match refresh_result {
                    Ok(revision) => format!("session refreshed to revision {revision}"),
                    Err(error) => {
                        format!(
                            "session refresh failed and editing must stop: {}",
                            error.message
                        )
                    }
                };
                return CommandError::new(
                    rollback_error_code,
                    format!(
                        "{validation_failure}; the previous bytes were restored, but rollback durability could not be confirmed: {}; {refresh_status}",
                        rollback_outcome.warnings.join("; ")
                    ),
                );
            }
            match refresh_result {
                Ok(revision) => CommandError::new(
                    validation_error_code,
                    format!(
                        "{validation_failure}; the previous bytes were restored atomically and the session was refreshed to revision {revision}"
                    ),
                ),
                Err(error) => CommandError::new(
                    "session_refresh_failed_after_rollback",
                    format!(
                        "{validation_failure}; the previous bytes were restored, but session refresh failed: {}",
                        error.message
                    ),
                ),
            }
        }
        Err(rollback_error) => {
            let refresh_status = match refresh_or_expire_session(state, session_id, session) {
                Ok(revision) => format!("session refreshed to on-disk revision {revision}"),
                Err(error) => format!("session expired because refresh failed: {}", error.message),
            };
            let rollback_status = if matches!(
                rollback_error.code,
                "post_commit_conflict" | "post_commit_unverified"
            ) {
                "rollback may have committed but its final disk state could not be verified"
            } else {
                "rollback stopped without overwriting a concurrent edit"
            };
            CommandError::new(
                rollback_error_code,
                format!(
                    "{validation_failure}; {rollback_status}: [{}] {}; {refresh_status}",
                    rollback_error.code, rollback_error.message
                ),
            )
        }
    }
}

fn write_for_open_session(
    data_root: &Path,
    state: &AppState,
    session_id: &str,
    session: &OpenSession,
    candidate: &[u8],
) -> Result<safe_write::WriteOutcome, CommandError> {
    match safe_write::write_atomically(&session.path, candidate, &session.revision, data_root) {
        Ok(outcome) => Ok(outcome),
        Err(error)
            if matches!(
                error.code,
                "post_commit_conflict" | "post_commit_unverified"
            ) =>
        {
            let refresh_status = match refresh_or_expire_session(state, session_id, session) {
                Ok(revision) => format!("session refreshed to on-disk revision {revision}"),
                Err(refresh_error) => {
                    format!(
                        "session expired because refresh failed: {}",
                        refresh_error.message
                    )
                }
            };
            Err(CommandError::new(
                error.code,
                format!("{}; {refresh_status}", error.message),
            ))
        }
        Err(error) => Err(error),
    }
}

fn open_session(state: &AppState, session_id: &str) -> Result<OpenSession, CommandError> {
    require_canonical_uuid(session_id, "invalid_session_id", "session id")?;
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .get(session_id)
        .cloned()
        .ok_or_else(|| CommandError::new("unknown_session", "configuration session has expired"))
}

fn replace_open_session(
    state: &AppState,
    session_id: &str,
    previous: &OpenSession,
    bytes: Vec<u8>,
    document: ConfigDocument,
) -> Result<String, CommandError> {
    let revision = safe_write::revision(&bytes);
    state
        .sessions
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "session state is unavailable"))?
        .insert(
            session_id.to_string(),
            OpenSession {
                candidate_id: previous.candidate_id.clone(),
                path: previous.path.clone(),
                revision: revision.clone(),
                read_only: previous.read_only,
                original_bytes: bytes,
                document,
            },
        );
    clear_stages_for_session(state, session_id)?;
    Ok(revision)
}

fn refresh_session_after_verified_write(
    state: &AppState,
    session_id: &str,
    previous: &OpenSession,
    expected_revision: &str,
) -> Result<String, CommandError> {
    let bytes = match safe_write::read_regular_target_file(&previous.path) {
        Ok(bytes) => bytes,
        Err(error) => {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(session_id);
            }
            let _ = clear_stages_for_session(state, session_id);
            return Err(CommandError::new(
                "post_validation_unverified",
                format!(
                    "the write passed Ghostty validation, but the target could not be read back; editing was stopped: {}",
                    error.message
                ),
            ));
        }
    };
    let actual_revision = safe_write::revision(&bytes);
    let document = match ConfigDocument::parse(&bytes) {
        Ok(document) => document,
        Err(error) => {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(session_id);
            }
            let _ = clear_stages_for_session(state, session_id);
            return Err(CommandError::new(
                "post_validation_unverified",
                format!(
                    "the write passed Ghostty validation, but the final target could not be parsed; editing was stopped: {}",
                    error.message
                ),
            ));
        }
    };
    let refreshed_revision = replace_open_session(state, session_id, previous, bytes, document)?;
    if actual_revision != expected_revision {
        return Err(CommandError::new(
            "post_validation_conflict",
            format!(
                "the configuration changed in another program while Ghostty Studio was completing validation; the external edit was kept and the session was refreshed to revision {refreshed_revision}"
            ),
        ));
    }
    Ok(refreshed_revision)
}

fn refresh_or_expire_session(
    state: &AppState,
    session_id: &str,
    previous: &OpenSession,
) -> Result<String, CommandError> {
    let refreshed = safe_write::read_regular_target_file(&previous.path)
        .and_then(|bytes| ConfigDocument::parse(&bytes).map(|document| (bytes, document)));
    match refreshed {
        Ok((bytes, document)) => replace_open_session(state, session_id, previous, bytes, document),
        Err(error) => {
            if let Ok(mut sessions) = state.sessions.lock() {
                sessions.remove(session_id);
            }
            let _ = clear_stages_for_session(state, session_id);
            Err(error)
        }
    }
}

fn clear_stages_for_session(state: &AppState, session_id: &str) -> Result<(), CommandError> {
    state
        .stages
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
        .retain(|_, stage| stage.session_id != session_id);
    Ok(())
}

fn require_canonical_uuid(
    value: &str,
    error_code: &'static str,
    label: &str,
) -> Result<(), CommandError> {
    if value.len() > 64 {
        return Err(CommandError::new(
            error_code,
            format!("{label} must be a canonical UUID"),
        ));
    }
    let parsed = Uuid::parse_str(value)
        .map_err(|_| CommandError::new(error_code, format!("{label} must be a canonical UUID")))?;
    if parsed.hyphenated().to_string() != value {
        return Err(CommandError::new(
            error_code,
            format!("{label} must be a canonical UUID"),
        ));
    }
    Ok(())
}

fn require_revision(value: &str) -> Result<(), CommandError> {
    if value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit()) {
        Ok(())
    } else {
        Err(CommandError::new(
            "invalid_revision",
            "revision must be a 64-character SHA-256 digest",
        ))
    }
}

fn diagnostic_summary(diagnostics: &[String]) -> String {
    let summary = diagnostics
        .iter()
        .take(3)
        .map(String::as_str)
        .collect::<Vec<_>>()
        .join(" | ");
    if summary.is_empty() {
        "no diagnostic details were returned".to_string()
    } else {
        summary
    }
}

#[cfg(test)]
fn editable_scalar_keys(state: &AppState) -> Result<HashSet<String>, CommandError> {
    let schema = state
        .runtime_schema
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))?;
    let schema = schema.as_ref().ok_or_else(|| {
        CommandError::new(
            "schema_not_loaded",
            "the runtime schema must be loaded before configuration values can be exposed or edited",
        )
    })?;
    Ok(editable_keys_from_schema(schema))
}

fn current_runtime_contract(state: &AppState) -> Result<CurrentRuntimeContract, CommandError> {
    let runtime = ghostty::resolve()?;
    let ghostty_version = runtime.version.clone();
    let fresh_schema = schema::load(
        &runtime.identity,
        runtime.version.clone(),
        runtime.channel.clone(),
    )?;
    let (writable_options, changed_writable_keys) = install_runtime_schema(state, fresh_schema)?;
    if writable_options.is_empty() {
        return Err(CommandError::new(
            "ghostty_contract_read_only",
            format!(
                "the current Ghostty runtime does not match {}",
                runtime_contract::AUDITED_CONTRACT_ID
            ),
        ));
    }
    let editable_keys = writable_options.keys().cloned().collect();
    let editable_options = writable_options
        .iter()
        .filter(|(_, option)| option.editable && option.capability.edit_mode == "control")
        .map(|(key, option)| (key.clone(), option.clone()))
        .collect();
    Ok(CurrentRuntimeContract {
        executable: runtime.identity,
        ghostty_version,
        editable_keys,
        editable_options,
        writable_options,
        changed_writable_keys,
    })
}

fn install_runtime_schema(
    state: &AppState,
    fresh_schema: RuntimeSchema,
) -> Result<(BTreeMap<String, RuntimeOption>, HashSet<String>), CommandError> {
    let mut cached_schema = state
        .runtime_schema
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))?;
    let changed_writable_keys =
        runtime_contract::changed_writable_keys(cached_schema.as_ref(), &fresh_schema);
    let writable_options = runtime_contract::writable_options(&fresh_schema);
    *cached_schema = Some(fresh_schema);
    drop(cached_schema);
    if !changed_writable_keys.is_empty() {
        state
            .stages
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
            .retain(|_, stage| {
                !stage
                    .changes
                    .iter()
                    .any(|change| changed_writable_keys.contains(&change.key))
            });
    }
    Ok((writable_options, changed_writable_keys))
}

fn require_unchanged_review_contract(
    changes: &[DraftChange],
    changed_writable_keys: &HashSet<String>,
) -> Result<(), CommandError> {
    if changes
        .iter()
        .any(|change| changed_writable_keys.contains(&change.key))
    {
        return Err(CommandError::new(
            "ghostty_contract_changed",
            "a reviewed Ghostty setting changed while the application was open; review it again before saving",
        ));
    }
    Ok(())
}

fn require_review_contract(
    stage: &StagedCandidate,
    current: &CurrentRuntimeContract,
) -> Result<(), CommandError> {
    if runtime_contract::review_contract_matches(&stage.review_contract, &current.writable_options)
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "ghostty_contract_changed",
            "the Ghostty contract used for this review is no longer current; review the changes again",
        ))
    }
}

fn require_same_runtime_identity(
    reviewed: &ghostty::ExecutableIdentity,
    current: &ghostty::ExecutableIdentity,
) -> Result<(), CommandError> {
    if reviewed != current {
        return Err(CommandError::new(
            "ghostty_runtime_changed",
            "the installed Ghostty executable changed; review the operation again",
        ));
    }
    current.verify()
}

fn is_public_setting_key(key: &str) -> bool {
    !key.is_empty()
        && key.len() <= 128
        && key
            .bytes()
            .all(|byte| byte.is_ascii_lowercase() || byte.is_ascii_digit() || byte == b'-')
}

#[cfg(test)]
fn editable_keys_from_schema(schema: &RuntimeSchema) -> HashSet<String> {
    editable_options_from_schema(schema).into_keys().collect()
}

fn editable_options_from_schema(schema: &RuntimeSchema) -> HashMap<String, RuntimeOption> {
    schema
        .options
        .iter()
        .filter(|option| {
            option.editable
                && option.capability.edit_mode == "control"
                && !option.repeatable
                && option.risk == "normal"
        })
        .map(|option| (option.key.clone(), option.clone()))
        .collect()
}

fn public_scalar_values(option: &RuntimeOption, values: &[String]) -> Option<Vec<String>> {
    match values {
        [] => Some(Vec::new()),
        [value] if !value.is_empty() && validate_setting_value(option, value).is_ok() => {
            Some(vec![value.clone()])
        }
        _ => None,
    }
}

fn require_unique_draft_keys(changes: &[DraftChange]) -> Result<(), CommandError> {
    let mut keys = HashSet::with_capacity(changes.len());
    if changes
        .iter()
        .all(|change| keys.insert(change.key.as_str()))
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "duplicate_change_key",
            "a reviewed change set may contain each setting only once",
        ))
    }
}

fn validate_setting_value(option: &RuntimeOption, value: &str) -> Result<(), CommandError> {
    if !is_public_setting_key(&option.key)
        || !option.editable
        || option.capability.edit_mode != "control"
        || option.repeatable
        || option.risk != "normal"
    {
        return Err(CommandError::new(
            "setting_requires_specialized_editor",
            "this setting is not eligible for the generic scalar editor",
        ));
    }
    if value.is_empty() || value.len() > 128 || value.chars().any(char::is_control) {
        return Err(CommandError::new(
            "invalid_setting_value",
            format!("{} has an unsupported scalar value", option.key),
        ));
    }

    let numeric_value = match option.kind.as_str() {
        "boolean" => {
            if !matches!(value, "true" | "false") {
                return Err(CommandError::new(
                    "invalid_setting_value",
                    format!("{} expects true or false", option.key),
                ));
            }
            None
        }
        "integer" => Some(
            value
                .parse::<i64>()
                .map(|number| number as f64)
                .map_err(|_| {
                    CommandError::new(
                        "invalid_setting_value",
                        format!("{} expects a whole number", option.key),
                    )
                })?,
        ),
        "number" => Some(value.parse::<f64>().map_err(|_| {
            CommandError::new(
                "invalid_setting_value",
                format!("{} expects a number", option.key),
            )
        })?),
        "select" => {
            if option.choices.is_empty() || !option.choices.iter().any(|choice| choice == value) {
                return Err(CommandError::new(
                    "invalid_setting_value",
                    format!("{} is not one of the supported choices", option.key),
                ));
            }
            None
        }
        "color" => {
            let color = value.strip_prefix('#').unwrap_or(value);
            if color.len() != 6 || !color.bytes().all(|byte| byte.is_ascii_hexdigit()) {
                return Err(CommandError::new(
                    "invalid_setting_value",
                    format!("{} expects a six-digit hexadecimal color", option.key),
                ));
            }
            None
        }
        _ => {
            return Err(CommandError::new(
                "setting_requires_specialized_editor",
                "this setting kind is not supported by the generic scalar editor",
            ));
        }
    };

    if let Some(number) = numeric_value {
        if !number.is_finite() {
            return Err(CommandError::new(
                "invalid_setting_value",
                format!("{} expects a finite number", option.key),
            ));
        }
        if option
            .capability
            .min
            .is_some_and(|minimum| number < minimum)
            || option
                .capability
                .max
                .is_some_and(|maximum| number > maximum)
        {
            return Err(CommandError::new(
                "value_out_of_range",
                format!("{} is outside its supported range", option.key),
            ));
        }
    }
    Ok(())
}

fn activation_for_changes(
    changes: &[DraftChange],
    options: &HashMap<String, RuntimeOption>,
) -> String {
    let keys = changes.iter().map(|change| &change.key).collect::<Vec<_>>();
    activation_for_key_refs(&keys, options)
}

fn activation_for_keys(keys: &[String], options: &HashMap<String, RuntimeOption>) -> String {
    let keys = keys.iter().collect::<Vec<_>>();
    activation_for_key_refs(&keys, options)
}

fn activation_for_key_refs(keys: &[&String], options: &HashMap<String, RuntimeOption>) -> String {
    keys.iter()
        .filter_map(|key| options.get(key.as_str()))
        .map(|option| option.capability.activation.as_str())
        .max_by_key(|activation| match *activation {
            "restart" => 4,
            "unknown" => 3,
            "reload-new-terminal" => 2,
            "reload" => 1,
            _ => 0,
        })
        .unwrap_or("reload")
        .to_string()
}

fn require_current_change_keys(
    changes: &[DraftChange],
    editable_keys: &HashSet<String>,
) -> Result<(), CommandError> {
    if changes
        .iter()
        .all(|change| editable_keys.contains(&change.key))
    {
        Ok(())
    } else {
        Err(CommandError::new(
            "ghostty_contract_changed",
            "one or more reviewed settings are no longer writable under the current Ghostty contract",
        ))
    }
}

fn acquire_mutation(state: &AppState) -> Result<MutationGuard<'_>, CommandError> {
    state
        .mutation_in_flight
        .compare_exchange(false, true, Ordering::Acquire, Ordering::Relaxed)
        .map_err(|_| {
            CommandError::new(
                "mutation_in_progress",
                "another Open, Create, Stage, Apply, or Restore transition is already active",
            )
        })?;
    Ok(MutationGuard(&state.mutation_in_flight))
}

fn lock_asset_store(state: &AppState) -> Result<MutexGuard<'_, ()>, CommandError> {
    state.asset_store.lock().map_err(|_| {
        CommandError::new(
            "background_store_unavailable",
            "the private background image store is unavailable",
        )
    })
}

fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            "app_data_unavailable",
            format!("cannot resolve the private application data directory: {error}"),
        )
    })
}

fn display_path(path: &Path) -> String {
    if let Some(home) = std::env::var_os("HOME").map(PathBuf::from) {
        if let Ok(relative) = path.strip_prefix(home) {
            if relative.as_os_str().is_empty() {
                return "~".to_string();
            }
            return format!("~/{}", relative.to_string_lossy());
        }
    }
    path.to_string_lossy().to_string()
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
enum UiLocale {
    ZhCn,
    En,
}

impl UiLocale {
    fn parse(value: &str) -> Result<Self, CommandError> {
        match value {
            "zh-CN" => Ok(Self::ZhCn),
            "en" => Ok(Self::En),
            _ => Err(CommandError::new(
                "invalid_locale",
                "interface locale must be zh-CN or en",
            )),
        }
    }
}

async fn require_native_confirmation(
    app: &tauri::AppHandle,
    message: String,
    confirm_label: String,
    cancel_label: String,
) -> Result<(), CommandError> {
    let app = app.clone();
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title(confirm_label.clone())
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                confirm_label,
                cancel_label,
            ))
            .blocking_show()
    })
    .await
    .map_err(|error| {
        CommandError::new(
            "native_confirmation_failed",
            format!("无法打开系统确认窗口：{error}"),
        )
    })?;
    if confirmed {
        Ok(())
    } else {
        Err(CommandError::new(
            "native_confirmation_cancelled",
            "已取消操作。",
        ))
    }
}

fn public_review_changes(
    changes: &[DraftChange],
    options: &BTreeMap<String, RuntimeOption>,
) -> Result<Vec<DraftChange>, CommandError> {
    changes
        .iter()
        .map(|change| {
            let option = options.get(&change.key).ok_or_else(|| {
                CommandError::new(
                    "review_projection_failed",
                    "a reviewed setting is not present in the audited runtime contract",
                )
            })?;
            let (before, after) = if change.key == BACKGROUND_IMAGE_KEY {
                (
                    public_background_change_values(&change.before),
                    public_background_change_values(&change.after),
                )
            } else {
                (
                    public_scalar_values(option, &change.before),
                    public_scalar_values(option, &change.after),
                )
            };
            let (Some(before), Some(after)) = (before, after) else {
                return Err(CommandError::new(
                    "review_projection_failed",
                    "a reviewed value cannot cross the application boundary safely",
                ));
            };
            Ok(DraftChange {
                key: change.key.clone(),
                before,
                after,
            })
        })
        .collect()
}

fn public_background_change_values(values: &[String]) -> Option<Vec<String>> {
    match values {
        [] => Some(Vec::new()),
        [value] if value.is_empty() => Some(Vec::new()),
        [value] if value == RESET_BACKGROUND_TOKEN || value == EXTERNAL_BACKGROUND_TOKEN => {
            Some(vec![value.clone()])
        }
        [value] => {
            let asset_id = value.strip_prefix(MANAGED_BACKGROUND_PREFIX)?;
            if asset_id.len() == 64
                && asset_id
                    .bytes()
                    .all(|byte| byte.is_ascii_digit() || matches!(byte, b'a'..=b'f'))
            {
                Some(vec![value.clone()])
            } else {
                None
            }
        }
        _ => None,
    }
}

fn render_setting_diff(changes: &[DraftChange]) -> String {
    changes
        .iter()
        .flat_map(|change| {
            [
                format!(
                    "-{} = {}",
                    change.key,
                    public_diff_values(&change.key, &change.before)
                ),
                format!(
                    "+{} = {}",
                    change.key,
                    public_diff_values(&change.key, &change.after)
                ),
            ]
        })
        .collect::<Vec<_>>()
        .join("\n")
}

fn public_diff_values(key: &str, values: &[String]) -> String {
    if key != BACKGROUND_IMAGE_KEY {
        return if values.is_empty() {
            "[not set]".to_string()
        } else {
            values.join(", ")
        };
    }
    match values.last().map(String::as_str) {
        None | Some("") => "[not set]".to_string(),
        Some(RESET_BACKGROUND_TOKEN) => "[reset to default]".to_string(),
        Some(EXTERNAL_BACKGROUND_TOKEN) => "[external image path hidden]".to_string(),
        Some(value) if value.starts_with(MANAGED_BACKGROUND_PREFIX) => {
            "[managed image]".to_string()
        }
        Some(_) => "[image value hidden]".to_string(),
    }
}

fn native_change_summary(changes: &[DraftChange], locale: UiLocale) -> String {
    const MAX_CHANGES: usize = 10;
    const MAX_FIELD_CHARS: usize = 48;
    let mut rows = changes
        .iter()
        .take(MAX_CHANGES)
        .map(|change| {
            let key = bounded_text(&change.key, MAX_FIELD_CHARS);
            let before = bounded_text(
                &native_change_value(&change.key, &change.before, locale),
                MAX_FIELD_CHARS,
            );
            let after = bounded_text(
                &native_change_value(&change.key, &change.after, locale),
                MAX_FIELD_CHARS,
            );
            format!("• {key}: {before} → {after}")
        })
        .collect::<Vec<_>>();
    if changes.len() > MAX_CHANGES {
        rows.push(match locale {
            UiLocale::ZhCn => format!("… 另有 {} 项", changes.len() - MAX_CHANGES),
            UiLocale::En => format!("… and {} more", changes.len() - MAX_CHANGES),
        });
    }
    rows.join("\n")
}

fn native_change_value(key: &str, values: &[String], locale: UiLocale) -> String {
    if key != BACKGROUND_IMAGE_KEY {
        return if values.is_empty() {
            match locale {
                UiLocale::ZhCn => "未设置".to_string(),
                UiLocale::En => "Not set".to_string(),
            }
        } else {
            values.join(", ")
        };
    }
    match values.last().map(String::as_str) {
        None | Some("") => match locale {
            UiLocale::ZhCn => "未设置".to_string(),
            UiLocale::En => "Not set".to_string(),
        },
        Some(RESET_BACKGROUND_TOKEN) => match locale {
            UiLocale::ZhCn => "恢复默认".to_string(),
            UiLocale::En => "Reset to default".to_string(),
        },
        Some(EXTERNAL_BACKGROUND_TOKEN) => match locale {
            UiLocale::ZhCn => "外部图片（路径已隐藏）".to_string(),
            UiLocale::En => "External image (path hidden)".to_string(),
        },
        Some(value) if value.starts_with(MANAGED_BACKGROUND_PREFIX) => match locale {
            UiLocale::ZhCn => "图片库图片".to_string(),
            UiLocale::En => "Managed image".to_string(),
        },
        Some(_) => match locale {
            UiLocale::ZhCn => "图片值已隐藏".to_string(),
            UiLocale::En => "Image value hidden".to_string(),
        },
    }
}

fn bounded_text(value: &str, maximum_chars: usize) -> String {
    let mut characters = value.chars();
    let prefix = characters.by_ref().take(maximum_chars).collect::<String>();
    if characters.next().is_some() {
        format!("{prefix}…")
    } else {
        prefix
    }
}

fn native_key_summary(keys: &[String], locale: UiLocale) -> String {
    const MAX_KEYS: usize = 10;
    let mut visible = keys
        .iter()
        .take(MAX_KEYS)
        .map(|key| bounded_text(key, 48))
        .collect::<Vec<_>>();
    if keys.len() > MAX_KEYS {
        visible.push(match locale {
            UiLocale::ZhCn => format!("另有 {} 项", keys.len() - MAX_KEYS),
            UiLocale::En => format!("{} more", keys.len() - MAX_KEYS),
        });
    }
    if visible.is_empty() {
        match locale {
            UiLocale::ZhCn => "无".to_string(),
            UiLocale::En => "None".to_string(),
        }
    } else {
        visible.join(match locale {
            UiLocale::ZhCn => "、",
            UiLocale::En => ", ",
        })
    }
}

fn format_utc_timestamp(milliseconds: u64) -> String {
    const MAX_SUPPORTED_SECONDS: u64 = 253_402_300_799;
    let seconds = milliseconds / 1_000;
    if seconds > MAX_SUPPORTED_SECONDS {
        return "timestamp unavailable".to_string();
    }
    let days = (seconds / 86_400) as i64;
    let seconds_of_day = seconds % 86_400;
    let hour = seconds_of_day / 3_600;
    let minute = (seconds_of_day % 3_600) / 60;
    let (year, month, day) = civil_date_from_unix_days(days);
    format!("{year:04}-{month:02}-{day:02} {hour:02}:{minute:02} UTC")
}

fn civil_date_from_unix_days(days: i64) -> (i64, i64, i64) {
    let shifted = days + 719_468;
    let era = if shifted >= 0 {
        shifted
    } else {
        shifted - 146_096
    } / 146_097;
    let day_of_era = shifted - era * 146_097;
    let year_of_era =
        (day_of_era - day_of_era / 1_460 + day_of_era / 36_524 - day_of_era / 146_096) / 365;
    let mut year = year_of_era + era * 400;
    let day_of_year = day_of_era - (365 * year_of_era + year_of_era / 4 - year_of_era / 100);
    let month_position = (5 * day_of_year + 2) / 153;
    let day = day_of_year - (153 * month_position + 2) / 5 + 1;
    let month = month_position + if month_position < 10 { 3 } else { -9 };
    year += i64::from(month <= 2);
    (year, month, day)
}

fn public_background_values(state: models::BackgroundImageState) -> Vec<String> {
    match (state.kind.as_str(), state.asset_id) {
        ("managed", Some(asset_id)) => {
            vec![format!("{MANAGED_BACKGROUND_PREFIX}{asset_id}")]
        }
        ("external", _) => vec![EXTERNAL_BACKGROUND_TOKEN.to_string()],
        _ => Vec::new(),
    }
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_dialog::init())
        .manage(AppState::default())
        .setup(|app| {
            tauri::WebviewWindowBuilder::new(
                app,
                "main",
                tauri::WebviewUrl::App("index.html".into()),
            )
            .title("Ghostty Studio")
            .inner_size(1180.0, 780.0)
            .min_inner_size(780.0, 560.0)
            .resizable(true)
            .center()
            .general_autofill_enabled(false)
            .zoom_hotkeys_enabled(false)
            .on_navigation(allowed_navigation)
            .on_new_window(|_, _| tauri::webview::NewWindowResponse::Deny)
            .on_download(|_, _| false)
            .build()?;
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            probe_environment,
            load_runtime_schema,
            load_config_graph,
            list_background_assets,
            choose_background_images,
            get_background_asset_preview,
            delete_background_asset,
            open_config,
            create_config,
            stage_changes,
            apply_changes,
            list_snapshots,
            restore_snapshot,
        ])
        .run(tauri::generate_context!())
        .expect("error while running Ghostty Studio");
}

fn allowed_navigation(url: &tauri::Url) -> bool {
    if url.scheme() == "tauri" {
        return url.host_str() == Some("localhost");
    }
    cfg!(debug_assertions)
        && url.scheme() == "http"
        && matches!(url.host_str(), Some("127.0.0.1") | Some("localhost"))
        && url.port() == Some(1420)
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn test_executable_identity() -> ghostty::ExecutableIdentity {
        static IDENTITY: std::sync::OnceLock<ghostty::ExecutableIdentity> =
            std::sync::OnceLock::new();
        IDENTITY
            .get_or_init(|| {
                ghostty::ExecutableIdentity::capture(
                    &std::env::current_exe().expect("test executable path"),
                )
                .expect("test executable identity")
            })
            .clone()
    }

    #[test]
    fn native_dialog_locale_is_a_closed_enum() {
        assert_eq!(UiLocale::parse("zh-CN").unwrap(), UiLocale::ZhCn);
        assert_eq!(UiLocale::parse("en").unwrap(), UiLocale::En);
        let error = UiLocale::parse("en-US").unwrap_err();
        assert_eq!(error.code, "invalid_locale");
    }

    fn test_capability(
        edit_mode: &str,
        reason: Option<&str>,
        minimum: Option<f64>,
        maximum: Option<f64>,
    ) -> models::RuntimeCapability {
        models::RuntimeCapability {
            edit_mode: edit_mode.to_string(),
            reason: reason.map(str::to_string),
            activation: "reload".to_string(),
            constraint_behavior: "reject".to_string(),
            min: minimum,
            max: maximum,
            step: (minimum.is_some() || maximum.is_some()).then_some(1.0),
            unit: None,
            platform: None,
        }
    }

    fn test_runtime_option(key: &str) -> models::RuntimeOption {
        models::RuntimeOption {
            key: key.to_string(),
            description: String::new(),
            default_values: vec!["13".to_string()],
            current_values: vec!["13".to_string()],
            category: "font".to_string(),
            kind: "number".to_string(),
            choices: Vec::new(),
            repeatable: false,
            platform: None,
            since: None,
            risk: "normal".to_string(),
            editable: true,
            capability: test_capability("control", None, Some(1.0), Some(255.0)),
        }
    }

    #[test]
    fn final_value_comparison_normalizes_audited_scalar_kinds() {
        let number = test_runtime_option("font-size");
        assert!(scalar_values_match(&number, "14", "14.0"));

        let mut boolean = test_runtime_option("background-image-repeat");
        boolean.kind = "boolean".to_string();
        assert!(scalar_values_match(&boolean, "true", "TRUE"));

        let mut color = test_runtime_option("background");
        color.kind = "color".to_string();
        assert!(scalar_values_match(&color, "#Aa00Ff", "aa00ff"));

        let mut text = test_runtime_option("font-family");
        text.kind = "text".to_string();
        assert!(scalar_values_match(
            &text,
            "JetBrains Mono",
            "\"JetBrains Mono\""
        ));
        assert!(!scalar_values_match(&text, "JetBrains Mono", "Menlo"));
    }

    #[test]
    fn every_registered_command_has_a_manifest_and_capability_permission() {
        let source = include_str!("lib.rs");
        let handler = source
            .split_once(".invoke_handler(tauri::generate_handler![")
            .and_then(|(_, remainder)| remainder.split_once("])"))
            .map(|(commands, _)| commands)
            .expect("invoke handler command list should remain discoverable");
        let build_script = include_str!("../build.rs");
        let capability = include_str!("../capabilities/main.json");
        let permission_root =
            std::path::Path::new(env!("CARGO_MANIFEST_DIR")).join("permissions/autogenerated");

        for command in handler
            .split(',')
            .map(str::trim)
            .filter(|command| !command.is_empty())
        {
            assert!(
                build_script.contains(&format!("\"{command}\"")),
                "{command} is registered with Tauri but missing from build.rs COMMANDS"
            );

            let permission_name = format!("allow-{}", command.replace('_', "-"));
            assert!(
                capability.contains(&format!("\"{permission_name}\"")),
                "{command} is registered with Tauri but missing from the main capability"
            );

            let permission_path = permission_root.join(format!("{command}.toml"));
            let permission = fs::read_to_string(&permission_path).unwrap_or_else(|error| {
                panic!(
                    "{} has no generated permission file at {}: {error}",
                    command,
                    permission_path.display()
                )
            });
            assert!(
                permission.contains(&format!("commands.allow = [\"{command}\"]")),
                "{} does not allow {command}",
                permission_path.display()
            );
        }
    }

    #[test]
    fn navigation_allowlist_rejects_unexpected_origins() {
        assert!(allowed_navigation(
            &tauri::Url::parse("tauri://localhost/index.html").unwrap()
        ));
        assert!(!allowed_navigation(
            &tauri::Url::parse("tauri://unexpected/index.html").unwrap()
        ));
        assert!(!allowed_navigation(
            &tauri::Url::parse("https://example.com/").unwrap()
        ));
    }

    #[test]
    fn mutation_guard_serializes_native_confirmations() {
        let state = AppState::default();
        let guard = acquire_mutation(&state).unwrap();
        assert_eq!(
            acquire_mutation(&state).unwrap_err().code,
            "mutation_in_progress"
        );
        assert_eq!(
            acquire_mutation(&state).unwrap_err().code,
            "mutation_in_progress"
        );
        drop(guard);
        assert!(acquire_mutation(&state).is_ok());
    }

    #[cfg(unix)]
    #[test]
    fn reviewed_runtime_identity_rejects_a_different_executable() {
        use std::os::unix::fs::PermissionsExt;

        let reviewed = test_executable_identity();
        assert!(require_same_runtime_identity(&reviewed, &reviewed).is_ok());

        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("other-ghostty");
        fs::write(&path, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        let current = ghostty::ExecutableIdentity::capture(&path).unwrap();
        assert_eq!(
            require_same_runtime_identity(&reviewed, &current)
                .unwrap_err()
                .code,
            "ghostty_runtime_changed"
        );
    }

    #[test]
    fn creation_requires_exactly_one_matching_default_layer_after_commit() {
        fn candidate(id: &str, path: &str, exists: bool) -> ConfigCandidate {
            ConfigCandidate {
                id: id.to_string(),
                label: id.to_string(),
                path: path.to_string(),
                source: "xdg".to_string(),
                format: "legacy".to_string(),
                priority: 0,
                exists,
                writable: true,
                symlink: false,
                size_bytes: exists.then_some(0),
            }
        }

        let selected = candidate("selected", "/home/user/.config/ghostty/config", true);
        let missing = candidate("missing", "/home/user/Library/ghostty/config", false);
        let candidates = vec![selected.clone(), missing];
        assert_eq!(
            require_unique_created_candidate(&candidates, &selected.id, &selected.path)
                .unwrap()
                .id,
            selected.id
        );

        let error =
            require_unique_created_candidate(&[], &selected.id, &selected.path).unwrap_err();
        assert_eq!(error.code, "post_creation_unverified");

        let competing = candidate("competing", "/home/user/Library/ghostty/config", true);
        let error = require_unique_created_candidate(
            &[selected.clone(), competing],
            &selected.id,
            &selected.path,
        )
        .unwrap_err();
        assert_eq!(error.code, "post_creation_conflict");

        let error = require_unique_created_candidate(
            &[candidate(
                "other",
                "/home/user/.config/ghostty/config.ghostty",
                true,
            )],
            &selected.id,
            &selected.path,
        )
        .unwrap_err();
        assert_eq!(error.code, "post_creation_conflict");
    }

    #[test]
    fn renderer_candidate_projection_never_contains_local_paths() {
        let internal = ConfigCandidate {
            id: "opaque-id".to_string(),
            label: "Include · private-alice.conf".to_string(),
            path: "/Users/alice/secret/private-alice.conf".to_string(),
            source: "include".to_string(),
            format: "legacy".to_string(),
            priority: 7,
            exists: true,
            writable: true,
            symlink: false,
            size_bytes: Some(42),
        };
        let serialized = serde_json::to_string(&public_candidate(&internal, false)).unwrap();
        assert!(!serialized.contains("/Users"));
        assert!(!serialized.contains("alice"));
        assert!(!serialized.contains("private-alice"));
        assert!(serialized.contains("Include · layer 4"));
        assert!(serialized.contains("\"creationEligible\":false"));
    }

    #[test]
    fn renderer_graph_projection_replaces_paths_and_raw_diagnostics() {
        let private_path = "/Users/alice/secret/private.conf";
        let graph = config_graph::ConfigGraph {
            graph_revision: "revision".to_string(),
            complete: false,
            semantics_known: false,
            nodes: vec![config_graph::ConfigNode {
                id: "node-private".to_string(),
                path: private_path.to_string(),
                load_index: 0,
                depth: 0,
                assignment_count: 1,
                symlink: false,
                content_revision: "private-revision".to_string(),
            }],
            edges: vec![config_graph::ConfigEdge {
                from_id: "node-private".to_string(),
                to_id: None,
                declared_path: private_path.to_string(),
                line: 2,
                optional: false,
                status: "missing".to_string(),
            }],
            provenance: vec![config_graph::ProvenanceEntry {
                key: "font-size".to_string(),
                source_id: "node-private".to_string(),
                source_path: private_path.to_string(),
                line: 1,
                load_index: 0,
            }],
            diagnostics: vec![config_graph::GraphDiagnostic {
                code: "config_read_failed".to_string(),
                message: format!("failed to read {private_path}"),
                path: Some(private_path.to_string()),
                line: None,
            }],
            total_bytes: 0,
        };

        let serialized = serde_json::to_string(&public_config_graph(graph)).unwrap();
        assert!(!serialized.contains("/Users"));
        assert!(!serialized.contains("alice"));
        assert!(!serialized.contains("private.conf"));
        assert!(serialized.contains("配置层 1"));
        assert!(serialized.contains("未公开的 include 路径"));
    }

    #[test]
    fn runtime_contract_change_invalidates_reviews_fail_closed() {
        let state = AppState::default();
        let original = test_runtime_option("font-size");
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("1.3.1".to_string()),
            schema_hash: "old-schema".to_string(),
            diagnostics: Vec::new(),
            options: vec![original.clone()],
        });
        insert_stage(&state, "session", &"0".repeat(64));

        let mut changed = original;
        changed.capability.max = Some(300.0);

        let (editable, changed_keys) = install_runtime_schema(
            &state,
            RuntimeSchema {
                ghostty_version: Some("1.3.2".to_string()),
                schema_hash: "new-schema".to_string(),
                diagnostics: Vec::new(),
                options: vec![changed],
            },
        )
        .unwrap();

        assert!(editable.contains_key("font-size"));
        assert!(changed_keys.contains("font-size"));
        assert_eq!(
            require_unchanged_review_contract(
                &[DraftChange {
                    key: "font-size".to_string(),
                    before: vec!["14".to_string()],
                    after: vec!["15".to_string()],
                }],
                &changed_keys,
            )
            .unwrap_err()
            .code,
            "ghostty_contract_changed"
        );
        assert!(state.stages.lock().unwrap().is_empty());
        assert_eq!(
            state
                .runtime_schema
                .lock()
                .unwrap()
                .as_ref()
                .unwrap()
                .schema_hash,
            "new-schema"
        );
    }

    #[test]
    fn unrelated_schema_changes_keep_existing_reviews() {
        let state = AppState::default();
        let option = test_runtime_option("font-size");
        let background = test_runtime_option("background-opacity");
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("1.3.1".to_string()),
            schema_hash: "old-schema".to_string(),
            diagnostics: Vec::new(),
            options: vec![option.clone(), background.clone()],
        });
        insert_stage(&state, "session", &"0".repeat(64));

        let mut changed_background = background;
        changed_background.capability.max = Some(0.9);

        let (keys, changed_keys) = install_runtime_schema(
            &state,
            RuntimeSchema {
                ghostty_version: Some("1.3.2".to_string()),
                schema_hash: "new-schema".to_string(),
                diagnostics: vec!["new reference setting".to_string()],
                options: vec![option, changed_background],
            },
        )
        .unwrap();

        assert!(keys.contains_key("font-size"));
        assert!(changed_keys.contains("background-opacity"));
        assert!(!changed_keys.contains("font-size"));
        assert_eq!(state.stages.lock().unwrap().len(), 1);
    }

    #[test]
    fn renderer_scalar_policy_excludes_sensitive_and_repeatable_settings() {
        let state = AppState::default();
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("test".to_string()),
            schema_hash: "test".to_string(),
            diagnostics: Vec::new(),
            options: vec![
                models::RuntimeOption {
                    key: "font-size".to_string(),
                    description: String::new(),
                    default_values: vec!["13".to_string()],
                    current_values: vec!["13".to_string()],
                    category: "font".to_string(),
                    kind: "number".to_string(),
                    choices: Vec::new(),
                    repeatable: false,
                    platform: None,
                    since: None,
                    risk: "normal".to_string(),
                    editable: true,
                    capability: test_capability("control", None, Some(1.0), Some(255.0)),
                },
                models::RuntimeOption {
                    key: "command".to_string(),
                    description: String::new(),
                    default_values: Vec::new(),
                    current_values: Vec::new(),
                    category: "Shell".to_string(),
                    kind: "text".to_string(),
                    choices: Vec::new(),
                    repeatable: false,
                    platform: None,
                    since: None,
                    risk: "sensitive".to_string(),
                    editable: false,
                    capability: test_capability("none", Some("protected"), None, None),
                },
                models::RuntimeOption {
                    key: "font-family".to_string(),
                    description: String::new(),
                    default_values: Vec::new(),
                    current_values: Vec::new(),
                    category: "font".to_string(),
                    kind: "text".to_string(),
                    choices: Vec::new(),
                    repeatable: true,
                    platform: None,
                    since: None,
                    risk: "normal".to_string(),
                    editable: false,
                    capability: test_capability("none", Some("needs-list-editor"), None, None),
                },
            ],
        });

        let allowed = editable_scalar_keys(&state).unwrap();
        assert!(allowed.contains("font-size"));
        assert!(!allowed.contains("command"));
        assert!(!allowed.contains("font-family"));
    }

    #[test]
    fn session_metadata_never_exposes_unrecognized_names_or_values() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        fs::write(
            &target,
            b"font-size = 14\nbackground = /Users/private/secret-color\nbackground-image = /Users/private/wallpaper.png\n/Users/private/token = should-not-cross-ipc\n",
        )
        .unwrap();

        let state = AppState::default();
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("test".to_string()),
            schema_hash: "test".to_string(),
            diagnostics: Vec::new(),
            options: vec![
                test_runtime_option("font-size"),
                {
                    let mut option = test_runtime_option("background");
                    option.kind = "color".to_string();
                    option.capability.min = None;
                    option.capability.max = None;
                    option
                },
                models::RuntimeOption {
                    key: BACKGROUND_IMAGE_KEY.to_string(),
                    description: String::new(),
                    default_values: Vec::new(),
                    current_values: Vec::new(),
                    category: "appearance".to_string(),
                    kind: "text".to_string(),
                    choices: Vec::new(),
                    repeatable: false,
                    platform: None,
                    since: None,
                    risk: "normal".to_string(),
                    editable: true,
                    capability: test_capability("control", None, None, None),
                },
            ],
        });
        state.candidates.lock().unwrap().insert(
            "candidate".to_string(),
            ConfigCandidate {
                id: "candidate".to_string(),
                label: "Config".to_string(),
                path: target.to_string_lossy().into_owned(),
                source: "test".to_string(),
                format: "legacy".to_string(),
                priority: 0,
                exists: true,
                writable: true,
                symlink: false,
                size_bytes: fs::metadata(&target).ok().map(|metadata| metadata.len()),
            },
        );

        let session = open_config_session("candidate", directory.path(), &state).unwrap();
        assert_eq!(session.unrecognized_setting_count, 1);
        assert_eq!(session.configured_settings.len(), 3);
        assert!(session
            .configured_settings
            .iter()
            .any(|setting| setting.key == "font-size" && setting.value_exposure == "available"));
        assert!(session.configured_settings.iter().any(|setting| {
            setting.key == BACKGROUND_IMAGE_KEY && setting.value_exposure == "protected"
        }));
        assert!(session.configured_settings.iter().any(|setting| {
            setting.key == "background" && setting.value_exposure == "protected"
        }));
        assert!(!session.values.contains_key("background"));
        assert!(!session.values.contains_key(BACKGROUND_IMAGE_KEY));
        let serialized = serde_json::to_string(&session).unwrap();
        assert!(!serialized.contains("/Users/private/token"));
        assert!(!serialized.contains("should-not-cross-ipc"));
        assert!(!serialized.contains("/Users/private/wallpaper.png"));
        assert!(!serialized.contains("/Users/private/secret-color"));
    }

    #[test]
    fn scalar_contract_rejects_invalid_types_and_ranges_before_ghostty_runs() {
        let number = test_runtime_option("font-size");
        assert!(validate_setting_value(&number, "14.5").is_ok());
        assert_eq!(
            validate_setting_value(&number, "NaN").unwrap_err().code,
            "invalid_setting_value"
        );
        assert_eq!(
            validate_setting_value(&number, "300").unwrap_err().code,
            "value_out_of_range"
        );

        let mut boolean = test_runtime_option("mouse-hide-while-typing");
        boolean.kind = "boolean".to_string();
        boolean.capability.min = None;
        boolean.capability.max = None;
        assert!(validate_setting_value(&boolean, "true").is_ok());
        assert_eq!(
            validate_setting_value(&boolean, "yes").unwrap_err().code,
            "invalid_setting_value"
        );

        let mut select = test_runtime_option("cursor-style");
        select.kind = "select".to_string();
        select.choices = vec!["block".to_string(), "bar".to_string()];
        select.capability.min = None;
        select.capability.max = None;
        assert!(validate_setting_value(&select, "bar").is_ok());
        assert_eq!(
            validate_setting_value(&select, "beam").unwrap_err().code,
            "invalid_setting_value"
        );

        let mut color = test_runtime_option("background");
        color.kind = "color".to_string();
        color.capability.min = None;
        color.capability.max = None;
        assert!(validate_setting_value(&color, "#aB12f0").is_ok());
        assert!(validate_setting_value(&color, "aB12f0").is_ok());
        assert_eq!(
            validate_setting_value(&color, "/Users/private/color")
                .unwrap_err()
                .code,
            "invalid_setting_value"
        );
        assert_eq!(
            validate_effective_setting_value(&color, "/Users/private/color")
                .unwrap_err()
                .code,
            "effective_value_mismatch"
        );
        color.default_values = vec![String::new()];
        assert!(validate_effective_setting_value(&color, "").is_ok());

        let mut integer = test_runtime_option("font-thicken-strength");
        integer.kind = "integer".to_string();
        assert!(validate_setting_value(&integer, "12").is_ok());
        assert_eq!(
            validate_setting_value(&integer, "12.5").unwrap_err().code,
            "invalid_setting_value"
        );

        let mut text = test_runtime_option("font-family");
        text.kind = "text".to_string();
        assert_eq!(
            validate_setting_value(&text, "secret").unwrap_err().code,
            "setting_requires_specialized_editor"
        );
    }

    #[test]
    fn public_review_projection_rejects_values_outside_the_audited_editor_contract() {
        let option = test_runtime_option("font-size");
        let options = BTreeMap::from([(option.key.clone(), option)]);
        let secret = "/Users/private/token";
        let error = public_review_changes(
            &[DraftChange {
                key: "font-size".to_string(),
                before: vec![secret.to_string()],
                after: vec!["14".to_string()],
            }],
            &options,
        )
        .unwrap_err();
        assert_eq!(error.code, "review_projection_failed");
        assert!(!error.message.contains(secret));

        let projected = public_review_changes(
            &[DraftChange {
                key: "font-size".to_string(),
                before: vec!["13".to_string()],
                after: vec!["14".to_string()],
            }],
            &options,
        )
        .unwrap();
        assert_eq!(projected[0].before, ["13"]);
        assert_eq!(projected[0].after, ["14"]);
    }

    #[test]
    fn duplicate_draft_keys_are_rejected_before_background_identity_is_selected() {
        let changes = vec![
            DraftChange {
                key: BACKGROUND_IMAGE_KEY.to_string(),
                before: Vec::new(),
                after: vec![RESET_BACKGROUND_TOKEN.to_string()],
            },
            DraftChange {
                key: BACKGROUND_IMAGE_KEY.to_string(),
                before: vec![RESET_BACKGROUND_TOKEN.to_string()],
                after: Vec::new(),
            },
        ];
        assert_eq!(
            require_unique_draft_keys(&changes).unwrap_err().code,
            "duplicate_change_key"
        );
    }

    #[test]
    fn native_review_summaries_are_bounded_and_hide_managed_image_identity() {
        let asset_id = "a".repeat(64);
        let mut changes = vec![DraftChange {
            key: BACKGROUND_IMAGE_KEY.to_string(),
            before: vec![EXTERNAL_BACKGROUND_TOKEN.to_string()],
            after: vec![format!("{MANAGED_BACKGROUND_PREFIX}{asset_id}")],
        }];
        changes.extend((0..10).map(|index| DraftChange {
            key: format!("setting-{index}"),
            before: vec!["1".to_string()],
            after: vec!["2".to_string()],
        }));
        let summary = native_change_summary(&changes, UiLocale::En);
        assert!(summary.contains("External image (path hidden) → Managed image"));
        assert!(summary.contains("… and 1 more"));
        assert!(!summary.contains(&asset_id));
        assert!(!summary.contains(MANAGED_BACKGROUND_PREFIX));
    }

    #[test]
    fn snapshot_confirmation_time_is_stable_utc() {
        assert_eq!(format_utc_timestamp(0), "1970-01-01 00:00 UTC");
        assert_eq!(
            format_utc_timestamp(1_700_000_000_000),
            "2023-11-14 22:13 UTC"
        );
    }

    #[test]
    fn strongest_activation_is_reported_for_a_mixed_draft() {
        let mut reload = test_runtime_option("font-size");
        reload.capability.activation = "reload".to_string();
        let mut next_terminal = test_runtime_option("window-inherit-working-directory");
        next_terminal.capability.activation = "reload-new-terminal".to_string();
        let mut restart = test_runtime_option("background-opacity");
        restart.capability.activation = "restart".to_string();
        let options = [reload, next_terminal, restart]
            .into_iter()
            .map(|option| (option.key.clone(), option))
            .collect();
        let changes = vec![
            DraftChange {
                key: "font-size".to_string(),
                before: vec!["13".to_string()],
                after: vec!["14".to_string()],
            },
            DraftChange {
                key: "background-opacity".to_string(),
                before: vec!["1".to_string()],
                after: vec!["0.9".to_string()],
            },
        ];

        assert_eq!(activation_for_changes(&changes, &options), "restart");
    }

    #[test]
    fn snapshot_restore_policy_rejects_non_audited_changes() {
        let state = AppState::default();
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("test".to_string()),
            schema_hash: "test".to_string(),
            diagnostics: Vec::new(),
            options: vec![models::RuntimeOption {
                key: "font-size".to_string(),
                description: String::new(),
                default_values: vec!["13".to_string()],
                current_values: Vec::new(),
                category: "font".to_string(),
                kind: "number".to_string(),
                choices: Vec::new(),
                repeatable: false,
                platform: None,
                since: None,
                risk: "normal".to_string(),
                editable: true,
                capability: test_capability("control", None, Some(1.0), Some(255.0)),
            }],
        });
        let prepared = |changed_keys: Vec<String>| PreparedSnapshotRestore {
            current_bytes: b"font-size = 14\n".to_vec(),
            restored_bytes: b"font-size = 13\n".to_vec(),
            validation: ghostty::ValidationReport {
                valid: true,
                diagnostics: Vec::new(),
            },
            snapshot: safe_write::SnapshotInfo {
                id: Uuid::new_v4().to_string(),
                created_at_ms: 1,
                revision: "0".repeat(64),
                size_bytes: 15,
            },
            changed_keys,
            runtime_identity: test_executable_identity(),
        };

        let options =
            editable_options_from_schema(state.runtime_schema.lock().unwrap().as_ref().unwrap());
        let editable_keys = options.keys().cloned().collect::<HashSet<_>>();
        assert!(enforce_snapshot_restore_policy(
            &prepared(vec!["font-size".to_string()]),
            &options,
            &editable_keys,
        )
        .is_ok());
        assert_eq!(
            enforce_snapshot_restore_policy(
                &prepared(vec!["command".to_string()]),
                &options,
                &editable_keys,
            )
            .unwrap_err()
            .code,
            "snapshot_requires_specialized_restore"
        );

        let invalid_value = PreparedSnapshotRestore {
            restored_bytes: b"font-size = 999\n".to_vec(),
            ..prepared(vec!["font-size".to_string()])
        };
        assert_eq!(
            enforce_snapshot_restore_policy(&invalid_value, &options, &editable_keys)
                .unwrap_err()
                .code,
            "snapshot_setting_invalid"
        );

        let duplicated = PreparedSnapshotRestore {
            restored_bytes: b"font-size = 13\nfont-size = 14\n".to_vec(),
            ..prepared(vec!["font-size".to_string()])
        };
        assert_eq!(
            enforce_snapshot_restore_policy(&duplicated, &options, &editable_keys)
                .unwrap_err()
                .code,
            "snapshot_requires_specialized_restore"
        );
    }

    #[test]
    fn background_image_reviews_and_diffs_never_expose_paths_or_asset_ids() {
        let asset_id = "a".repeat(64);
        let changes = vec![DraftChange {
            key: BACKGROUND_IMAGE_KEY.to_string(),
            before: vec![EXTERNAL_BACKGROUND_TOKEN.to_string()],
            after: vec![format!("{MANAGED_BACKGROUND_PREFIX}{asset_id}")],
        }];
        let diff = render_setting_diff(&changes);
        assert!(diff.contains("[external image path hidden]"));
        assert!(diff.contains("[managed image]"));
        assert!(!diff.contains(&asset_id));
        assert!(!diff.contains("/Users/"));

        let reset_diff = render_setting_diff(&[DraftChange {
            key: BACKGROUND_IMAGE_KEY.to_string(),
            before: vec![format!("{MANAGED_BACKGROUND_PREFIX}{asset_id}")],
            after: vec![RESET_BACKGROUND_TOKEN.to_string()],
        }]);
        assert!(reset_diff.contains("[reset to default]"));
        assert!(!reset_diff.contains(RESET_BACKGROUND_TOKEN));
        assert!(!reset_diff.contains(&asset_id));
    }

    #[test]
    fn target_bound_snapshot_may_restore_an_external_background_path() {
        let prepared = PreparedSnapshotRestore {
            current_bytes: b"background-image = /private/current.png\n".to_vec(),
            restored_bytes: b"background-image = /Volumes/Photos/old image.jpg\n".to_vec(),
            validation: ghostty::ValidationReport {
                valid: true,
                diagnostics: Vec::new(),
            },
            snapshot: safe_write::SnapshotInfo {
                id: Uuid::new_v4().to_string(),
                created_at_ms: 1,
                revision: "0".repeat(64),
                size_bytes: 52,
            },
            changed_keys: vec![BACKGROUND_IMAGE_KEY.to_string()],
            runtime_identity: test_executable_identity(),
        };
        let editable_keys = HashSet::from([BACKGROUND_IMAGE_KEY.to_string()]);
        assert!(
            enforce_snapshot_restore_policy(&prepared, &HashMap::new(), &editable_keys,).is_ok()
        );
    }

    fn insert_writable_session(state: &AppState, target: &Path, bytes: &[u8]) -> String {
        let session_id = Uuid::new_v4().to_string();
        state.sessions.lock().unwrap().insert(
            session_id.clone(),
            OpenSession {
                candidate_id: format!("candidate-{session_id}"),
                path: target.to_path_buf(),
                revision: safe_write::revision(bytes),
                read_only: false,
                original_bytes: bytes.to_vec(),
                document: ConfigDocument::parse(bytes).unwrap(),
            },
        );
        session_id
    }

    #[cfg(unix)]
    #[test]
    fn runtime_identity_change_after_write_rolls_back_reviewed_bytes() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let data_root = directory.path().join("studio-data");
        let original = b"font-size = 14\n";
        let candidate = b"font-size = 15\n";
        fs::write(&target, original).unwrap();

        let executable = directory.path().join("ghostty");
        fs::write(&executable, b"#!/bin/sh\nexit 0\n").unwrap();
        fs::set_permissions(&executable, fs::Permissions::from_mode(0o700)).unwrap();
        let identity = ghostty::ExecutableIdentity::capture(&executable).unwrap();

        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, original);
        let session = open_session(&state, &session_id).unwrap();
        let outcome =
            safe_write::write_atomically(&target, candidate, &session.revision, &data_root)
                .unwrap();
        fs::write(&executable, b"#!/bin/sh\nexit 1\n").unwrap();

        let error = rollback_if_runtime_changed(
            &identity,
            &data_root,
            &state,
            &session_id,
            &session,
            original,
            &outcome.revision,
        )
        .unwrap_err();
        assert_eq!(error.code, "ghostty_runtime_changed_after_write");
        assert_eq!(fs::read(&target).unwrap(), original);
    }

    fn insert_stage(state: &AppState, session_id: &str, revision: &str) {
        state.stages.lock().unwrap().insert(
            Uuid::new_v4().to_string(),
            StagedCandidate {
                session_id: session_id.to_string(),
                revision: revision.to_string(),
                bytes: b"font-size = 15\n".to_vec(),
                changes: vec![DraftChange {
                    key: "font-size".to_string(),
                    before: vec!["14".to_string()],
                    after: vec!["15".to_string()],
                }],
                diagnostics: Vec::new(),
                valid: true,
                activation: "reload".to_string(),
                background_asset_id: None,
                effect: ChangeEffectPreview {
                    status: "effective".to_string(),
                    affected_keys: Vec::new(),
                    suggested_candidate_id: None,
                    suggested_label: None,
                },
                dependency_revision: "test".to_string(),
                review_contract: BTreeMap::from([(
                    "font-size".to_string(),
                    test_runtime_option("font-size"),
                )]),
                runtime_identity: test_executable_identity(),
            },
        );
    }

    #[test]
    fn removing_a_library_image_invalidates_stale_background_reviews() {
        let state = AppState::default();
        let directory = tempfile::tempdir().unwrap();
        let path = directory.path().join("background.png");
        fs::write(&path, b"image").unwrap();
        let staged_bytes = format!("background-image = {}\n", path.display()).into_bytes();
        state.stages.lock().unwrap().insert(
            Uuid::new_v4().to_string(),
            StagedCandidate {
                session_id: Uuid::new_v4().to_string(),
                revision: "0".repeat(64),
                bytes: staged_bytes,
                changes: Vec::new(),
                diagnostics: Vec::new(),
                valid: true,
                activation: "reload".to_string(),
                background_asset_id: Some("a".repeat(64)),
                effect: ChangeEffectPreview {
                    status: "effective".to_string(),
                    affected_keys: Vec::new(),
                    suggested_candidate_id: None,
                    suggested_label: None,
                },
                dependency_revision: "test".to_string(),
                review_contract: BTreeMap::new(),
                runtime_identity: test_executable_identity(),
            },
        );

        invalidate_background_stages(&path, &state).unwrap();
        assert!(state.stages.lock().unwrap().is_empty());
    }

    #[test]
    fn background_reference_checks_resolve_relative_and_quoted_values_from_their_source() {
        let directory = tempfile::tempdir().unwrap();
        let config_directory = directory.path().join("ghostty");
        let image_directory = config_directory.join("images");
        fs::create_dir_all(&image_directory).unwrap();
        let source_config = config_directory.join("background.conf");
        let image = image_directory.join("night sky.png");
        fs::write(&image, b"image").unwrap();

        let relative =
            ConfigDocument::parse(b"background-image = \"images/night sky.png\"\n").unwrap();
        assert!(document_references_background_path(
            &relative,
            Some(&source_config),
            &image,
        ));

        let absolute = ConfigDocument::parse(
            format!("background-image = \"{}\"\n", image.display()).as_bytes(),
        )
        .unwrap();
        assert!(document_references_background_path(&absolute, None, &image,));
    }

    #[test]
    fn usage_index_keeps_overridden_references_and_returns_safe_source_labels() {
        let directory = tempfile::tempdir().unwrap();
        let xdg_directory = directory.path().join("xdg/ghostty");
        let macos_directory = directory.path().join("Library/Application Support/ghostty");
        fs::create_dir_all(&xdg_directory).unwrap();
        fs::create_dir_all(&macos_directory).unwrap();
        let managed = directory.path().join("managed.png");
        fs::write(&managed, b"managed image").unwrap();
        let xdg = xdg_directory.join("config");
        let include = xdg_directory.join("background.conf");
        let macos = macos_directory.join("config");
        fs::write(&xdg, b"config-file = background.conf\n").unwrap();
        fs::write(&include, b"background-image = external.jpg\n").unwrap();
        fs::write(
            &macos,
            format!("background-image = {}\n", managed.display()).as_bytes(),
        )
        .unwrap();
        let candidate =
            |id: &str, label: &str, path: &Path, source: &str, priority| ConfigCandidate {
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
            };
        let candidates = vec![
            candidate("xdg", "XDG · config", &xdg, "xdg", 0),
            candidate("macos", "macOS · config", &macos, "macos", 2),
        ];

        let references = loaded_background_references_for(&candidates).unwrap();
        let managed_identity = fs::canonicalize(&managed).unwrap();
        let managed_references = references.get(&managed_identity).unwrap();
        assert_eq!(managed_references.len(), 1);
        assert_eq!(managed_references[0].candidate_id.as_deref(), Some("macos"));
        assert_eq!(
            managed_references[0].source_label.as_deref(),
            Some("macOS · config")
        );
        assert!(managed_references[0].writable);
        assert!(!serde_json::to_string(managed_references)
            .unwrap()
            .contains(directory.path().to_string_lossy().as_ref()));
    }

    #[test]
    fn final_readback_keeps_a_concurrent_edit_and_refreshes_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let committed = b"font-size = 14\n";
        let external = b"font-size = 99\n";
        fs::write(&target, committed).unwrap();
        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, committed);
        let previous = open_session(&state, &session_id).unwrap();
        insert_stage(&state, &session_id, &previous.revision);

        fs::write(&target, external).unwrap();
        let error = refresh_session_after_verified_write(
            &state,
            &session_id,
            &previous,
            &safe_write::revision(committed),
        )
        .unwrap_err();

        assert_eq!(error.code, "post_validation_conflict");
        let refreshed = open_session(&state, &session_id).unwrap();
        assert_eq!(refreshed.original_bytes, external);
        assert_eq!(refreshed.revision, safe_write::revision(external));
        assert!(state.stages.lock().unwrap().is_empty());
    }

    #[test]
    fn failed_final_readback_expires_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let committed = b"font-size = 14\n";
        fs::write(&target, committed).unwrap();
        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, committed);
        let previous = open_session(&state, &session_id).unwrap();
        insert_stage(&state, &session_id, &previous.revision);

        fs::remove_file(&target).unwrap();
        let error = refresh_session_after_verified_write(
            &state,
            &session_id,
            &previous,
            &safe_write::revision(committed),
        )
        .unwrap_err();

        assert_eq!(error.code, "post_validation_unverified");
        let expired = match open_session(&state, &session_id) {
            Ok(_) => panic!("session should have expired"),
            Err(error) => error,
        };
        assert_eq!(expired.code, "unknown_session");
        assert!(state.stages.lock().unwrap().is_empty());
    }

    #[test]
    fn snapshot_listing_and_restore_are_scoped_to_the_session_target() {
        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let first_target = directory.path().join("first-config");
        let second_target = directory.path().join("second-config");
        let first_original = b"font-size = 11\n";
        let first_current = b"font-size = 12\n";
        let second_original = b"font-size = 21\n";
        let second_current = b"font-size = 22\n";
        fs::write(&first_target, first_original).unwrap();
        fs::write(&second_target, second_original).unwrap();
        let first_write = safe_write::write_atomically(
            &first_target,
            first_current,
            &safe_write::revision(first_original),
            &data_root,
        )
        .unwrap();
        let second_write = safe_write::write_atomically(
            &second_target,
            second_current,
            &safe_write::revision(second_original),
            &data_root,
        )
        .unwrap();

        let state = AppState::default();
        let first_session = insert_writable_session(&state, &first_target, first_current);
        let listed = list_snapshots_for_session(&data_root, &first_session, &state).unwrap();
        assert_eq!(listed.len(), 1);
        assert_eq!(listed[0].id, first_write.snapshot_id);

        let storage_error =
            safe_write::read_snapshot(&data_root, &first_target, &second_write.snapshot_id)
                .unwrap_err();
        assert_eq!(storage_error.code, "snapshot_target_mismatch");

        let error = restore_snapshot_for_session(
            &data_root,
            test_executable_identity().path(),
            &first_session,
            &safe_write::revision(first_current),
            &second_write.snapshot_id,
            &state,
        )
        .unwrap_err();
        assert_eq!(error.code, "unknown_snapshot");
        assert_eq!(fs::read(&first_target).unwrap(), first_current);
        assert_eq!(fs::read(&second_target).unwrap(), second_current);
    }

    #[test]
    fn restore_rejects_non_uuid_snapshot_id_before_storage_access() {
        let state = AppState::default();
        let error = restore_snapshot_for_session(
            Path::new("missing-data-root"),
            Path::new("missing-validator"),
            "not-a-session",
            "not-a-revision",
            "../../secret",
            &state,
        )
        .unwrap_err();
        assert_eq!(error.code, "invalid_snapshot_id");
    }

    #[cfg(unix)]
    fn write_validator(directory: &Path, graph_action: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = directory.join(format!("validator-{}", Uuid::new_v4()));
        let script = format!(
            "#!/bin/sh\nif [ \"$1\" != \"+validate-config\" ]; then\n  exit 90\nfi\nif [ \"$#\" -eq 1 ]; then\n{graph_action}\nfi\nexit 0\n"
        );
        fs::write(&path, script).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[cfg(unix)]
    fn shell_quote(path: &Path) -> String {
        format!("'{}'", path.to_string_lossy().replace('\'', "'\"'\"'"))
    }

    #[cfg(unix)]
    #[test]
    fn restore_saves_rollback_snapshot_and_refreshes_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let target = directory.path().join("config");
        let restored = b"font-size = 13\n";
        let current = b"font-size = 14\n";
        fs::write(&target, restored).unwrap();
        let selected = safe_write::write_atomically(
            &target,
            current,
            &safe_write::revision(restored),
            &data_root,
        )
        .unwrap();
        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, current);
        let current_revision = safe_write::revision(current);
        insert_stage(&state, &session_id, &current_revision);
        let validator = write_validator(directory.path(), "  exit 0");

        let result = restore_snapshot_for_session(
            &data_root,
            &validator,
            &session_id,
            &current_revision,
            &selected.snapshot_id,
            &state,
        )
        .unwrap();

        assert_eq!(fs::read(&target).unwrap(), restored);
        assert_eq!(result.revision, safe_write::revision(restored));
        assert_ne!(result.snapshot_id, selected.snapshot_id);
        assert_eq!(
            safe_write::read_snapshot(&data_root, &target, &result.snapshot_id).unwrap(),
            current
        );
        assert!(result
            .diagnostics
            .iter()
            .any(|message| message.contains(&selected.snapshot_id)));
        let refreshed = open_session(&state, &session_id).unwrap();
        assert_eq!(refreshed.original_bytes, restored);
        assert_eq!(refreshed.revision, safe_write::revision(restored));
        assert!(state.stages.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn failed_graph_validation_rolls_back_atomically_and_refreshes_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let target = directory.path().join("config");
        let restored = b"font-size = 13\n";
        let current = b"font-size = 14\n";
        fs::write(&target, restored).unwrap();
        let selected = safe_write::write_atomically(
            &target,
            current,
            &safe_write::revision(restored),
            &data_root,
        )
        .unwrap();
        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, current);
        let current_revision = safe_write::revision(current);
        insert_stage(&state, &session_id, &current_revision);
        let validator = write_validator(
            directory.path(),
            "  echo 'included config is invalid' >&2\n  exit 1",
        );

        let error = restore_snapshot_for_session(
            &data_root,
            &validator,
            &session_id,
            &current_revision,
            &selected.snapshot_id,
            &state,
        )
        .unwrap_err();

        assert_eq!(error.code, "post_restore_validation_failed");
        assert!(error.message.contains("restored atomically"));
        assert_eq!(fs::read(&target).unwrap(), current);
        let refreshed = open_session(&state, &session_id).unwrap();
        assert_eq!(refreshed.original_bytes, current);
        assert_eq!(refreshed.revision, current_revision);
        assert!(state.stages.lock().unwrap().is_empty());
    }

    #[cfg(unix)]
    #[test]
    fn rollback_conflict_preserves_external_edit_and_refreshes_the_session() {
        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let target = directory.path().join("config");
        let restored = b"font-size = 13\n";
        let current = b"font-size = 14\n";
        let external = b"font-size = 99\n";
        fs::write(&target, restored).unwrap();
        let selected = safe_write::write_atomically(
            &target,
            current,
            &safe_write::revision(restored),
            &data_root,
        )
        .unwrap();
        let state = AppState::default();
        let session_id = insert_writable_session(&state, &target, current);
        let current_revision = safe_write::revision(current);
        insert_stage(&state, &session_id, &current_revision);
        let validator = write_validator(
            directory.path(),
            &format!(
                "  printf '%s\\n' 'font-size = 99' > {}\n  echo 'included config is invalid' >&2\n  exit 1",
                shell_quote(&target)
            ),
        );

        let error = restore_snapshot_for_session(
            &data_root,
            &validator,
            &session_id,
            &current_revision,
            &selected.snapshot_id,
            &state,
        )
        .unwrap_err();

        assert_eq!(error.code, "post_restore_validation_rollback_failed");
        assert!(error
            .message
            .contains("without overwriting a concurrent edit"));
        assert_eq!(fs::read(&target).unwrap(), external);
        let refreshed = open_session(&state, &session_id).unwrap();
        assert_eq!(refreshed.original_bytes, external);
        assert_eq!(refreshed.revision, safe_write::revision(external));
        assert!(state.stages.lock().unwrap().is_empty());
    }
}
