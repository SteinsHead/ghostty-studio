use std::{
    io::Read,
    path::Path,
    process::{Command, Stdio},
    sync::mpsc,
    thread,
    time::{Duration, Instant},
};

use crate::{
    domain::discovery::ghostty_executable_candidates, error::CommandError, models::GhosttyProbe,
};

const MAX_STDOUT_BYTES: usize = 4 * 1024 * 1024;
const MAX_STDERR_BYTES: usize = 512 * 1024;
const COMMAND_TIMEOUT: Duration = Duration::from_secs(20);

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

pub fn probe() -> GhosttyProbe {
    let Some(executable) = locate() else {
        return GhosttyProbe {
            available: false,
            executable_path: None,
            version: None,
            channel: None,
            raw_version: None,
        };
    };
    match run_with_transient_retry(&executable, &["--version"]) {
        Ok(output) if output.success => {
            let raw = output
                .stdout
                .trim()
                .chars()
                .take(4 * 1024)
                .collect::<String>();
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
            GhosttyProbe {
                available: true,
                executable_path: Some(executable.to_string_lossy().to_string()),
                version,
                channel,
                raw_version: Some(raw),
            }
        }
        _ => GhosttyProbe {
            available: false,
            executable_path: Some(executable.to_string_lossy().to_string()),
            version: None,
            channel: None,
            raw_version: None,
        },
    }
}

pub fn show_default_config_with_docs(executable: &Path) -> Result<String, CommandError> {
    let output = run_with_transient_retry(executable, &["+show-config", "--default", "--docs"])?;
    if !output.success {
        return Err(CommandError::new(
            "ghostty_schema_failed",
            summarized_error(&output.stderr, "Ghostty did not return its default schema"),
        ));
    }
    Ok(output.stdout)
}

pub fn show_effective_config(executable: &Path) -> Result<String, CommandError> {
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
    executable: &Path,
    config_path: &Path,
) -> Result<ValidationReport, CommandError> {
    let path = config_path.to_string_lossy();
    let argument = format!("--config-file={path}");
    let output = run_with_transient_retry(executable, &["+validate-config", &argument])?;
    Ok(validation_report(output))
}

pub fn validate_default_config(executable: &Path) -> Result<ValidationReport, CommandError> {
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
    executable: &Path,
    arguments: &[&str],
) -> Result<CommandOutput, CommandError> {
    for attempt in 0..3 {
        let output = run(executable, arguments)?;
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
}
