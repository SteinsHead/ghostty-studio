mod domain;
mod error;
mod models;

use std::{
    collections::{HashMap, HashSet},
    path::{Path, PathBuf},
    sync::{
        atomic::{AtomicBool, Ordering},
        Mutex,
    },
};

use domain::{
    config_document::ConfigDocument,
    config_graph, discovery, extension, ghostty,
    safe_write::{self, revision},
    schema,
};
use error::CommandError;
use models::{
    ApplyResult, ChangePreview, ConfigCandidate, ConfigSession, DraftChange, EnvironmentReport,
    RuntimeSchema,
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
}

struct PreparedSnapshotRestore {
    current_bytes: Vec<u8>,
    restored_bytes: Vec<u8>,
    validation: ghostty::ValidationReport,
    snapshot: safe_write::SnapshotInfo,
    changed_keys: Vec<String>,
}

struct CurrentRuntimeContract {
    executable: PathBuf,
    editable_keys: HashSet<String>,
}

#[derive(Default)]
struct AppState {
    candidates: Mutex<HashMap<String, ConfigCandidate>>,
    sessions: Mutex<HashMap<String, OpenSession>>,
    stages: Mutex<HashMap<String, StagedCandidate>>,
    runtime_schema: Mutex<Option<RuntimeSchema>>,
    mutation_in_flight: AtomicBool,
}

#[derive(Debug)]
struct MutationGuard<'a>(&'a AtomicBool);

impl Drop for MutationGuard<'_> {
    fn drop(&mut self) {
        self.0.store(false, Ordering::Release);
    }
}

#[tauri::command]
fn probe_environment(state: State<'_, AppState>) -> Result<EnvironmentReport, CommandError> {
    let candidates = discovery::discover_config_candidates();
    let existing_count = candidates
        .iter()
        .filter(|candidate| candidate.exists)
        .count();
    let mut warnings = Vec::new();
    if existing_count > 1 {
        warnings.push(format!(
            "检测到 {existing_count} 个 Ghostty 默认配置层；最终值可能来自不同文件。"
        ));
    }
    if candidates.iter().any(|candidate| candidate.symlink) {
        warnings.push("检测到符号链接；写入前需要单独确认真实目标。".to_string());
    }
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
    let visible_candidates = candidates
        .iter()
        .cloned()
        .map(|mut candidate| {
            candidate.path = display_path(Path::new(&candidate.path));
            candidate
        })
        .collect();

    let mut visible_ghostty = ghostty::probe();
    if let Some(executable_path) = visible_ghostty.executable_path.as_mut() {
        *executable_path = display_path(Path::new(executable_path));
    }
    visible_ghostty.raw_version = None;

    Ok(EnvironmentReport {
        platform: std::env::consts::OS.to_string(),
        architecture: std::env::consts::ARCH.to_string(),
        ghostty: visible_ghostty,
        candidates: visible_candidates,
        warnings,
    })
}

#[tauri::command]
fn load_runtime_schema(state: State<'_, AppState>) -> Result<RuntimeSchema, CommandError> {
    let probe = ghostty::probe();
    let runtime_schema =
        if let Some(executable) = probe.executable_path.as_deref().map(PathBuf::from) {
            schema::load(&executable, probe.version)?
        } else {
            RuntimeSchema {
                ghostty_version: None,
                schema_hash: "offline".to_string(),
                options: Vec::new(),
                diagnostics: vec!["没有找到 Ghostty，设置暂时只读。".to_string()],
            }
        };
    *state
        .runtime_schema
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))? =
        Some(runtime_schema.clone());
    Ok(runtime_schema)
}

#[tauri::command]
fn inspect_extension_manifest(
    manifest: String,
    state: State<'_, AppState>,
) -> Result<extension::ValidatedExtension, CommandError> {
    if manifest.len() > 512 * 1024 {
        return Err(CommandError::new(
            "extension_too_large",
            "extension manifest exceeds the 512 KiB limit",
        ));
    }
    let cached_schema = state
        .runtime_schema
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))?
        .clone();
    let (core_keys, installed_version) = match cached_schema {
        Some(schema) => (
            schema
                .options
                .iter()
                .map(|option| option.key.clone())
                .collect::<HashSet<_>>(),
            schema.ghostty_version,
        ),
        None => {
            let probe = ghostty::probe();
            let keys = match probe.executable_path.as_deref().map(PathBuf::from) {
                Some(executable) => schema::load(&executable, probe.version.clone())?
                    .options
                    .into_iter()
                    .map(|option| option.key)
                    .collect(),
                None => HashSet::new(),
            };
            (keys, probe.version)
        }
    };
    extension::validate_manifest(
        manifest.as_bytes(),
        false,
        &core_keys,
        installed_version.as_deref(),
    )
}

#[tauri::command]
fn load_config_graph() -> Result<config_graph::ConfigGraph, CommandError> {
    let candidates = discovery::discover_config_candidates();
    let roots = candidates
        .iter()
        .filter(|candidate| candidate.exists)
        .map(|candidate| PathBuf::from(&candidate.path))
        .collect::<Vec<_>>();
    let allowed_roots = candidates
        .iter()
        .filter_map(|candidate| PathBuf::from(&candidate.path).parent().map(PathBuf::from))
        .collect::<Vec<_>>();
    let mut graph = config_graph::build(roots, allowed_roots)?;
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
        if let Some(path) = &mut diagnostic.path {
            *path = path_labels
                .get(path)
                .cloned()
                .unwrap_or_else(|| "未公开路径".to_string());
        }
    }
    Ok(graph)
}

#[tauri::command]
fn open_config(
    candidate_id: String,
    state: State<'_, AppState>,
) -> Result<ConfigSession, CommandError> {
    let _mutation_guard = acquire_mutation(&state)?;
    open_config_session(&candidate_id, &state)
}

fn open_config_session(
    candidate_id: &str,
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
    let safe_keys = editable_scalar_keys(state)?;
    let all_values = document.values();
    let hidden_value_count = all_values
        .keys()
        .filter(|key| !safe_keys.contains(*key))
        .count();
    let values = all_values
        .into_iter()
        .filter(|(key, _)| safe_keys.contains(key))
        .collect();
    let mut diagnostics = Vec::new();
    if candidate.symlink {
        diagnostics
            .push("该配置是符号链接；当前会话只读，后续高级流程会显示并授权真实目标。".to_string());
    }
    if hidden_value_count > 0 {
        diagnostics.push(format!(
            "为保护敏感信息，{hidden_value_count} 个高风险、可重复或未知设置的值未发送到 WebView。"
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
        path: display_path(&path),
        revision,
        read_only,
        values,
        diagnostics,
    })
}

#[tauri::command]
async fn create_config(
    candidate_id: String,
    app: tauri::AppHandle,
    state: State<'_, AppState>,
) -> Result<ConfigSession, CommandError> {
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
    require_native_confirmation(
        &app,
        format!(
            "将在 {visible_path} 创建一个 0 字节的 Ghostty 配置文件。\n\n新目录权限为 0700，文件权限为 0600。若另一个程序先创建目标，Ghostty Studio 会停止，绝不会覆盖。"
        ),
        "创建配置",
    )
    .await?;
    let confirmed_candidate = fresh_creation_candidate(&candidate_id, &issued_candidate)?;
    if confirmed_candidate.path != candidate.path {
        return Err(CommandError::new(
            "candidate_changed",
            "the issued configuration target changed while confirmation was open",
        ));
    }
    let confirmed_contract = current_runtime_contract(&state)?;
    require_valid_empty_config(&confirmed_contract.executable)?;
    safe_write::preflight_new_config(&path, &home)?;
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
        let mut session = open_config_session(&candidate_id, &state)?;
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

fn require_valid_empty_config(executable: &Path) -> Result<(), CommandError> {
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
    let mut candidate_document = session.document.clone();
    let mut trusted_changes = Vec::with_capacity(changes.len());
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
        let next = change.after.first().cloned().unwrap_or_default();
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
    let token = Uuid::new_v4().to_string();
    let unified_diff = render_setting_diff(&trusted_changes);
    let staged = StagedCandidate {
        session_id: session_id.clone(),
        revision: revision.clone(),
        bytes: candidate_bytes,
        changes: trusted_changes.clone(),
        diagnostics: validation.diagnostics.clone(),
        valid: validation.valid,
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
        changes: trusted_changes,
        unified_diff,
        diagnostics: validation.diagnostics,
        valid: validation.valid,
    })
}

#[tauri::command]
async fn apply_changes(
    app: tauri::AppHandle,
    session_id: String,
    revision: String,
    token: String,
    state: State<'_, AppState>,
) -> Result<ApplyResult, CommandError> {
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
    let contract = current_runtime_contract(&state)?;
    require_current_change_keys(&stage.changes, &contract.editable_keys)?;
    require_native_confirmation(
        &app,
        format!(
            "将保存 {} 项修改：{}。\n\n保存前会自动创建快照。",
            stage.changes.len(),
            stage
                .changes
                .iter()
                .map(|change| change.key.as_str())
                .collect::<Vec<_>>()
                .join("、")
        ),
        "写入配置",
    )
    .await?;
    let contract = current_runtime_contract(&state)?;
    require_current_change_keys(&stage.changes, &contract.editable_keys)?;
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
    let data_root = app_data_root(&app)?;
    let outcome = write_for_open_session(&data_root, &state, &session_id, &session, &stage.bytes)?;

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

    let committed_revision =
        refresh_session_after_verified_write(&state, &session_id, &session, &outcome.revision)?;

    let mut diagnostics = stage.diagnostics;
    diagnostics.push(format!("已应用 {} 项经过验证的更改。", stage.changes.len()));
    Ok(ApplyResult {
        revision: committed_revision,
        snapshot_id: outcome.snapshot_id,
        diagnostics,
        warnings: outcome.warnings,
        reload_required: true,
    })
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
    state: State<'_, AppState>,
) -> Result<ApplyResult, CommandError> {
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
    enforce_snapshot_restore_policy(&prepared, &contract.editable_keys)?;
    let key_summary = if prepared.changed_keys.is_empty() {
        "仅文本、注释或格式发生变化".to_string()
    } else {
        prepared.changed_keys.join("、")
    };
    require_native_confirmation(
        &app,
        format!(
            "将恢复快照 {}（{} bytes）。\n\n包含的修改：{}\n\n恢复前会备份当前配置，并确认文件没有被其他程序修改。",
            &prepared.snapshot.id[..8],
            prepared.snapshot.size_bytes,
            key_summary
        ),
        "恢复快照",
    )
    .await?;
    let contract = current_runtime_contract(&state)?;
    enforce_snapshot_restore_policy(&prepared, &contract.editable_keys)?;
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
    apply_prepared_snapshot_restore(
        &data_root,
        &contract.executable,
        &session_id,
        &revision,
        prepared,
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

    let prepared = prepare_snapshot_restore(
        data_root,
        executable,
        &session,
        expected_revision,
        snapshot_id,
    )?;
    apply_prepared_snapshot_restore(
        data_root,
        executable,
        session_id,
        expected_revision,
        prepared,
        state,
    )
}

fn prepare_snapshot_restore(
    data_root: &Path,
    executable: &Path,
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
    })
}

fn enforce_snapshot_restore_policy(
    prepared: &PreparedSnapshotRestore,
    safe_keys: &HashSet<String>,
) -> Result<(), CommandError> {
    let blocked_count = prepared
        .changed_keys
        .iter()
        .filter(|key| !safe_keys.contains(*key))
        .count();
    if blocked_count > 0 {
        return Err(CommandError::new(
            "snapshot_requires_specialized_restore",
            format!(
                "这个快照包含 {blocked_count} 个当前版本无法安全恢复的设置，因此不能自动恢复。"
            ),
        ));
    }
    Ok(())
}

fn apply_prepared_snapshot_restore(
    data_root: &Path,
    executable: &Path,
    session_id: &str,
    expected_revision: &str,
    prepared: PreparedSnapshotRestore,
    state: &AppState,
) -> Result<ApplyResult, CommandError> {
    let session = open_session(state, session_id)?;
    if session.read_only || session.revision != expected_revision {
        return Err(CommandError::new(
            "revision_conflict",
            "configuration session changed while the restore was being reviewed",
        ));
    }
    let restored_snapshot_id = prepared.snapshot.id.clone();

    let outcome = write_for_open_session(
        data_root,
        state,
        session_id,
        &session,
        &prepared.restored_bytes,
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
        reload_required: true,
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
    let probe = ghostty::probe();
    let executable = probe.executable_path.map(PathBuf::from).ok_or_else(|| {
        CommandError::new(
            "ghostty_unavailable",
            "a writable operation requires the installed Ghostty binary",
        )
    })?;
    let fresh_schema = schema::load(&executable, probe.version)?;
    let editable_keys = reconcile_runtime_schema(state, fresh_schema)?;
    Ok(CurrentRuntimeContract {
        executable,
        editable_keys,
    })
}

fn reconcile_runtime_schema(
    state: &AppState,
    fresh_schema: RuntimeSchema,
) -> Result<HashSet<String>, CommandError> {
    let editable_keys = editable_keys_from_schema(&fresh_schema);
    let mut cached_schema = state
        .runtime_schema
        .lock()
        .map_err(|_| CommandError::new("state_poisoned", "schema state is unavailable"))?;
    let cached = cached_schema.as_ref().ok_or_else(|| {
        CommandError::new(
            "schema_not_loaded",
            "the runtime schema must be loaded before a writable operation",
        )
    })?;
    if cached.ghostty_version != fresh_schema.ghostty_version
        || cached.schema_hash != fresh_schema.schema_hash
    {
        *cached_schema = Some(fresh_schema);
        drop(cached_schema);
        state
            .stages
            .lock()
            .map_err(|_| CommandError::new("state_poisoned", "stage state is unavailable"))?
            .clear();
        return Err(CommandError::new(
            "ghostty_contract_changed",
            "the installed Ghostty version or schema changed while the application was open; all reviews were invalidated and the schema must be reloaded",
        ));
    }
    drop(cached_schema);
    if editable_keys.is_empty() {
        return Err(CommandError::new(
            "ghostty_contract_read_only",
            "the current Ghostty version and schema do not match a writable audited contract",
        ));
    }
    Ok(editable_keys)
}

fn editable_keys_from_schema(schema: &RuntimeSchema) -> HashSet<String> {
    schema
        .options
        .iter()
        .filter(|option| option.editable && !option.repeatable && option.risk == "normal")
        .map(|option| option.key.clone())
        .collect()
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

fn app_data_root(app: &tauri::AppHandle) -> Result<PathBuf, CommandError> {
    app.path().app_data_dir().map_err(|error| {
        CommandError::new(
            "app_data_unavailable",
            format!("cannot resolve the private snapshot directory: {error}"),
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

async fn require_native_confirmation(
    app: &tauri::AppHandle,
    message: String,
    confirm_label: &'static str,
) -> Result<(), CommandError> {
    let app = app.clone();
    let confirmed = tauri::async_runtime::spawn_blocking(move || {
        app.dialog()
            .message(message)
            .title(confirm_label)
            .kind(MessageDialogKind::Warning)
            .buttons(MessageDialogButtons::OkCancelCustom(
                confirm_label.to_string(),
                "取消".to_string(),
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

fn render_setting_diff(changes: &[DraftChange]) -> String {
    changes
        .iter()
        .flat_map(|change| {
            [
                format!("-{} = {}", change.key, change.before.join(", ")),
                format!("+{} = {}", change.key, change.after.join(", ")),
            ]
        })
        .collect::<Vec<_>>()
        .join("\n")
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
            inspect_extension_manifest,
            load_config_graph,
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
    fn runtime_contract_change_invalidates_reviews_fail_closed() {
        let state = AppState::default();
        *state.runtime_schema.lock().unwrap() = Some(RuntimeSchema {
            ghostty_version: Some("1.3.1".to_string()),
            schema_hash: "old-schema".to_string(),
            diagnostics: Vec::new(),
            options: Vec::new(),
        });
        insert_stage(&state, "session", &"0".repeat(64));

        let error = reconcile_runtime_schema(
            &state,
            RuntimeSchema {
                ghostty_version: Some("1.3.2".to_string()),
                schema_hash: "new-schema".to_string(),
                diagnostics: Vec::new(),
                options: Vec::new(),
            },
        )
        .unwrap_err();

        assert_eq!(error.code, "ghostty_contract_changed");
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
                    category: "字体".to_string(),
                    kind: "number".to_string(),
                    choices: Vec::new(),
                    repeatable: false,
                    platform: None,
                    since: None,
                    risk: "normal".to_string(),
                    editable: true,
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
                },
                models::RuntimeOption {
                    key: "font-family".to_string(),
                    description: String::new(),
                    default_values: Vec::new(),
                    current_values: Vec::new(),
                    category: "字体".to_string(),
                    kind: "text".to_string(),
                    choices: Vec::new(),
                    repeatable: true,
                    platform: None,
                    since: None,
                    risk: "normal".to_string(),
                    editable: false,
                },
            ],
        });

        let allowed = editable_scalar_keys(&state).unwrap();
        assert!(allowed.contains("font-size"));
        assert!(!allowed.contains("command"));
        assert!(!allowed.contains("font-family"));
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
                category: "字体".to_string(),
                kind: "number".to_string(),
                choices: Vec::new(),
                repeatable: false,
                platform: None,
                since: None,
                risk: "normal".to_string(),
                editable: true,
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
        };

        let safe_keys = editable_scalar_keys(&state).unwrap();
        assert!(enforce_snapshot_restore_policy(
            &prepared(vec!["font-size".to_string()]),
            &safe_keys
        )
        .is_ok());
        assert_eq!(
            enforce_snapshot_restore_policy(&prepared(vec!["command".to_string()]), &safe_keys)
                .unwrap_err()
                .code,
            "snapshot_requires_specialized_restore"
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

    fn insert_stage(state: &AppState, session_id: &str, revision: &str) {
        state.stages.lock().unwrap().insert(
            Uuid::new_v4().to_string(),
            StagedCandidate {
                session_id: session_id.to_string(),
                revision: revision.to_string(),
                bytes: b"font-size = 15\n".to_vec(),
                changes: Vec::new(),
                diagnostics: Vec::new(),
                valid: true,
            },
        );
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
            Path::new("validator-is-not-reached"),
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
