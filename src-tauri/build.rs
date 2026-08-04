fn main() {
    const COMMANDS: &[&str] = &[
        "probe_environment",
        "load_runtime_schema",
        "inspect_extension_manifest",
        "load_config_graph",
        "open_config",
        "create_config",
        "stage_changes",
        "apply_changes",
        "list_snapshots",
        "restore_snapshot",
    ];

    tauri_build::try_build(
        tauri_build::Attributes::new()
            .app_manifest(tauri_build::AppManifest::new().commands(COMMANDS)),
    )
    .expect("failed to generate Tauri context");
}
