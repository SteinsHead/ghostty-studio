import { BookOpen, ChevronRight, SlidersHorizontal } from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import { copyForSetting } from "../settingCopy";
import type { ConfiguredSetting, RuntimeOption, SettingActivation } from "../types";
import { isGenericallyEditable } from "../productModel";
import { localizedSettingChoice } from "../settingChoices";

interface ReferenceSettingRowProps {
  option: RuntimeOption;
  configured?: ConfiguredSetting;
  effectiveValueKnown: boolean;
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
      return chinese ? "等待版本适配" : "Version support pending";
    case "setting-changed":
      return chinese ? "更新后待确认" : "Review after update";
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
        ? "这个设置可以包含多项，并且顺序会影响结果。Studio 会保留现有内容。"
        : "This setting can contain an ordered list. Studio will preserve the existing entries.";
    case "needs-theme-picker":
      return chinese
        ? "主题可以分别指定浅色与深色版本。专用主题选择器完成前，请在配置文件中调整。"
        : "Themes can define separate light and dark variants. Edit this in the config file until the theme picker is ready.";
    case "protected":
      return chinese
        ? "它可能包含命令、路径或隐私信息，因此不会在普通控件中显示或改写。"
        : "This setting may contain commands, paths, or private data, so Studio will not expose or rewrite it here.";
    case "advanced-setting":
      return chinese
        ? "它需要专门的编辑方式。Studio 会保留现有内容。"
        : "This setting needs a dedicated editor. Studio will preserve the existing value.";
    case "platform-unavailable":
      return option.platform
        ? (chinese ? `这个设置仅适用于 ${option.platform}。` : `This setting is available only on ${option.platform}.`)
        : (chinese ? "这个设置不适用于当前系统。" : "This setting is not available on this system.");
    case "version-not-supported":
      return chinese
        ? "当前 Ghostty 版本尚未支持在 Studio 中安全调整这个设置。"
        : "This Ghostty version is not yet supported for safe editing in Studio.";
    case "setting-changed":
      return chinese
        ? "Ghostty 最近改变了这个设置。确认新行为后，Studio 会重新开放编辑。"
        : "Ghostty recently changed this setting. Editing will return after its new behavior is verified.";
    case "unrecognized-setting":
      return chinese
        ? "Ghostty 当前不认识这个配置名。它可能来自旧版本、扩展，也可能存在拼写错误。"
        : "Ghostty does not recognize this key. It may come from an older version, an extension, or a typo.";
    default:
      return chinese
        ? "这个设置需要更合适的编辑方式，目前请在配置文件中调整。"
        : "This setting needs a more suitable editor. For now, edit it in the config file.";
  }
}

export function ReferenceSettingRow({
  option,
  configured,
  effectiveValueKnown,
  readOnly = false,
  onAdjust,
}: ReferenceSettingRowProps) {
  const { locale, text } = useI18n();
  const copy = copyForSetting(locale, option.key, option.description);
  const duplicated = (configured?.occurrenceCount ?? 0) > 1;
  const blockedByWorkspace = readOnly && isGenericallyEditable(option);
  const editable = isGenericallyEditable(option) && !duplicated && !readOnly;
  const activation = activationLabel(locale, option.capability.activation);
  const detail = copy.detail && copy.detail !== copy.summary ? copy.detail : null;
  const protectedValue = option.capability.reason === "protected";

  return (
    <article className="reference-setting-row">
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
                : text("Studio 会保留原值", "Studio will preserve the value")}
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

      <details className="reference-setting-row__details">
        <summary aria-label={text(`查看${copy.label}说明`, `About ${copy.label}`)}>
          <ChevronRight size={13} /> {text("详情", "Details")}
        </summary>
        <div>
          {detail && <p>{detail}</p>}
          {!editable && (
            <p>
              {duplicated
                ? text(
                    `这个配置名在文件中出现了 ${configured?.occurrenceCount} 次。为避免修改错误的位置，Studio 会保留现有内容。`,
                    `This key appears ${configured?.occurrenceCount} times in the file. Studio will preserve every entry to avoid changing the wrong one.`,
                  )
                : blockedByWorkspace
                  ? text(
                      "切换到可写的配置位置后，即可在 Studio 中调整。",
                      "Switch to a writable configuration file to adjust this setting in Studio.",
                    )
                  : restrictionDescription(locale, option)}
            </p>
          )}
          {activation && (
            <p>{text(`更改会在${activation}生效。`, `Changes take effect ${activation}.`)}</p>
          )}
          {option.platform && (
            <p>{text(`适用于 ${option.platform}。`, `Available on ${option.platform}.`)}</p>
          )}
          {!effectiveValueKnown && configured && (
            <p>{text("其他配置文件可能覆盖这里的设置。", "Another configuration file may override this setting.")}</p>
          )}
        </div>
      </details>
    </article>
  );
}
