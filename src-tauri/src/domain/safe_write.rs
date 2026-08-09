use std::{
    fs::{self, File, OpenOptions},
    io::{Read, Write},
    path::{Component, Path},
    time::{SystemTime, UNIX_EPOCH},
};

use fs2::FileExt;
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use tempfile::NamedTempFile;
use uuid::Uuid;

use crate::{
    domain::ghostty::{self, ValidationReport},
    error::CommandError,
};

const MAX_SNAPSHOT_DIRECTORY_ENTRIES: usize = 10_000;
const MAX_SNAPSHOTS_PER_TARGET: usize = 100;
const MAX_TARGET_BYTES: usize = 4 * 1024 * 1024;

#[derive(Debug)]
pub struct WriteOutcome {
    pub revision: String,
    pub snapshot_id: String,
    pub warnings: Vec<String>,
}

#[derive(Debug)]
pub struct CreateOutcome {
    pub revision: String,
    pub warnings: Vec<String>,
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SnapshotInfo {
    pub id: String,
    pub created_at_ms: u64,
    pub revision: String,
    pub size_bytes: u64,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
struct SnapshotMetadata {
    id: String,
    target_hash: String,
    created_at_ms: u64,
    revision: String,
    size_bytes: u64,
}

pub fn revision(bytes: &[u8]) -> String {
    hex(&Sha256::digest(bytes))
}

pub fn validate_candidate(
    executable: &ghostty::ExecutableIdentity,
    target: &Path,
    bytes: &[u8],
) -> Result<ValidationReport, CommandError> {
    let parent = target.parent().ok_or_else(|| {
        CommandError::new(
            "invalid_target",
            "configuration target has no parent directory",
        )
    })?;
    let mut temporary = NamedTempFile::new_in(parent)?;
    set_private_permissions(temporary.path())?;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    ghostty::validate_config(executable, temporary.path())
}

pub fn validate_empty_config(
    executable: &ghostty::ExecutableIdentity,
) -> Result<ValidationReport, CommandError> {
    let temporary = NamedTempFile::new()?;
    set_private_permissions(temporary.path())?;
    temporary.as_file().sync_all()?;
    ghostty::validate_config(executable, temporary.path())
}

pub fn preflight_new_config(target: &Path, allowed_root: &Path) -> Result<(), CommandError> {
    if !target.is_absolute()
        || !allowed_root.is_absolute()
        || target
            .components()
            .any(|component| matches!(component, Component::ParentDir | Component::CurDir))
        || !target.starts_with(allowed_root)
    {
        return Err(CommandError::new(
            "creation_outside_approved_root",
            "new configurations may only be created below their approved root",
        ));
    }
    #[cfg(unix)]
    {
        let Some((parent, name)) = open_creation_parent(target, allowed_root, false)? else {
            return Ok(());
        };
        ensure_target_absent(&parent, &name)
    }
    #[cfg(not(unix))]
    {
        let _ = (target, allowed_root);
        Err(CommandError::new(
            "config_creation_not_supported",
            "safe configuration creation is currently supported on Unix platforms only",
        ))
    }
}

pub fn create_new_config(
    target: &Path,
    allowed_root: &Path,
) -> Result<CreateOutcome, CommandError> {
    preflight_new_config(target, allowed_root)?;
    #[cfg(unix)]
    {
        use std::os::fd::{AsRawFd, FromRawFd};
        use std::os::unix::fs::MetadataExt;

        let (parent, name) =
            open_creation_parent(target, allowed_root, true)?.ok_or_else(|| {
                CommandError::new(
                    "invalid_creation_parent",
                    "configuration parent could not be prepared",
                )
            })?;
        ensure_target_absent(&parent, &name)?;
        // SAFETY: parent is a live directory descriptor, name is NUL-free, and
        // the returned descriptor is immediately owned by File exactly once.
        let descriptor = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDWR | libc::O_CREAT | libc::O_EXCL | libc::O_NOFOLLOW | libc::O_CLOEXEC,
                0o600,
            )
        };
        if descriptor < 0 {
            let error = std::io::Error::last_os_error();
            return Err(if error.kind() == std::io::ErrorKind::AlreadyExists {
                CommandError::new(
                    "config_already_exists",
                    "another program created the configuration before commit",
                )
            } else {
                CommandError::new(
                    "config_creation_failed",
                    format!("failed to create the configuration without overwriting: {error}"),
                )
            });
        }
        // SAFETY: openat returned a new owned descriptor on the success path.
        let created = unsafe { File::from_raw_fd(descriptor) };
        use std::os::unix::fs::PermissionsExt;
        created.set_permissions(fs::Permissions::from_mode(0o600))?;
        created.sync_all()?;
        let created_metadata = created.metadata()?;
        if !created_metadata.is_file()
            || created_metadata.nlink() != 1
            || created_metadata.len() != 0
        {
            return Err(CommandError::new(
                "post_creation_unverified",
                "the newly created target is not the expected empty regular file",
            ));
        }

        let mut warnings = Vec::new();
        if let Err(error) = parent.sync_all() {
            warnings.push(format!(
                "配置文件已创建，但父目录 fsync 失败，断电耐久性未确认：{error}"
            ));
        }
        let visible_metadata = fs::symlink_metadata(target).map_err(|error| {
            CommandError::new(
                "post_creation_unverified",
                format!("the created file is no longer reachable at the issued path: {error}"),
            )
        })?;
        if visible_metadata.file_type().is_symlink()
            || !visible_metadata.is_file()
            || visible_metadata.dev() != created_metadata.dev()
            || visible_metadata.ino() != created_metadata.ino()
        {
            return Err(CommandError::new(
                "post_creation_conflict",
                "the issued path no longer names the file created by Ghostty Studio; no newer path was overwritten",
            ));
        }
        let written = read_regular_target_file(target).map_err(|error| {
            CommandError::new(
                "post_creation_unverified",
                format!(
                    "the configuration was created but could not be read back: {}",
                    error.message
                ),
            )
        })?;
        if !written.is_empty() {
            return Err(CommandError::new(
                "post_creation_conflict",
                "the new configuration was edited before verification; the newer content was kept",
            ));
        }
        Ok(CreateOutcome {
            revision: revision(&written),
            warnings,
            device: created_metadata.dev(),
            inode: created_metadata.ino(),
        })
    }
    #[cfg(not(unix))]
    {
        let _ = (target, allowed_root);
        Err(CommandError::new(
            "config_creation_not_supported",
            "safe configuration creation is currently supported on Unix platforms only",
        ))
    }
}

#[cfg(unix)]
fn open_creation_parent(
    target: &Path,
    allowed_root: &Path,
    create_missing: bool,
) -> Result<Option<(File, std::ffi::CString)>, CommandError> {
    use std::ffi::{CString, OsStr};
    use std::os::fd::{AsRawFd, FromRawFd};
    use std::os::unix::ffi::OsStrExt;
    use std::os::unix::fs::OpenOptionsExt;

    let relative = target.strip_prefix(allowed_root).map_err(|_| {
        CommandError::new(
            "creation_outside_approved_root",
            "the issued configuration path is outside its approved root",
        )
    })?;
    let components = relative
        .components()
        .map(|component| match component {
            Component::Normal(value) => Ok(value),
            _ => Err(CommandError::new(
                "invalid_target",
                "configuration creation requires a normalized relative path",
            )),
        })
        .collect::<Result<Vec<_>, _>>()?;
    let (file_name, directories) = components.split_last().ok_or_else(|| {
        CommandError::new(
            "invalid_target",
            "configuration target cannot be the approved root itself",
        )
    })?;
    let name = c_string(file_name)?;
    let mut root_options = OpenOptions::new();
    root_options
        .read(true)
        .custom_flags(libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC);
    let mut current = root_options.open(allowed_root).map_err(|error| {
        CommandError::new(
            "invalid_creation_root",
            format!("the approved configuration root is unavailable or unsafe: {error}"),
        )
    })?;

    for directory in directories {
        let directory_name = c_string(directory)?;
        match open_directory_at(&current, &directory_name) {
            Ok(next) => current = next,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound && !create_missing => {
                return Ok(None);
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {
                // SAFETY: current is a live directory descriptor and the name
                // is a single, normalized, NUL-free path component.
                let created =
                    unsafe { libc::mkdirat(current.as_raw_fd(), directory_name.as_ptr(), 0o700) };
                if created != 0 {
                    let mkdir_error = std::io::Error::last_os_error();
                    if mkdir_error.kind() != std::io::ErrorKind::AlreadyExists {
                        return Err(CommandError::new(
                            "config_creation_failed",
                            format!("failed to create a configuration directory: {mkdir_error}"),
                        ));
                    }
                }
                let next = open_directory_at(&current, &directory_name).map_err(|open_error| {
                    CommandError::new(
                        "invalid_creation_parent",
                        format!("a configuration parent is unavailable or unsafe: {open_error}"),
                    )
                })?;
                current.sync_all()?;
                current = next;
            }
            Err(error) => {
                return Err(CommandError::new(
                    "invalid_creation_parent",
                    format!("a configuration parent is unavailable or unsafe: {error}"),
                ));
            }
        }
    }
    return Ok(Some((current, name)));

    fn c_string(value: &OsStr) -> Result<CString, CommandError> {
        CString::new(value.as_bytes()).map_err(|_| {
            CommandError::new("invalid_target", "configuration path contains a NUL byte")
        })
    }

    fn open_directory_at(parent: &File, name: &CString) -> std::io::Result<File> {
        // SAFETY: parent is a live directory descriptor and name is NUL-free.
        let descriptor = unsafe {
            libc::openat(
                parent.as_raw_fd(),
                name.as_ptr(),
                libc::O_RDONLY | libc::O_DIRECTORY | libc::O_NOFOLLOW | libc::O_CLOEXEC,
            )
        };
        if descriptor < 0 {
            Err(std::io::Error::last_os_error())
        } else {
            // SAFETY: openat returned a new owned descriptor on success.
            Ok(unsafe { File::from_raw_fd(descriptor) })
        }
    }
}

#[cfg(unix)]
pub fn verify_created_config(
    target: &Path,
    allowed_root: &Path,
    outcome: &CreateOutcome,
) -> Result<(), CommandError> {
    use std::os::unix::fs::MetadataExt;

    let (parent, name) = open_creation_parent(target, allowed_root, false)?.ok_or_else(|| {
        CommandError::new(
            "post_creation_unverified",
            "the configuration parent disappeared after creation",
        )
    })?;
    let file = open_regular_file_at(&parent, &name)?;
    let metadata = file.metadata()?;
    if !metadata.is_file()
        || metadata.nlink() != 1
        || metadata.len() != 0
        || metadata.dev() != outcome.device
        || metadata.ino() != outcome.inode
    {
        return Err(CommandError::new(
            "post_creation_conflict",
            "the issued path no longer names the unchanged file created by Ghostty Studio",
        ));
    }
    Ok(())
}

#[cfg(not(unix))]
pub fn verify_created_config(
    _target: &Path,
    _allowed_root: &Path,
    _outcome: &CreateOutcome,
) -> Result<(), CommandError> {
    Err(CommandError::new(
        "config_creation_not_supported",
        "safe configuration creation is currently supported on Unix platforms only",
    ))
}

#[cfg(unix)]
fn open_regular_file_at(parent: &File, name: &std::ffi::CString) -> Result<File, CommandError> {
    use std::os::fd::{AsRawFd, FromRawFd};

    // SAFETY: parent is a live directory descriptor and name is NUL-free.
    let descriptor = unsafe {
        libc::openat(
            parent.as_raw_fd(),
            name.as_ptr(),
            libc::O_RDONLY | libc::O_NOFOLLOW | libc::O_CLOEXEC | libc::O_NONBLOCK,
        )
    };
    if descriptor < 0 {
        return Err(CommandError::new(
            "post_creation_unverified",
            format!(
                "could not reopen the created configuration safely: {}",
                std::io::Error::last_os_error()
            ),
        ));
    }
    // SAFETY: openat returned a new owned descriptor on success.
    Ok(unsafe { File::from_raw_fd(descriptor) })
}

#[cfg(unix)]
fn ensure_target_absent(parent: &File, name: &std::ffi::CString) -> Result<(), CommandError> {
    use std::mem::MaybeUninit;
    use std::os::fd::AsRawFd;

    let mut metadata = MaybeUninit::<libc::stat>::uninit();
    // SAFETY: metadata points to writable storage, parent is live, and name is
    // NUL-free. fstatat initializes metadata only on its success path.
    let result = unsafe {
        libc::fstatat(
            parent.as_raw_fd(),
            name.as_ptr(),
            metadata.as_mut_ptr(),
            libc::AT_SYMLINK_NOFOLLOW,
        )
    };
    if result == 0 {
        return Err(CommandError::new(
            "config_already_exists",
            "the configuration target now exists; reload before choosing it",
        ));
    }
    let error = std::io::Error::last_os_error();
    if error.kind() == std::io::ErrorKind::NotFound {
        Ok(())
    } else {
        Err(CommandError::new(
            "config_creation_failed",
            format!("could not verify that the configuration target is absent: {error}"),
        ))
    }
}

pub fn write_atomically(
    target: &Path,
    candidate: &[u8],
    expected_revision: &str,
    data_root: &Path,
) -> Result<WriteOutcome, CommandError> {
    refuse_symlink(target)?;
    let original = read_regular_target_file(target)?;
    if revision(&original) != expected_revision {
        return Err(CommandError::new(
            "revision_conflict",
            "the configuration changed outside Ghostty Studio; reload before applying",
        ));
    }

    let locks = data_root.join("locks");
    create_private_directory(&locks)?;
    let lock_path = locks.join(format!("{}.lock", path_hash(target)));
    if fs::symlink_metadata(&lock_path)
        .is_ok_and(|metadata| !metadata.file_type().is_file() || metadata.file_type().is_symlink())
    {
        return Err(CommandError::new(
            "invalid_lock_file",
            "the private lock path is not a regular file",
        ));
    }
    let mut lock_options = OpenOptions::new();
    lock_options
        .create(true)
        .truncate(false)
        .read(true)
        .write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        lock_options.mode(0o600);
    }
    let lock = lock_options.open(&lock_path)?;
    set_private_permissions(&lock_path)?;
    lock.lock_exclusive().map_err(|error| {
        CommandError::new(
            "lock_failed",
            format!("failed to lock configuration: {error}"),
        )
    })?;

    let current = read_regular_target_file(target)?;
    if revision(&current) != expected_revision {
        let _ = FileExt::unlock(&lock);
        return Err(CommandError::new(
            "revision_conflict",
            "the configuration changed while waiting for the write lock",
        ));
    }

    // Prepare and fsync the complete replacement before the final revision
    // check. The only work left after that check is the atomic persist itself.
    let prepared_replacement = prepare_replacement(target, candidate)?;

    let snapshot_id = Uuid::new_v4().to_string();
    let snapshots = data_root.join("snapshots");
    create_private_directory(&snapshots)?;
    // Make room before creating the new pair. This also prevents repeated
    // pre-commit conflicts from growing snapshot storage without bound.
    prune_snapshots(data_root, target, "")?;
    let snapshot_path = snapshots.join(format!("{snapshot_id}.ghostty"));
    write_new_private_file(&snapshot_path, &original)?;
    let metadata = SnapshotMetadata {
        id: snapshot_id.clone(),
        target_hash: path_hash(target),
        created_at_ms: SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap_or_default()
            .as_millis()
            .try_into()
            .unwrap_or(u64::MAX),
        revision: revision(&original),
        size_bytes: original.len().try_into().unwrap_or(u64::MAX),
    };
    let metadata_path = snapshots.join(format!("{snapshot_id}.json"));
    if let Err(error) = write_new_private_file(&metadata_path, &serde_json::to_vec(&metadata)?) {
        let _ = fs::remove_file(&snapshot_path);
        return Err(error);
    }
    File::open(&snapshots)?.sync_all()?;

    // Editors do not participate in our private advisory lock. Minimize the
    // remaining race by checking once more after all snapshot I/O and
    // immediately before the atomic replace.
    let immediately_before_commit = read_regular_target_file(target)?;
    if revision(&immediately_before_commit) != expected_revision {
        let _ = FileExt::unlock(&lock);
        return Err(CommandError::new(
            "revision_conflict",
            "the configuration changed while the recovery snapshot was being prepared",
        ));
    }

    let mut warnings = match commit_replacement(target, prepared_replacement) {
        Ok(warning) => warning.into_iter().collect::<Vec<_>>(),
        Err(error) => {
            let _ = FileExt::unlock(&lock);
            return Err(error);
        }
    };

    let written = match read_regular_target_file(target) {
        Ok(bytes) => bytes,
        Err(error) => {
            let unlock_note = FileExt::unlock(&lock)
                .err()
                .map(|unlock_error| format!("；释放私有锁也失败：{unlock_error}"))
                .unwrap_or_default();
            return Err(CommandError::new(
                "post_commit_unverified",
                format!(
                    "配置可能已经完成原子替换，但写后读回失败，不能确认磁盘状态：[{}] {}。回滚快照为 {snapshot_id}{unlock_note}",
                    error.code, error.message
                ),
            ));
        }
    };
    if written != candidate {
        let _ = FileExt::unlock(&lock);
        return Err(CommandError::new(
            "post_commit_conflict",
            "the configuration changed immediately after the atomic replace; the newer on-disk content was preserved",
        ));
    }
    let written_revision = revision(&written);

    if let Err(error) = FileExt::unlock(&lock) {
        warnings.push(format!("配置已写入，但释放私有锁失败：{error}"));
    }
    Ok(WriteOutcome {
        revision: written_revision,
        snapshot_id,
        warnings,
    })
}

pub fn list_snapshots(data_root: &Path, target: &Path) -> Result<Vec<SnapshotInfo>, CommandError> {
    let mut results = snapshot_records(data_root, target)?
        .into_iter()
        .map(|(snapshot, _)| snapshot)
        .collect::<Vec<_>>();
    results.sort_by_key(|snapshot| std::cmp::Reverse(snapshot.created_at_ms));
    results.truncate(MAX_SNAPSHOTS_PER_TARGET);
    Ok(results)
}

fn snapshot_records(
    data_root: &Path,
    target: &Path,
) -> Result<Vec<(SnapshotInfo, std::path::PathBuf)>, CommandError> {
    let snapshots = data_root.join("snapshots");
    if !snapshots.exists() {
        return Ok(Vec::new());
    }
    let expected_target_hash = path_hash(target);
    let mut results = Vec::new();
    for (index, entry) in fs::read_dir(snapshots)?.enumerate() {
        if index >= MAX_SNAPSHOT_DIRECTORY_ENTRIES {
            return Err(CommandError::new(
                "snapshot_index_too_large",
                "snapshot storage contains too many directory entries to index safely",
            ));
        }
        let entry = entry?;
        let path = entry.path();
        if path.extension().and_then(|value| value.to_str()) != Some("json") {
            continue;
        }
        let Ok(bytes) = read_regular_snapshot_file(&path, 64 * 1024) else {
            continue;
        };
        let Ok(snapshot) = serde_json::from_slice::<SnapshotMetadata>(&bytes) else {
            continue;
        };
        let expected_file_name = format!("{}.json", snapshot.id);
        if snapshot.target_hash != expected_target_hash
            || Uuid::parse_str(&snapshot.id).is_err()
            || path.file_name().and_then(|value| value.to_str()) != Some(&expected_file_name)
            || snapshot.created_at_ms == 0
            || snapshot.size_bytes > 4 * 1024 * 1024
            || !is_revision(&snapshot.revision)
        {
            continue;
        }
        results.push((
            SnapshotInfo {
                id: snapshot.id,
                created_at_ms: snapshot.created_at_ms,
                revision: snapshot.revision,
                size_bytes: snapshot.size_bytes,
            },
            path,
        ));
    }
    Ok(results)
}

fn prune_snapshots(
    data_root: &Path,
    target: &Path,
    preserve_snapshot_id: &str,
) -> Result<(), CommandError> {
    let mut records = snapshot_records(data_root, target)?;
    records.sort_by_key(|(snapshot, _)| std::cmp::Reverse(snapshot.created_at_ms));
    let snapshots = data_root.join("snapshots");
    let mut retained_other_snapshots = 0_usize;
    for (snapshot, metadata_path) in records {
        if snapshot.id == preserve_snapshot_id {
            continue;
        }
        if retained_other_snapshots < MAX_SNAPSHOTS_PER_TARGET.saturating_sub(1) {
            retained_other_snapshots += 1;
            continue;
        }
        let content_path = snapshots.join(format!("{}.ghostty", snapshot.id));
        match fs::symlink_metadata(&content_path) {
            Ok(metadata)
                if metadata.file_type().is_file() && !metadata.file_type().is_symlink() =>
            {
                fs::remove_file(&content_path)?;
            }
            Ok(_) => {
                return Err(CommandError::new(
                    "invalid_snapshot_file",
                    "snapshot cleanup refused a non-regular content file",
                ));
            }
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(error) => return Err(error.into()),
        }
        fs::remove_file(metadata_path)?;
    }
    File::open(snapshots)?.sync_all()?;
    Ok(())
}

pub fn read_snapshot(
    data_root: &Path,
    target: &Path,
    snapshot_id: &str,
) -> Result<Vec<u8>, CommandError> {
    Uuid::parse_str(snapshot_id).map_err(|_| {
        CommandError::new("invalid_snapshot_id", "snapshot id must be a valid UUID")
    })?;
    let snapshots = data_root.join("snapshots");
    let metadata_path = snapshots.join(format!("{snapshot_id}.json"));
    let content_path = snapshots.join(format!("{snapshot_id}.ghostty"));
    let metadata_bytes = read_regular_snapshot_file(&metadata_path, 64 * 1024)?;
    let metadata: SnapshotMetadata = serde_json::from_slice(&metadata_bytes)?;
    if metadata.id != snapshot_id || metadata.target_hash != path_hash(target) {
        return Err(CommandError::new(
            "snapshot_target_mismatch",
            "snapshot does not belong to this configuration target",
        ));
    }
    if metadata.created_at_ms == 0
        || metadata.size_bytes > 4 * 1024 * 1024
        || !is_revision(&metadata.revision)
    {
        return Err(CommandError::new(
            "invalid_snapshot_metadata",
            "snapshot metadata contains invalid integrity fields",
        ));
    }
    let bytes = read_regular_snapshot_file(&content_path, 4 * 1024 * 1024)?;
    if bytes.len() as u64 != metadata.size_bytes || revision(&bytes) != metadata.revision {
        return Err(CommandError::new(
            "snapshot_integrity_failed",
            "snapshot content does not match its recorded size or hash",
        ));
    }
    Ok(bytes)
}

fn prepare_replacement(target: &Path, bytes: &[u8]) -> Result<NamedTempFile, CommandError> {
    let parent = target.parent().ok_or_else(|| {
        CommandError::new(
            "invalid_target",
            "configuration target has no parent directory",
        )
    })?;
    let original_permissions = fs::metadata(target)?.permissions();
    let mut temporary = NamedTempFile::new_in(parent)?;
    fs::set_permissions(temporary.path(), original_permissions)?;
    temporary.write_all(bytes)?;
    temporary.as_file_mut().flush()?;
    temporary.as_file().sync_all()?;
    Ok(temporary)
}

fn commit_replacement(
    target: &Path,
    temporary: NamedTempFile,
) -> Result<Option<String>, CommandError> {
    let parent = target.parent().ok_or_else(|| {
        CommandError::new(
            "invalid_target",
            "configuration target has no parent directory",
        )
    })?;
    temporary.persist(target).map_err(|error| {
        CommandError::new(
            "atomic_replace_failed",
            format!(
                "failed to atomically replace configuration: {}",
                error.error
            ),
        )
    })?;
    let durability_warning = File::open(parent)
        .and_then(|directory| directory.sync_all())
        .err()
        .map(|error| format!("配置已原子替换，但父目录 fsync 失败，断电耐久性未确认：{error}"));
    Ok(durability_warning)
}

fn refuse_symlink(target: &Path) -> Result<(), CommandError> {
    let metadata = fs::symlink_metadata(target)?;
    if metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            "symlink_confirmation_required",
            "the configuration is a symbolic link; following it requires an explicit advanced-mode grant",
        ));
    }
    if !metadata.file_type().is_file() {
        return Err(CommandError::new(
            "invalid_target",
            "configuration target is not a regular file",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::MetadataExt;
        if metadata.nlink() > 1 {
            return Err(CommandError::new(
                "hardlink_confirmation_required",
                "the configuration has multiple hard links; writing it requires an explicit advanced-mode grant",
            ));
        }
    }
    if let Some(home) = std::env::var_os("HOME").map(std::path::PathBuf::from) {
        if target.starts_with(&home) {
            let mut ancestor = target.parent();
            while let Some(path) = ancestor {
                if path == home {
                    break;
                }
                if fs::symlink_metadata(path)
                    .is_ok_and(|metadata| metadata.file_type().is_symlink())
                {
                    return Err(CommandError::new(
                        "symlinked_parent_confirmation_required",
                        "a parent directory of the configuration is a symbolic link; writing requires an explicit advanced-mode grant",
                    ));
                }
                ancestor = path.parent();
            }
        }
    }
    Ok(())
}

pub(crate) fn read_regular_target_file(path: &Path) -> Result<Vec<u8>, CommandError> {
    read_regular_file_bounded(path, false)
}

pub(crate) fn read_regular_readonly_file(path: &Path) -> Result<Vec<u8>, CommandError> {
    read_regular_file_bounded(path, true)
}

fn read_regular_file_bounded(
    path: &Path,
    allow_final_symlink: bool,
) -> Result<Vec<u8>, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        let mut flags = libc::O_NONBLOCK;
        if !allow_final_symlink {
            flags |= libc::O_NOFOLLOW;
        }
        options.custom_flags(flags);
    }
    let file = options.open(path).map_err(|error| {
        #[cfg(unix)]
        if !allow_final_symlink && error.raw_os_error() == Some(libc::ELOOP) {
            return CommandError::new(
                "symlink_confirmation_required",
                "configuration target became a symbolic link",
            );
        }
        CommandError::from(error)
    })?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(CommandError::new(
            "invalid_target",
            "configuration target is not a regular file",
        ));
    }
    if metadata.len() > MAX_TARGET_BYTES as u64 {
        return Err(CommandError::new(
            "config_too_large",
            "configuration exceeds the 4 MiB safety limit",
        ));
    }
    let mut bytes = Vec::with_capacity(metadata.len() as usize);
    file.take((MAX_TARGET_BYTES + 1) as u64)
        .read_to_end(&mut bytes)?;
    if bytes.len() > MAX_TARGET_BYTES {
        return Err(CommandError::new(
            "config_too_large",
            "configuration grew beyond the 4 MiB safety limit while being read",
        ));
    }
    Ok(bytes)
}

fn create_private_directory(path: &Path) -> Result<(), CommandError> {
    fs::create_dir_all(path)?;
    let metadata = fs::symlink_metadata(path)?;
    if !metadata.file_type().is_dir() || metadata.file_type().is_symlink() {
        return Err(CommandError::new(
            "invalid_private_directory",
            "private storage path is not a regular directory",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o700))?;
    }
    Ok(())
}

fn set_private_permissions(path: &Path) -> Result<(), CommandError> {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(path, fs::Permissions::from_mode(0o600))?;
    }
    Ok(())
}

fn write_new_private_file(path: &Path, bytes: &[u8]) -> Result<(), CommandError> {
    let mut options = OpenOptions::new();
    options.create_new(true).write(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options.open(path)?;
    let outcome = (|| -> Result<(), CommandError> {
        file.write_all(bytes)?;
        file.flush()?;
        file.sync_all()?;
        Ok(())
    })();
    drop(file);
    if outcome.is_err() {
        let _ = fs::remove_file(path);
    }
    outcome
}

fn read_regular_snapshot_file(path: &Path, size_limit: usize) -> Result<Vec<u8>, CommandError> {
    let mut options = OpenOptions::new();
    options.read(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.custom_flags(libc::O_NOFOLLOW | libc::O_NONBLOCK);
    }
    let file = options.open(path).map_err(|error| {
        #[cfg(unix)]
        if error.raw_os_error() == Some(libc::ELOOP) {
            return CommandError::new(
                "invalid_snapshot_file",
                "snapshot storage contains a symbolic link",
            );
        }
        CommandError::from(error)
    })?;
    let metadata = file.metadata()?;
    if !metadata.file_type().is_file() {
        return Err(CommandError::new(
            "invalid_snapshot_file",
            "snapshot storage contains a non-regular file",
        ));
    }
    if metadata.len() > size_limit as u64 {
        return Err(CommandError::new(
            "invalid_snapshot_file",
            "snapshot file exceeds the safety limit",
        ));
    }
    let mut bytes = Vec::with_capacity((metadata.len() as usize).min(size_limit));
    file.take((size_limit + 1) as u64).read_to_end(&mut bytes)?;
    if bytes.len() > size_limit {
        return Err(CommandError::new(
            "invalid_snapshot_file",
            "snapshot file grew beyond the safety limit while being read",
        ));
    }
    Ok(bytes)
}

fn path_hash(path: &Path) -> String {
    hex(&Sha256::digest(path.as_os_str().as_encoded_bytes())[..12])
}

fn is_revision(value: &str) -> bool {
    value.len() == 64 && value.bytes().all(|byte| byte.is_ascii_hexdigit())
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn validator(directory: &Path, success: bool) -> std::path::PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = directory.join(format!("validator-{}", Uuid::new_v4()));
        fs::write(
            &path,
            format!("#!/bin/sh\nexit {}\n", if success { 0 } else { 1 }),
        )
        .unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[cfg(unix)]
    #[test]
    fn new_config_creation_is_private_validated_and_never_overwrites() {
        use std::os::unix::fs::PermissionsExt;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("home");
        fs::create_dir(&root).unwrap();
        let executable = validator(directory.path(), true);
        let identity = ghostty::ExecutableIdentity::capture(&executable).unwrap();
        let target = root.join(".config/ghostty/config");

        assert!(validate_empty_config(&identity).unwrap().valid);
        let outcome = create_new_config(&target, &root).unwrap();
        assert_eq!(outcome.revision, revision(b""));
        assert_eq!(fs::read(&target).unwrap(), b"");
        assert_eq!(
            fs::metadata(&target).unwrap().permissions().mode() & 0o777,
            0o600
        );
        assert_eq!(
            fs::metadata(root.join(".config"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );
        assert_eq!(
            fs::metadata(root.join(".config/ghostty"))
                .unwrap()
                .permissions()
                .mode()
                & 0o777,
            0o700
        );

        let error = create_new_config(&target, &root).unwrap_err();
        assert_eq!(error.code, "config_already_exists");
        assert_eq!(fs::read(&target).unwrap(), b"");
    }

    #[cfg(unix)]
    #[test]
    fn new_config_verification_detects_external_changes_without_deleting_them() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("home");
        fs::create_dir(&root).unwrap();

        let edited_target = root.join(".config/ghostty/config");
        let edited_outcome = create_new_config(&edited_target, &root).unwrap();
        verify_created_config(&edited_target, &root, &edited_outcome).unwrap();
        fs::write(&edited_target, b"font-size = 15\n").unwrap();
        let error = verify_created_config(&edited_target, &root, &edited_outcome).unwrap_err();
        assert_eq!(error.code, "post_creation_conflict");
        assert_eq!(fs::read(&edited_target).unwrap(), b"font-size = 15\n");

        let replaced_target = root.join(".config/ghostty/config.ghostty");
        let replaced_outcome = create_new_config(&replaced_target, &root).unwrap();
        let replacement = root.join(".config/ghostty/replacement");
        fs::write(&replacement, b"").unwrap();
        fs::rename(&replacement, &replaced_target).unwrap();
        let error = verify_created_config(&replaced_target, &root, &replaced_outcome).unwrap_err();
        assert_eq!(error.code, "post_creation_conflict");
        assert_eq!(fs::read(&replaced_target).unwrap(), b"");
    }

    #[cfg(unix)]
    #[test]
    fn new_config_creation_refuses_symlinked_parents_and_outside_paths() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("home");
        let outside = directory.path().join("outside");
        fs::create_dir(&root).unwrap();
        fs::create_dir(&outside).unwrap();
        symlink(&outside, root.join(".config")).unwrap();

        let error = create_new_config(&root.join(".config/ghostty/config"), &root).unwrap_err();
        assert_eq!(error.code, "invalid_creation_parent");
        assert!(!outside.join("ghostty/config").exists());

        let error = create_new_config(&outside.join("ghostty/config"), &root).unwrap_err();
        assert_eq!(error.code, "creation_outside_approved_root");
    }

    #[cfg(unix)]
    #[test]
    fn failed_new_config_validation_leaves_no_target_file() {
        let directory = tempfile::tempdir().unwrap();
        let root = directory.path().join("home");
        fs::create_dir(&root).unwrap();
        let executable = validator(directory.path(), false);
        let identity = ghostty::ExecutableIdentity::capture(&executable).unwrap();
        let target = root.join(".config/ghostty/config");

        let validation = validate_empty_config(&identity).unwrap();
        assert!(!validation.valid);
        assert!(!target.exists());
    }

    #[test]
    fn atomic_write_detects_stale_revision_and_preserves_external_edit() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        fs::write(&target, b"font-size = 13\n").unwrap();
        let stale = revision(b"font-size = 12\n");
        let error = write_atomically(
            &target,
            b"font-size = 14\n",
            &stale,
            &directory.path().join("data"),
        )
        .unwrap_err();
        assert_eq!(error.code, "revision_conflict");
        assert_eq!(fs::read(&target).unwrap(), b"font-size = 13\n");
    }

    #[test]
    fn atomic_write_creates_snapshot_and_replaces_target() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let original = b"font-size = 13\n";
        fs::write(&target, original).unwrap();
        let outcome = write_atomically(
            &target,
            b"font-size = 14\n",
            &revision(original),
            &directory.path().join("data"),
        )
        .unwrap();
        assert_eq!(fs::read(&target).unwrap(), b"font-size = 14\n");
        assert_eq!(
            fs::read(
                directory
                    .path()
                    .join("data/snapshots")
                    .join(format!("{}.ghostty", outcome.snapshot_id)),
            )
            .unwrap(),
            original
        );
        let snapshots = list_snapshots(&directory.path().join("data"), &target).unwrap();
        assert_eq!(snapshots.len(), 1);
        assert_eq!(snapshots[0].id, outcome.snapshot_id);
        assert_eq!(
            read_snapshot(
                &directory.path().join("data"),
                &target,
                &outcome.snapshot_id,
            )
            .unwrap(),
            original
        );
    }

    #[test]
    fn replacement_is_fully_prepared_before_it_can_be_committed() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let original = b"font-size = 13\n";
        let candidate = b"font-size = 14\n";
        fs::write(&target, original).unwrap();

        let prepared = prepare_replacement(&target, candidate).unwrap();
        assert_eq!(fs::read(&target).unwrap(), original);
        commit_replacement(&target, prepared).unwrap();
        assert_eq!(fs::read(&target).unwrap(), candidate);
    }

    #[test]
    fn snapshot_ids_cannot_traverse_directories() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        fs::write(&target, b"font-size = 13\n").unwrap();
        let error = read_snapshot(directory.path(), &target, "../../secret").unwrap_err();
        assert_eq!(error.code, "invalid_snapshot_id");
    }

    #[cfg(unix)]
    #[test]
    fn atomic_write_refuses_hardlinked_targets_by_default() {
        let directory = tempfile::tempdir().unwrap();
        let target = directory.path().join("config");
        let alias = directory.path().join("config-alias");
        let original = b"font-size = 13\n";
        fs::write(&target, original).unwrap();
        fs::hard_link(&target, &alias).unwrap();

        let error = write_atomically(
            &target,
            b"font-size = 14\n",
            &revision(original),
            &directory.path().join("data"),
        )
        .unwrap_err();
        assert_eq!(error.code, "hardlink_confirmation_required");
        assert_eq!(fs::read(alias).unwrap(), original);
    }

    #[cfg(unix)]
    #[test]
    fn snapshot_content_cannot_be_replaced_by_a_symlink() {
        use std::os::unix::fs::symlink;

        let directory = tempfile::tempdir().unwrap();
        let data_root = directory.path().join("data");
        let target = directory.path().join("config");
        let outside = directory.path().join("outside");
        let original = b"font-size = 13\n";
        fs::write(&target, original).unwrap();
        fs::write(&outside, original).unwrap();
        let outcome = write_atomically(
            &target,
            b"font-size = 14\n",
            &revision(original),
            &data_root,
        )
        .unwrap();
        let snapshot_path = data_root
            .join("snapshots")
            .join(format!("{}.ghostty", outcome.snapshot_id));
        fs::remove_file(&snapshot_path).unwrap();
        symlink(&outside, &snapshot_path).unwrap();

        let error = read_snapshot(&data_root, &target, &outcome.snapshot_id).unwrap_err();
        assert_eq!(error.code, "invalid_snapshot_file");
    }
}
