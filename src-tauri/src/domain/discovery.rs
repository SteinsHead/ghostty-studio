use std::{
    collections::HashSet,
    env, fs,
    path::{Path, PathBuf},
};

use sha2::{Digest, Sha256};

use crate::models::ConfigCandidate;

pub fn discover_config_candidates() -> Vec<ConfigCandidate> {
    let Some(home) = env::var_os("HOME").map(PathBuf::from) else {
        return Vec::new();
    };
    let xdg_root = env::var_os("XDG_CONFIG_HOME")
        .map(PathBuf::from)
        .unwrap_or_else(|| home.join(".config"));

    let mut specifications = vec![
        (
            xdg_root.join("ghostty/config"),
            "XDG · config",
            "xdg",
            "legacy",
            0,
        ),
        (
            xdg_root.join("ghostty/config.ghostty"),
            "XDG · config.ghostty",
            "xdg",
            "ghostty",
            1,
        ),
    ];

    if cfg!(target_os = "macos") {
        let app_support = home.join("Library/Application Support/com.mitchellh.ghostty");
        specifications.extend([
            (
                app_support.join("config"),
                "macOS · config",
                "macos",
                "legacy",
                2,
            ),
            (
                app_support.join("config.ghostty"),
                "macOS · config.ghostty",
                "macos",
                "ghostty",
                3,
            ),
        ]);
    }

    specifications
        .into_iter()
        // ConfigCandidate crosses a JSON boundary as a UTF-8 string. Excluding
        // non-UTF-8 roots is safer than opening a different lossy path.
        .filter(|(path, ..)| candidate_path_supported(path))
        .map(|(path, label, source, format, priority)| {
            candidate(path, label, source, format, priority)
        })
        .collect()
}

fn candidate_path_supported(path: &Path) -> bool {
    path.to_str().is_some()
}

pub fn ghostty_executable_candidates() -> Vec<PathBuf> {
    let mut candidates = Vec::new();
    if cfg!(target_os = "macos") {
        candidates.push(PathBuf::from(
            "/Applications/Ghostty.app/Contents/MacOS/ghostty",
        ));
        if let Some(home) = env::var_os("HOME") {
            candidates
                .push(PathBuf::from(home).join("Applications/Ghostty.app/Contents/MacOS/ghostty"));
        }
    }
    if cfg!(target_os = "linux") {
        candidates.extend([
            PathBuf::from("/usr/bin/ghostty"),
            PathBuf::from("/usr/local/bin/ghostty"),
            PathBuf::from("/opt/ghostty/bin/ghostty"),
        ]);
    }
    // Search PATH only after platform-owned install locations. A desktop app
    // should not prefer an unrelated same-named executable from a modified PATH.
    if let Some(path) = env::var_os("PATH") {
        candidates.extend(env::split_paths(&path).map(|directory| directory.join("ghostty")));
    }

    let mut seen = HashSet::new();
    candidates
        .into_iter()
        .filter(|path| seen.insert(path.clone()))
        // GhosttyProbe is serialized as UTF-8 and later reopens this exact
        // executable. Reject lossy identities instead of running another path.
        .filter(|path| candidate_path_supported(path))
        .filter(|path| is_executable_file(path))
        .collect()
}

fn candidate(
    path: PathBuf,
    label: &str,
    source: &str,
    format: &str,
    priority: u8,
) -> ConfigCandidate {
    let symlink_metadata = fs::symlink_metadata(&path).ok();
    let metadata = fs::metadata(&path).ok();
    let exists = metadata.as_ref().is_some_and(|item| item.is_file());
    let symlink = symlink_metadata
        .as_ref()
        .is_some_and(|item| item.file_type().is_symlink());
    let writable = if exists {
        metadata
            .as_ref()
            .is_some_and(|item| permissions_allow_write(item.permissions()))
    } else {
        nearest_existing_parent(&path)
            .and_then(|parent| fs::metadata(parent).ok())
            .is_some_and(|item| permissions_allow_write(item.permissions()))
    };
    let path_string = path.to_string_lossy().to_string();
    ConfigCandidate {
        id: path_id(&path),
        label: label.to_string(),
        path: path_string,
        source: source.to_string(),
        format: format.to_string(),
        priority,
        exists,
        writable,
        symlink,
        size_bytes: metadata.map(|item| item.len()),
    }
}

fn nearest_existing_parent(path: &Path) -> Option<&Path> {
    let mut current = path.parent();
    while let Some(candidate) = current {
        if candidate.exists() {
            return Some(candidate);
        }
        current = candidate.parent();
    }
    None
}

fn path_id(path: &Path) -> String {
    let digest = Sha256::digest(path.as_os_str().as_encoded_bytes());
    format!("cfg-{}", hex(&digest[..12]))
}

fn hex(bytes: &[u8]) -> String {
    bytes.iter().map(|byte| format!("{byte:02x}")).collect()
}

fn is_executable_file(path: &Path) -> bool {
    let Ok(metadata) = fs::metadata(path) else {
        return false;
    };
    if !metadata.is_file() {
        return false;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        metadata.permissions().mode() & 0o111 != 0
    }
    #[cfg(not(unix))]
    {
        true
    }
}

fn permissions_allow_write(permissions: fs::Permissions) -> bool {
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        permissions.mode() & 0o222 != 0
    }
    #[cfg(not(unix))]
    {
        !permissions.readonly()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn path_ids_are_stable_and_do_not_disclose_the_path() {
        let path = Path::new("/Users/example/.config/ghostty/config");
        let first = path_id(path);
        assert_eq!(first, path_id(path));
        assert!(!first.contains("Users"));
        assert!(first.starts_with("cfg-"));
    }

    #[cfg(unix)]
    #[test]
    fn non_utf8_candidate_paths_never_cross_the_string_boundary() {
        use std::ffi::OsStr;
        use std::os::unix::ffi::OsStrExt;

        let path = Path::new(OsStr::from_bytes(b"/tmp/ghostty-\xff/config"));
        assert!(!candidate_path_supported(path));
    }
}
