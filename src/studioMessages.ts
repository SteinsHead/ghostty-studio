import { textForLocale, type AppLocale } from "./i18n";
import type { ApplyResult, ChangePreview, DraftChange } from "./types";

type LocalizedMessage = readonly [zhCn: string, en: string];

const friendlyMessages: Record<string, LocalizedMessage> = {
  unknown_session: ["配置会话已过期，请重新打开应用。", "This configuration session has expired. Reopen the app to continue."],
  invalid_candidate: ["无法确认这个配置位置，请重新检查。", "This configuration location could not be verified. Check again."],
  unknown_candidate: ["这个配置位置已发生变化，请重新检查。", "This configuration location has changed. Check again."],
  state_poisoned: ["本地工作区暂时不可用，请重新启动应用。", "The local workspace is temporarily unavailable. Restart the app."],
  schema_not_loaded: ["可用设置尚未准备好，请重新检查。", "The available settings are not ready yet. Check again."],
  revision_conflict: ["配置已被其他应用修改。重新读取后再保存。", "Another app changed this configuration. Reload it before saving."],
  read_only_session: ["这份配置只能查看。请选择可写的位置。", "This configuration is read-only. Choose a writable location."],
  unknown_stage: ["检查结果已过期，请重新检查更改。", "This review has expired. Check the changes again."],
  stage_mismatch: ["检查结果与当前草稿不一致，请重新检查。", "The review no longer matches the draft. Check the changes again."],
  validation_failed: ["Ghostty 无法读取这份草稿，请按提示调整。", "Ghostty could not read this draft. Review the details and adjust it."],
  validation_failed_after_confirmation: ["Ghostty 无法读取这份草稿，文件没有保存。", "Ghostty could not read this draft, so nothing was saved."],
  setting_requires_specialized_editor: ["这项设置需要专用编辑方式，原配置没有改变。", "This setting needs a dedicated editor. The original configuration was preserved."],
  complex_setting_requires_editor: ["这项设置包含多项内容，需要专用编辑方式。", "This setting contains multiple values and needs a dedicated editor."],
  duplicate_setting_requires_editor: ["这项设置在文件中出现多次，请先在配置文件中整理。", "This setting appears more than once. Organize it in the configuration file first."],
  duplicate_change_key: ["草稿中同一设置出现了多次，请重新检查。", "The same setting appears more than once in the draft. Check it again."],
  existing_setting_value_invalid: ["现有值无法由安全编辑器确认，请在配置文件中处理。", "The existing value cannot be verified by the safe editor. Manage it in the configuration file."],
  review_projection_failed: ["部分修改无法安全显示，原配置没有改变。", "Some changes could not be displayed safely. The original configuration was preserved."],
  ghostty_contract_changed: ["Ghostty 已更新。设置已重新读取，请再次检查草稿。", "Ghostty was updated. Settings were reloaded; review the draft again."],
  ghostty_contract_read_only: ["当前 Ghostty 版本暂不支持编辑。", "Editing is unavailable for this Ghostty version."],
  ghostty_unavailable: ["没有找到 Ghostty，暂时无法保存。", "Ghostty was not found, so changes cannot be saved yet."],
  ghostty_probe_failed: ["无法确认 Ghostty 版本，编辑已暂停。", "The Ghostty version could not be verified, so editing was paused."],
  ghostty_identity_unavailable: ["无法确认 Ghostty 程序身份，编辑已暂停。", "The Ghostty executable could not be verified, so editing was paused."],
  ghostty_executable_too_large: ["Ghostty 程序超出安全校验范围，编辑已暂停。", "The Ghostty executable exceeds the identity-check limit, so editing was paused."],
  ghostty_runtime_changed: ["Ghostty 程序在检查期间发生变化，请重新读取后再试。", "The Ghostty executable changed during review. Reload it before trying again."],
  ghostty_runtime_changed_after_write: ["保存期间 Ghostty 程序发生变化，配置已恢复。请重新检查。", "The Ghostty executable changed during save, so the configuration was restored. Check again."],
  ghostty_runtime_change_rollback_failed: ["无法确认配置是否已恢复。编辑已暂停，请先重新读取。", "The configuration could not be confirmed as restored. Editing was paused; reload it first."],
  mutation_in_progress: ["另一项配置操作正在进行，请稍后再试。", "Another configuration task is in progress. Try again shortly."],
  native_confirmation_failed: ["无法打开系统确认窗口。", "The system confirmation dialog could not be opened."],
  native_confirmation_cancelled: ["操作已取消。", "The action was cancelled."],
  snapshot_requires_specialized_restore: ["这个恢复点包含当前版本无法自动还原的设置。", "This restore point contains settings this version cannot restore safely."],
  missing_config: ["配置文件不存在，请重新检查位置。", "The configuration file no longer exists. Check its location."],
  config_already_exists: ["目标位置已经有配置文件。为避免覆盖，请重新检查。", "A configuration file now exists at that location. Check again to avoid overwriting it."],
  existing_config_prevents_creation: ["已经存在默认配置，请选择它或手动管理其他位置。", "A default configuration already exists. Choose it or manage other locations manually."],
  config_creation_not_allowed: ["这个位置不满足安全创建条件，请手动创建后再检查。", "This location is not eligible for safe creation. Create it manually, then check again."],
  creation_outside_home: ["只能在用户目录内的 Ghostty 默认位置安全创建配置。", "Safe creation is limited to Ghostty's default locations in your home folder."],
  creation_outside_approved_root: ["只能在用户目录内的 Ghostty 默认位置安全创建配置。", "Safe creation is limited to Ghostty's default locations in your home folder."],
  relative_xdg_config_home: ["XDG_CONFIG_HOME 不是绝对路径，请修正或手动创建配置。", "XDG_CONFIG_HOME is not an absolute path. Fix it or create the configuration manually."],
  non_utf8_config_root: ["无法安全识别配置目录，自动创建已停用。", "The configuration folder could not be identified safely, so automatic creation is unavailable."],
  home_unavailable: ["无法确认用户目录，自动创建已停止。", "Your home folder could not be verified, so automatic creation was stopped."],
  invalid_creation_root: ["配置目录不满足安全要求，请手动创建后再检查。", "The configuration folder does not meet the safety requirements. Create it manually, then check again."],
  invalid_creation_parent: ["配置路径包含无法安全使用的目录，请选择其他位置。", "The configuration path contains a folder that cannot be used safely. Choose another location."],
  invalid_target: ["这个配置位置不满足安全创建要求。", "This configuration location does not meet the safety requirements."],
  candidate_changed: ["确认期间配置位置发生了变化。没有创建文件，请重新检查。", "The configuration location changed during confirmation. Nothing was created; check again."],
  baseline_validation_failed: ["Ghostty 的默认配置未通过验证，因此没有创建文件。", "Ghostty's default configuration did not pass validation, so no file was created."],
  config_creation_not_supported: ["当前平台不支持安全自动创建，请手动创建后再检查。", "Safe automatic creation is unavailable on this platform. Create the file manually, then check again."],
  config_creation_failed: ["无法安全创建配置文件，已有内容没有改变。", "The configuration file could not be created safely. Existing content was not changed."],
  post_creation_validation_failed: ["新配置未通过 Ghostty 验证。空文件已保留，请检查后手动处理。", "The new configuration did not pass Ghostty validation. The empty file was kept for manual review."],
  post_creation_conflict: ["新配置随即被其他应用修改。较新的文件已保留，请重新检查。", "Another app changed the new configuration. The newer file was preserved; check again."],
  post_creation_unverified: ["配置可能已经创建，但无法确认最终状态。请重新检查。", "The configuration may have been created, but its final state could not be verified. Check again."],
  post_creation_rollback_failed: ["无法确认新配置是否已安全撤回。请先重新检查，不要重复创建。", "The new configuration could not be confirmed as reverted. Check again before retrying."],
  creation_rollback_failed: ["无法确认空配置是否已撤回。请重新检查。", "The empty configuration could not be confirmed as reverted. Check again."],
  config_too_large: ["配置文件超过安全读取上限，应用不会继续处理。", "The configuration exceeds the safe read limit and will not be processed."],
  invalid_encoding: ["配置文件不是有效的 UTF-8，应用不会改写它。", "The configuration is not valid UTF-8 and will not be rewritten."],
  io_error: ["本地文件操作没有完成。请重新检查实际状态。", "The local file operation did not complete. Check the current state."],
  ghostty_schema_failed: ["无法读取 Ghostty 的可用设置，请检查安装。", "Ghostty's available settings could not be read. Check the installation."],
  ghostty_spawn_failed: ["无法启动 Ghostty 验证，请检查安装。", "Ghostty validation could not start. Check the installation."],
  ghostty_pipe_failed: ["无法安全读取 Ghostty 的验证结果。", "Ghostty's validation result could not be read safely."],
  ghostty_pipe_timeout: ["读取 Ghostty 验证结果超时，操作已停止。", "Reading Ghostty's validation result timed out. The operation was stopped."],
  ghostty_timeout: ["Ghostty 验证超时，操作已停止。", "Ghostty validation timed out. The operation was stopped."],
  ghostty_output_too_large: ["Ghostty 返回的验证结果过大，操作已停止。", "Ghostty returned too much validation output. The operation was stopped."],
  ghostty_effective_config_failed: ["无法读取 Ghostty 的最终配置，因此没有保存。", "Ghostty's final configuration could not be read, so nothing was saved."],
  ghostty_helper_crashed: ["Ghostty 的配置检查进程连续异常退出，因此没有保存。", "Ghostty's configuration helper repeatedly exited unexpectedly, so nothing was saved."],
  change_would_be_overridden: ["这些修改会被后续配置覆盖。请选择提示的生效来源。", "A later configuration source would override these changes. Choose the suggested effective source."],
  effective_source_unverified: ["无法确认最终生效来源，因此没有保存。", "The effective source could not be verified, so nothing was saved."],
  effective_sources_changed: ["检查期间配置来源发生了变化。草稿仍在，请重新检查。", "Configuration sources changed during review. Your draft remains; check again."],
  effective_value_mismatch: ["写入内容没有进入 Ghostty 的最终配置，文件已恢复。请选择正确的生效来源。", "The written values did not reach Ghostty's final configuration. The file was restored; choose the correct effective source."],
  post_write_effect_verification_failed: ["保存后无法确认最终生效值，文件已恢复。草稿仍在。", "The effective values could not be confirmed after saving. The file was restored and your draft remains."],
  post_write_effect_rollback_failed: ["无法确认文件是否已安全恢复。编辑已暂停，请先重新读取配置。", "The file could not be confirmed as restored safely. Editing was paused; reload the configuration first."],
  no_effective_changes: ["草稿没有改变这份配置。", "The draft does not change this configuration."],
  post_validation_conflict: ["验证期间配置被其他应用修改。外部修改已保留，请重新检查。", "Another app changed the configuration during validation. Its changes were preserved; check again."],
  post_validation_unverified: ["写入后的文件状态无法确认，编辑已暂停。请重新读取配置。", "The file could not be verified after writing, so editing was paused. Reload the configuration."],
  invalid_setting_value: ["这个值不符合设置格式。", "This value does not match the setting's format."],
  value_out_of_range: ["这个数值超出了可用范围。", "This value is outside the allowed range."],
  invalid_locale: ["界面语言无效，请重新选择。", "The interface language is invalid. Choose it again."],
  app_data_unavailable: ["无法打开本地资料目录。", "The local data folder is unavailable."],
  background_library_unavailable: ["图片库暂时不可用。", "The image library is temporarily unavailable."],
  background_library_too_large: ["图片库项目过多，请先整理。", "The image library contains too many items."],
  background_library_full: ["图片库已达到容量上限。", "The image library has reached its capacity."],
  background_picker_failed: ["无法打开系统图片选择器。", "The system image picker could not be opened."],
  background_store_unavailable: ["图片库正在处理另一项操作，请稍后重试。", "The image library is finishing another operation. Try again shortly."],
  background_import_batch_too_large: ["一次最多选择 20 张图片。", "Choose no more than 20 images at once."],
  background_asset_changed: ["图库中的图片已发生变化，请重新导入。", "This library image changed. Import it again."],
  background_asset_corrupt: ["图库中的图片无法读取，请重新导入。", "This library image could not be read. Import it again."],
  background_asset_in_use: ["这张图片仍被 Ghostty 配置引用。请在“写入位置”查看来源，切换并保存后再删除。", "This image is still referenced. Check Write locations, switch it there, save, then delete it."],
  background_asset_usage_unknown: ["配置来源尚未完整确认，因此没有删除。请重新读取后再试。", "Configuration sources are not fully verified, so the image was not deleted. Reload and try again."],
  background_asset_remove_failed: ["没有完整删除这张图片，请重试。", "The image was not fully removed. Try again."],
  invalid_background_selection: ["请选择图片库中的图片。", "Choose an image from the library."],
  background_draft_changed: ["背景图片已在其他位置改变，请重新读取后再试。", "The background image changed elsewhere. Reload and try again."],
};

const browserMessages: Record<string, LocalizedMessage> = {
  "浏览器演示模式不会创建本地配置文件": ["试用模式不会创建本地配置文件。", "Try mode does not create local configuration files."],
  "浏览器演示模式禁止写入本地配置": ["试用模式不会写入本地配置。", "Try mode does not write local configuration files."],
  "浏览器演示模式只展示示例快照，禁止恢复本地配置": ["试用模式只能查看示例恢复点。", "Try mode only shows sample restore points."],
};

const backgroundImportMessages: Record<string, LocalizedMessage> = {
  background_image_unsupported_format: ["Ghostty 目前只支持 PNG 和 JPEG。", "Ghostty currently supports PNG and JPEG images."],
  background_image_corrupt: ["图片内容不完整或已经损坏。", "The image is incomplete or damaged."],
  background_image_dimensions_too_large: ["图片超过 8192 像素边长或 3200 万像素限制。", "The image exceeds the 8192 px edge or 32 megapixel limit."],
  background_image_too_large: ["图片文件超过 32 MB 限制。", "The image exceeds the 32 MB limit."],
  background_image_unreadable: ["无法安全读取这张图片。", "This image could not be read safely."],
  background_image_changed: ["读取期间图片发生了变化，请重试。", "The image changed while it was being read. Try again."],
  background_library_full: ["图片库已达到容量上限。", "The image library has reached its capacity."],
};

export function savedNotice(
  locale: AppLocale,
  activation: ApplyResult["activation"],
  effectiveStatus: ApplyResult["effectiveStatus"],
  target?: string,
): string {
  if (effectiveStatus === "unverified") {
    return textForLocale(locale, "已保存，但生效状态未确认。请重新检查。", "Saved, but the effective state could not be verified. Check again.");
  }
  const saved = effectiveStatus === "resolved"
    ? textForLocale(locale, "已保存；移除的设置将继承其他配置或默认值。", "Saved. Removed settings will inherit another source or the default. ")
    : target
      ? textForLocale(locale, `已保存到 ${target}。`, `Saved to ${target}. `)
      : textForLocale(locale, "已保存。", "Saved. ");
  if (activation === "restart") {
    return `${saved}${textForLocale(locale, "重启 Ghostty 后生效。", "Restart Ghostty to apply.")}`;
  }
  if (activation === "reload-new-terminal") {
    return `${saved}${textForLocale(locale, "重新载入后，新终端生效。", "Reload Ghostty; new terminals will use the changes.")}`;
  }
  if (activation === "reload") {
    return `${saved}${textForLocale(locale, "重新载入 Ghostty 后生效。", "Reload Ghostty to apply.")}`;
  }
  return `${saved}${textForLocale(locale, "请在 Ghostty 中确认效果。", "Check the result in Ghostty.")}`;
}

export function errorCode(error: unknown): string | null {
  if (error && typeof error === "object" && "code" in error) {
    const code = (error as { code?: unknown }).code;
    return typeof code === "string" ? code : null;
  }
  return null;
}

export function errorMessage(locale: AppLocale, error: unknown): string {
  const code = errorCode(error);
  if (code && friendlyMessages[code]) {
    const [zhCn, en] = friendlyMessages[code];
    return textForLocale(locale, zhCn, en);
  }
  const rawMessage = error instanceof Error
    ? error.message
    : typeof error === "string"
      ? error
      : null;
  if (rawMessage && browserMessages[rawMessage]) {
    const [zhCn, en] = browserMessages[rawMessage];
    return textForLocale(locale, zhCn, en);
  }
  return textForLocale(locale, "操作失败，草稿已保留。请重新检查。", "Action failed. Your draft is preserved. Check again.");
}

export function backgroundImportFailure(locale: AppLocale, code: string): string {
  const [zhCn, en] = backgroundImportMessages[code] ?? ["这张图片无法导入。", "This image could not be imported."];
  return textForLocale(locale, zhCn, en);
}

export function matchesMutationUncertainty(code: string | null): boolean {
  return code === "post_commit_conflict"
    || code === "post_commit_unverified"
    || code === "post_validation_conflict"
    || code === "post_validation_unverified"
    || code === "post_write_validation_rollback_failed"
    || code === "post_write_effect_rollback_failed"
    || code === "post_restore_validation_rollback_failed"
    || code === "ghostty_runtime_changed_after_write"
    || code === "ghostty_runtime_change_rollback_failed";
}

export function unverifiedChangeEffect(changes: DraftChange[]): ChangePreview["effect"] {
  return {
    status: "unverified",
    affectedKeys: changes.map((change) => change.key),
    suggestedCandidateId: null,
    suggestedLabel: null,
  };
}
