import { BookOpen, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import { copyForSetting } from "../settingCopy";
import type { ConfiguredSetting, RuntimeOption, SettingActivation } from "../types";
import { isGenericallyEditable } from "../productModel";
import { localizedSettingChoice } from "../settingChoices";
import { Disclosure } from "./Disclosure";

interface ReferenceSettingRowProps {
  option: RuntimeOption;
  configured?: ConfiguredSetting;
  readOnly?: boolean;
  onAdjust?(option: RuntimeOption): void;
}

function activationLabel(locale: AppLocale, activation: SettingActivation): string | null {
  if (activation === "restart") {
    return locale === "zh-CN" ? "重启 Ghostty 后" : "after restarting Ghostty";
  }
  if (activation === "reload-new-terminal") {
    return locale === "zh-CN" ? "重新载入后，在新终端中" : "in new terminals after reloading Ghostty";
  }
  if (activation === "reload") {
    return locale === "zh-CN" ? "重新载入 Ghostty 后" : "after reloading Ghostty";
  }
  return null;
}

function restrictionLabel(locale: AppLocale, option: RuntimeOption): string {
  const chinese = locale === "zh-CN";
  switch (option.capability.reason) {
    case "needs-list-editor":
    case "needs-theme-picker":
    case "needs-editor":
      return chinese ? "在配置文件中调整" : "Edit in config file";
    case "protected":
      return chinese ? "敏感设置" : "Sensitive setting";
    case "advanced-setting":
      return chinese ? "需要专用编辑器" : "Needs a dedicated editor";
    case "platform-unavailable":
      return option.platform
        ? (chinese ? `仅适用于 ${option.platform}` : `${option.platform} only`)
        : (chinese ? "不适用于当前系统" : "Unavailable on this system");
    case "version-not-supported":
      return chinese ? "当前版本只读" : "Read only in this version";
    case "setting-changed":
      return chinese ? "设置已变化" : "Changed in update";
    case "unrecognized-setting":
      return chinese ? "需要检查" : "Needs review";
    default:
      return chinese ? "在配置文件中调整" : "Edit in config file";
  }
}

function restrictionDescription(locale: AppLocale, option: RuntimeOption): string {
  const chinese = locale === "zh-CN";
  switch (option.capability.reason) {
    case "needs-list-editor":
      return chinese
        ? "包含多个有序值，请在配置文件中编辑。"
        : "This is an ordered list. Edit it in the config file.";
    case "needs-theme-picker":
      return chinese
        ? "可分别设置浅色与深色主题，请在配置文件中编辑。"
        : "Light and dark themes can be set separately. Edit them in the config file.";
    case "protected":
      return chinese
        ? "可能包含命令、路径或隐私信息，请在配置文件中编辑。"
        : "This may contain commands, paths, or private data. Edit it in the config file.";
    case "advanced-setting":
    case "needs-editor":
      return chinese
        ? "需要专用编辑器，暂不支持。"
        : "A dedicated editor is required and not yet available.";
    case "platform-unavailable":
      return option.platform
        ? (chinese ? `这个设置仅适用于 ${option.platform}。` : `This setting is available only on ${option.platform}.`)
        : (chinese ? "这个设置不适用于当前系统。" : "This setting is not available on this system.");
    case "version-not-supported":
      return chinese
        ? "当前版本暂不支持编辑。"
        : "Editing is unavailable for this version.";
    case "setting-changed":
      return chinese
        ? "该设置已在 Ghostty 更新中发生变化，暂不可编辑。"
        : "This setting changed in a Ghostty update and is temporarily read-only.";
    case "unrecognized-setting":
      return chinese
        ? "Ghostty 当前不认识这个配置名。它可能来自旧版本、扩展，也可能存在拼写错误。"
        : "Ghostty does not recognize this key. It may come from an older version, an extension, or a typo.";
    default:
      return chinese
        ? "请在配置文件中编辑。"
        : "Edit this in the config file.";
  }
}

export function ReferenceSettingRow({
  option,
  configured,
  readOnly = false,
  onAdjust,
}: ReferenceSettingRowProps) {
  const { locale, text } = useI18n();
  const copy = copyForSetting(locale, option.key, option.description);
  const duplicated = (configured?.occurrenceCount ?? 0) > 1;
  const blockedByWorkspace = readOnly && isGenericallyEditable(option);
  const preservedValue = configured?.valueExposure === "protected";
  const editable = isGenericallyEditable(option) && !duplicated && !readOnly && !preservedValue;
  const activation = activationLabel(locale, option.capability.activation);
  const detail = copy.detail && copy.detail !== copy.summary ? copy.detail : null;
  const protectedValue = option.capability.reason === "protected";

  return (
    <article id={`setting-${option.key}`} className="reference-setting-row" tabIndex={-1}>
      <div className="reference-setting-row__copy">
        <div className="setting-title">
          <strong className="setting-label">{copy.label}</strong>
          {!editable && (
            <span className="reference-status">
              <BookOpen size={12} />
              {duplicated
                ? text("多处设置", "Set more than once")
                : blockedByWorkspace
                  ? text("配置只读", "Read only")
                  : restrictionLabel(locale, option)}
            </span>
          )}
        </div>
        {copy.summary && <p className="setting-summary">{copy.summary}</p>}
        <code className="reference-setting-row__key">{option.key}</code>
      </div>

      <div className="reference-setting-row__state">
        <div>
          {configured ? (
            <strong>
              {configured.occurrenceCount > 1
                ? text(
                    `这份文件中出现了 ${configured.occurrenceCount} 次`,
                    `Set ${configured.occurrenceCount} times in this file`,
                  )
                : text("这份文件已设置", "Set in this file")}
            </strong>
          ) : (
            <span>
              {text("默认：", "Default: ")}
              {option.defaultValues.length > 0
                ? option.defaultValues
                  .map((value) => value === ""
                    ? text("未设置", "Not set")
                    : localizedSettingChoice(locale, option.key, value))
                  .join(", ")
                : text("未设置", "Not set")}
            </span>
          )}
          {configured?.valueExposure === "protected" && (
            <small>
              {protectedValue
                ? text("内容已隐藏", "Value hidden")
                : text("原值已保留", "Original value preserved")}
            </small>
          )}
        </div>
        {editable && onAdjust && (
          <button
            type="button"
            aria-label={text(`调整${copy.label}`, `Adjust ${copy.label}`)}
            onClick={() => onAdjust(option)}
          >
            <SlidersHorizontal size={13} />
            {text("调整", "Adjust")}
          </button>
        )}
      </div>

      <Disclosure
        className="reference-setting-row__details"
        summary={<><ChevronRight size={13} /> {text("详情", "Details")}</>}
        summaryLabel={text(`查看${copy.label}说明`, `About ${copy.label}`)}
        bodyClassName="reference-setting-row__body"
      >
        {detail && (
          <details className="setting-official-detail">
            <summary>{text("Ghostty 原文", "Ghostty documentation")}</summary>
            <p>{detail}</p>
          </details>
        )}
        {!editable && (
          <p>
            {duplicated
              ? text(
                  "请在配置文件中合并或编辑这些值。",
                  "Merge or edit these values in the configuration file.",
                )
              : blockedByWorkspace
                ? text(
                    "选择可写配置后即可调整。",
                    "Choose a writable configuration to edit this setting.",
                  )
                : restrictionDescription(locale, option)}
          </p>
        )}
        {activation && (
          <p>{text(`更改会在${activation}生效。`, `Changes take effect ${activation}.`)}</p>
        )}
        {option.platform && option.capability.reason !== "platform-unavailable" && (
          <p>{text(`适用于 ${option.platform}。`, `Available on ${option.platform}.`)}</p>
        )}
      </Disclosure>
    </article>
  );
}
