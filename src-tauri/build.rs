fn main() {
    const COMMANDS: &[&str] = &[
        "probe_environment",
        "load_runtime_schema",
        "load_config_graph",
        "list_background_assets",
        "choose_background_images",
        "get_background_asset_preview",
        "delete_background_asset",
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
