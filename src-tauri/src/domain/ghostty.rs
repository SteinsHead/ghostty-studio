use std::{
    fs::{self, File},
    io::Read,
    path::{Path, PathBuf},
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant, SystemTime},
};

use sha2::{Digest, Sha256};

use crate::{domain::discovery::ghostty_executable_candidates, error::CommandError};

const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 512 * 1024;
const MAX_EXECUTABLE_BYTES: u64 = 256 * 1024 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ExecutableIdentity {
    canonical_path: PathBuf,
    size: u64,
    modified: Option<SystemTime>,
    digest: [u8; 32],
    #[cfg(unix)]
    device: u64,
    #[cfg(unix)]
    inode: u64,
}

impl ExecutableIdentity {
    pub fn capture(executable: &Path) -> Result<Self, CommandError> {
        let canonical_path = fs::canonicalize(executable).map_err(|_| {
            CommandError::new(
                "ghostty_identity_unavailable",
                "the installed Ghostty executable identity could not be resolved",
            )
        })?;
        Self::capture_canonical(canonical_path)
    }

    pub fn path(&self) -> &Path {
        &self.canonical_path
    }

    pub fn verify(&self) -> Result<(), CommandError> {
        let current = Self::capture_canonical(self.canonical_path.clone()).map_err(|_| {
            CommandError::new(
                "ghostty_runtime_changed",
                "the installed Ghostty executable changed; review the operation again",
            )
        })?;
        if &current == self {
            Ok(())
        } else {
            Err(CommandError::new(
                "ghostty_runtime_changed",
                "the installed Ghostty executable changed; review the operation again",
            ))
        }
    }

    fn capture_canonical(canonical_path: PathBuf) -> Result<Self, CommandError> {
        let mut file = File::open(&canonical_path).map_err(|_| {
            CommandError::new(
                "ghostty_identity_unavailable",
                "the installed Ghostty executable could not be opened for identity verification",
            )
        })?;
        let before = file.metadata().map_err(identity_io_error)?;
        require_bounded_regular_executable(&before)?;

        let mut digest = Sha256::new();
        let mut reader = file.by_ref().take(MAX_EXECUTABLE_BYTES.saturating_add(1));
        let mut buffer = [0_u8; 64 * 1024];
        let mut bytes_read = 0_u64;
        loop {
            let read = reader.read(&mut buffer).map_err(identity_io_error)?;
            if read == 0 {
                break;
            }
            digest.update(&buffer[..read]);
            bytes_read = bytes_read.saturating_add(read as u64);
        }
        if bytes_read != before.len() || bytes_read > MAX_EXECUTABLE_BYTES {
            return Err(CommandError::new(
                "ghostty_identity_unavailable",
                "the installed Ghostty executable changed while its identity was being read",
            ));
        }

        let after = file.metadata().map_err(identity_io_error)?;
        let visible = fs::metadata(&canonical_path).map_err(identity_io_error)?;
        let visible_canonical = fs::canonicalize(&canonical_path).map_err(identity_io_error)?;
        if visible_canonical != canonical_path
            || !same_file_metadata(&before, &after)
            || !same_file_metadata(&after, &visible)
        {
            return Err(CommandError::new(
                "ghostty_identity_unavailable",
                "the installed Ghostty executable changed while its identity was being read",
            ));
        }

        Ok(Self {
            canonical_path,
            size: after.len(),
            modified: after.modified().ok(),
            digest: digest.finalize().into(),
            #[cfg(unix)]
            device: unix_device(&after),
            #[cfg(unix)]
            inode: unix_inode(&after),
        })
    }
}

#[derive(Debug, Clone)]
pub struct ResolvedRuntime {
    pub identity: ExecutableIdentity,
    pub version: Option<String>,
    pub channel: Option<String>,
}

fn identity_io_error(_: std::io::Error) -> CommandError {
    CommandError::new(
        "ghostty_identity_unavailable",
        "the installed Ghostty executable identity could not be read",
    )
}

fn require_bounded_regular_executable(metadata: &fs::Metadata) -> Result<(), CommandError> {
    if !metadata.is_file() {
        return Err(CommandError::new(
            "ghostty_identity_unavailable",
            "the installed Ghostty executable is not a regular file",
        ));
    }
    if metadata.len() > MAX_EXECUTABLE_BYTES {
        return Err(CommandError::new(
            "ghostty_executable_too_large",
            "the installed Ghostty executable exceeds the identity verification limit",
        ));
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o111 == 0 {
            return Err(CommandError::new(
                "ghostty_identity_unavailable",
                "the installed Ghostty file is not executable",
            ));
        }
    }
    Ok(())
}

fn same_file_metadata(left: &fs::Metadata, right: &fs::Metadata) -> bool {
    if left.is_file() != right.is_file()
        || left.len() != right.len()
        || left.modified().ok() != right.modified().ok()
    {
        return false;
    }
    #[cfg(unix)]
    {
        unix_device(left) == unix_device(right) && unix_inode(left) == unix_inode(right)
    }
    #[cfg(not(unix))]
    {
        true
    }
}

#[cfg(unix)]
fn unix_device(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.dev()
}

#[cfg(unix)]
fn unix_inode(metadata: &fs::Metadata) -> u64 {
    use std::os::unix::fs::MetadataExt;
    metadata.ino()
}

#[derive(Debug)]
pub struct CommandOutput {
    pub success: bool,
    pub stdout: String,
    pub stderr: String,
    retryable_crash: bool,
}

#[derive(Debug)]
pub struct ValidationReport {
    pub valid: bool,
    pub diagnostics: Vec<String>,
}

pub fn locate() -> Option<std::path::PathBuf> {
    ghostty_executable_candidates().into_iter().next()
}

pub fn resolve() -> Result<ResolvedRuntime, CommandError> {
    let executable = locate().ok_or_else(|| {
        CommandError::new(
            "ghostty_unavailable",
            "a writable operation requires the installed Ghostty binary",
        )
    })?;
    let identity = ExecutableIdentity::capture(&executable)?;
    let output = run_with_transient_retry(&identity, &["--version"])?;
    if !output.success {
        return Err(CommandError::new(
            "ghostty_probe_failed",
            summarized_error(&output.stderr, "Ghostty did not return its version"),
        ));
    }
    let (version, channel) = parse_version_output(&output.stdout);
    Ok(ResolvedRuntime {
        identity,
        version,
        channel,
    })
}

fn parse_version_output(stdout: &str) -> (Option<String>, Option<String>) {
    let raw = stdout.trim().chars().take(4 * 1024).collect::<String>();
    let version = raw.lines().find_map(|line| {
        line.trim()
            .strip_prefix("Ghostty ")
            .map(|value| value.trim().to_string())
            .or_else(|| {
                line.trim()
                    .strip_prefix("- version:")
                    .map(|value| value.trim().to_string())
            })
    });
    let channel = raw.lines().find_map(|line| {
        line.trim()
            .strip_prefix("- channel:")
            .map(|value| value.trim().to_string())
    });
    (version, channel)
}

pub fn show_default_config_with_docs(
    executable: &ExecutableIdentity,
) -> Result<String, CommandError> {
    let output = run_with_transient_retry(executable, &["+show-config", "--default", "--docs"])?;
    if !output.success {
        return Err(CommandError::new(
            "ghostty_schema_failed",
            summarized_error(&output.stderr, "Ghostty did not return its default schema"),
        ));
    }
    Ok(output.stdout)
}

pub fn show_effective_config(executable: &ExecutableIdentity) -> Result<String, CommandError> {
    let output = run_with_transient_retry(executable, &["+show-config", "--changes-only=false"])?;
    if !output.success {
        return Err(CommandError::new(
            "ghostty_effective_config_failed",
            summarized_error(
                &format!("{}\n{}", output.stderr, output.stdout),
                "Ghostty did not return its effective startup configuration",
            ),
        ));
    }
    Ok(output.stdout)
}

pub fn validate_config(
    executable: &ExecutableIdentity,
    config_path: &Path,
) -> Result<ValidationReport, CommandError> {
    let path = config_path.to_string_lossy();
    let argument = format!("--config-file={path}");
    let output = run_with_transient_retry(executable, &["+validate-config", &argument])?;
    Ok(validation_report(output))
}

pub fn validate_default_config(
    executable: &ExecutableIdentity,
) -> Result<ValidationReport, CommandError> {
    let output = run_with_transient_retry(executable, &["+validate-config"])?;
    Ok(validation_report(output))
}

fn validation_report(output: CommandOutput) -> ValidationReport {
    if output.success {
        return ValidationReport {
            valid: true,
            diagnostics: vec!["已通过当前 Ghostty 二进制验证。".to_string()],
        };
    }

    let diagnostic_count = output
        .stderr
        .lines()
        .chain(output.stdout.lines())
        .filter(|line| !line.trim().is_empty())
        .filter(|line| !line.contains("SentryInitFailed"))
        .take(40)
        .count();
    ValidationReport {
        valid: false,
        diagnostics: if diagnostic_count == 0 {
            vec!["Ghostty 无法读取这份配置，但未提供具体原因。".to_string()]
        } else {
            vec![format!(
                "Ghostty 无法读取这份配置（发现 {diagnostic_count} 条问题）。为保护路径和配置值，详细信息未显示。"
            )]
        },
    }
}

fn run(executable: &Path, arguments: &[&str]) -> Result<CommandOutput, CommandError> {
    let mut child = Command::new(executable)
        .args(arguments)
        .env("NO_COLOR", "1")
        .stdin(Stdio::null())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .map_err(|error| {
            CommandError::new(
                "ghostty_spawn_failed",
                format!("failed to invoke the installed Ghostty binary: {error}"),
            )
        })?;

    let stdout = child
        .stdout
        .take()
        .ok_or_else(|| CommandError::new("ghostty_pipe_failed", "Ghostty stdout is unavailable"))?;
    let stderr = child
        .stderr
        .take()
        .ok_or_else(|| CommandError::new("ghostty_pipe_failed", "Ghostty stderr is unavailable"))?;
    let (stdout_sender, stdout_receiver) = mpsc::sync_channel(1);
    let (stderr_sender, stderr_receiver) = mpsc::sync_channel(1);
    thread::spawn(move || {
        let _ = stdout_sender.send(read_limited(stdout, MAX_STDOUT_BYTES));
    });
    thread::spawn(move || {
        let _ = stderr_sender.send(read_limited(stderr, MAX_STDERR_BYTES));
    });

    let started = Instant::now();
    let status = loop {
        if let Some(status) = child.try_wait()? {
            break status;
        }
        if started.elapsed() >= COMMAND_TIMEOUT {
            let _ = child.kill();
            let _ = child.wait();
            return Err(CommandError::new(
                "ghostty_timeout",
                "Ghostty did not finish within the 20 second safety limit",
            ));
        }
        thread::sleep(Duration::from_millis(10));
    };

    let (stdout, stdout_exceeded) = receive_reader(stdout_receiver)?;
    let (stderr, stderr_exceeded) = receive_reader(stderr_receiver)?;
    if stdout_exceeded || stderr_exceeded {
        return Err(CommandError::new(
            "ghostty_output_too_large",
            "Ghostty command output exceeded the safety limit",
        ));
    }
    #[cfg(unix)]
    let retryable_crash = {
        use std::os::unix::process::ExitStatusExt;
        status.code() == Some(139) || status.signal() == Some(11)
    };
    #[cfg(not(unix))]
    let retryable_crash = status.code() == Some(139);
    Ok(CommandOutput {
        success: status.success(),
        stdout: String::from_utf8_lossy(&stdout).into_owned(),
        stderr: String::from_utf8_lossy(&stderr).into_owned(),
        retryable_crash,
    })
}

fn run_with_transient_retry(
    executable: &ExecutableIdentity,
    arguments: &[&str],
) -> Result<CommandOutput, CommandError> {
    for attempt in 0..3 {
        executable.verify()?;
        let result = run(executable.path(), arguments);
        executable.verify()?;
        let output = result?;
        if !output.retryable_crash {
            return Ok(output);
        }
        if attempt == 2 {
            return Err(CommandError::new(
                "ghostty_helper_crashed",
                "Ghostty's configuration helper crashed repeatedly; the configuration result was not inferred",
            ));
        }
    }
    unreachable!("the retry loop always returns")
}

fn read_limited(reader: impl Read, limit: usize) -> Result<(Vec<u8>, bool), std::io::Error> {
    let mut bytes = Vec::with_capacity(limit.min(64 * 1024));
    reader.take((limit + 1) as u64).read_to_end(&mut bytes)?;
    let exceeded = bytes.len() > limit;
    bytes.truncate(limit);
    Ok((bytes, exceeded))
}

fn receive_reader(
    receiver: mpsc::Receiver<Result<(Vec<u8>, bool), std::io::Error>>,
) -> Result<(Vec<u8>, bool), CommandError> {
    receiver
        .recv_timeout(Duration::from_secs(1))
        .map_err(|_| {
            CommandError::new(
                "ghostty_pipe_timeout",
                "Ghostty output pipe did not close after the process exited",
            )
        })?
        .map_err(CommandError::from)
}

fn summarized_error(stderr: &str, fallback: &str) -> String {
    let diagnostic_count = stderr
        .lines()
        .filter(|line| !line.trim().is_empty() && !line.contains("SentryInitFailed"))
        .take(40)
        .count();
    if diagnostic_count == 0 {
        fallback.to_string()
    } else {
        format!("{fallback}（发现 {diagnostic_count} 条问题；为保护路径和配置值，详细信息未显示）")
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[cfg(unix)]
    fn test_executable(directory: &Path, body: &str) -> PathBuf {
        use std::os::unix::fs::PermissionsExt;

        let path = directory.join("ghostty-test");
        fs::write(&path, body).unwrap();
        fs::set_permissions(&path, fs::Permissions::from_mode(0o700)).unwrap();
        path
    }

    #[test]
    fn output_reader_enforces_its_byte_limit() {
        let (bytes, exceeded) = read_limited(&b"abcdef"[..], 4).unwrap();
        assert_eq!(bytes, b"abcd");
        assert!(exceeded);
    }

    #[test]
    fn diagnostic_summary_never_echoes_raw_output() {
        let secret = "env = TOKEN=super-secret\n/path/to/private/config";
        let summary = summarized_error(secret, "schema failed");
        assert!(summary.contains("2 条问题"));
        assert!(!summary.contains("super-secret"));
        assert!(!summary.contains("/path/to/private"));
    }

    #[cfg(unix)]
    #[test]
    fn executable_identity_detects_same_inode_content_changes() {
        let directory = tempfile::tempdir().unwrap();
        let executable = test_executable(directory.path(), "#!/bin/sh\nexit 0\n");
        let original = ExecutableIdentity::capture(&executable).unwrap();

        fs::write(&executable, "#!/bin/sh\nexit 1\n").unwrap();
        let changed = ExecutableIdentity::capture(&executable).unwrap();
        assert_eq!(original.size, changed.size);
        assert_eq!(original.device, changed.device);
        assert_eq!(original.inode, changed.inode);
        assert_ne!(original.digest, changed.digest);
        assert_eq!(
            original.verify().unwrap_err().code,
            "ghostty_runtime_changed"
        );
    }

    #[cfg(unix)]
    #[test]
    fn checked_spawn_detects_an_executable_that_changes_while_running() {
        let directory = tempfile::tempdir().unwrap();
        let executable = test_executable(
            directory.path(),
            "#!/bin/sh\nprintf '#!/bin/sh\\nexit 0\\n' > \"$0\"\nchmod 700 \"$0\"\nexit 0\n",
        );
        let identity = ExecutableIdentity::capture(&executable).unwrap();

        let error = validate_default_config(&identity).unwrap_err();
        assert_eq!(error.code, "ghostty_runtime_changed");
    }
}
