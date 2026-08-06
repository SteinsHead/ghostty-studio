import { useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent } from "react";
import {
  AlertTriangle,
  Check,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  LoaderCircle,
  LockKeyhole,
  Shuffle,
  Trash2,
  X,
} from "lucide-react";
import { useI18n } from "../i18n";
import {
  assetIdFromBackgroundValue,
  BACKGROUND_IMAGE_SETTING_KEYS,
  EXTERNAL_BACKGROUND_TOKEN,
  RESET_BACKGROUND_TOKEN,
} from "../backgroundImageModel";
import { localizedSettingChoice } from "../settingChoices";
import type {
  BackgroundAssetSummary,
  BackgroundPreviewState,
  RuntimeOption,
  SettingEffect,
} from "../types";

const FITS = ["contain", "cover", "stretch", "none"] as const;
const POSITIONS = [
  "top-left", "top-center", "top-right",
  "center-left", "center", "center-right",
  "bottom-left", "bottom-center", "bottom-right",
] as const;
const INITIAL_LIBRARY_SIZE = 12;

interface BackgroundImageEditorProps {
  assets: BackgroundAssetSummary[];
  previewStates: Record<string, BackgroundPreviewState>;
  value: string;
  baselineValue: string;
  effectiveValue: string;
  values: Record<string, string>;
  baselineValues: Record<string, string>;
  effectiveValues: Record<string, string>;
  options: Map<string, RuntimeOption>;
  disabled: boolean;
  desktop: boolean;
  importing: boolean;
  deletingAssetId: string | null;
  feedback: string | null;
  showInactivePreferences: boolean;
  effectiveKnown: boolean;
  effects: Record<string, SettingEffect>;
  writableCandidateIds: string[];
  onImport(): void;
  onPreviewRequest(assetId: string, retry?: boolean): Promise<void>;
  onSelect(assetId: string): void;
  onDelete(assetId: string): void;
  onRemove(): void;
  onInspectReferences(): void;
  onChange(key: string, value: string): void;
  onUseEffectiveSource?(candidateId: string): void;
}

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

function opacityValue(value: string): number {
  const parsed = Number(value);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 1;
}

function moveRadioSelection(
  event: KeyboardEvent<HTMLButtonElement>,
  currentIndex: number,
  total: number,
  columns: number,
  onMove: (nextIndex: number) => void,
) {
  let nextIndex = currentIndex;
  switch (event.key) {
    case "ArrowLeft":
      nextIndex = Math.max(0, currentIndex - 1);
      break;
    case "ArrowRight":
      nextIndex = Math.min(total - 1, currentIndex + 1);
      break;
    case "ArrowUp":
      nextIndex = Math.max(0, currentIndex - columns);
      break;
    case "ArrowDown":
      nextIndex = Math.min(total - 1, currentIndex + columns);
      break;
    case "Home":
      nextIndex = 0;
      break;
    case "End":
      nextIndex = total - 1;
      break;
    default:
      return;
  }

  event.preventDefault();
  if (nextIndex === currentIndex) return;
  onMove(nextIndex);
  const radios = event.currentTarget
    .closest<HTMLElement>("[role='radiogroup']")
    ?.querySelectorAll<HTMLButtonElement>("button[role='radio']");
  radios?.[nextIndex]?.focus();
}

export function BackgroundImageEditor({
  assets,
  previewStates,
  value,
  baselineValue,
  effectiveValue,
  values,
  baselineValues,
  effectiveValues,
  options,
  disabled,
  desktop,
  importing,
  deletingAssetId,
  feedback,
  showInactivePreferences,
  effectiveKnown,
  effects,
  writableCandidateIds,
  onImport,
  onPreviewRequest,
  onSelect,
  onDelete,
  onRemove,
  onInspectReferences,
  onChange,
  onUseEffectiveSource,
}: BackgroundImageEditorProps) {
  const { locale, text } = useI18n();
  const imageSelectionModified = value !== baselineValue;
  const displayedValue = imageSelectionModified || !effectiveKnown
    ? value
    : effectiveValue;
  const selectedId = assetIdFromBackgroundValue(displayedValue);
  const baselineId = assetIdFromBackgroundValue(baselineValue);
  const effectiveId = assetIdFromBackgroundValue(effectiveValue);
  const selected = assets.find((asset) => asset.id === selectedId) ?? null;
  const selectedPreviewState = selectedId ? previewStates[selectedId] : null;
  const selectedPreview = selectedPreviewState?.status === "ready"
    ? selectedPreviewState.dataUrl
    : null;
  const selectedPreviewFailed = selectedPreviewState?.status === "error";
  const external = displayedValue === EXTERNAL_BACKGROUND_TOKEN;
  const resetting = value === RESET_BACKGROUND_TOKEN;
  const modified = value !== baselineValue
    || ["background-image-opacity", "background-image-fit", "background-image-position", "background-image-repeat"]
      .some((key) => values[key] !== baselineValues[key]);
  const displayedSetting = (key: string, fallback: string) => (
    values[key] !== baselineValues[key]
      ? values[key]
      : effectiveKnown
        ? effectiveValues[key] ?? values[key] ?? fallback
        : values[key] ?? fallback
  );
  const opacity = opacityValue(displayedSetting("background-image-opacity", "1"));
  const fit = displayedSetting("background-image-fit", "contain");
  const position = displayedSetting("background-image-position", "center");
  const repeat = displayedSetting("background-image-repeat", "false") === "true";
  const controlsDisabled = disabled;
  const showControls = Boolean(selected || external || showInactivePreferences);
  const canEdit = (key: string) => options.get(key)?.capability.editMode === "control";
  const [libraryLimit, setLibraryLimit] = useState(INITIAL_LIBRARY_SIZE);
  const requestedPreviewsRef = useRef(new Set<string>());
  const displayedAssets = useMemo(() => {
    const visible = assets.slice(0, libraryLimit);
    if (selected && !visible.some((asset) => asset.id === selected.id)) visible.push(selected);
    return visible;
  }, [assets, libraryLimit, selected]);
  const remainingAssets = Math.max(0, assets.length - Math.min(libraryLimit, assets.length));
  const backgroundEffects = BACKGROUND_IMAGE_SETTING_KEYS.reduce<Array<{ key: string; effect: SettingEffect }>>(
    (items, key) => {
      const effect = effects[key];
      if (effect) items.push({ key, effect });
      return items;
    },
    [],
  );
  const overriddenEffects = backgroundEffects.filter((item) => item.effect.status === "overridden");
  const inheritedEffects = backgroundEffects.filter((item) => item.effect.status === "inherited");
  const sourceIds = [...new Set(
    overriddenEffects
      .map((item) => item.effect.sourceCandidateId)
      .filter((candidateId): candidateId is string => Boolean(candidateId)),
  )];
  const suggestedSource = sourceIds.length === 1
    ? overriddenEffects.find((item) => item.effect.sourceCandidateId === sourceIds[0])?.effect ?? null
    : null;
  const canUseSuggestedSource = Boolean(
    suggestedSource?.sourceCandidateId
      && writableCandidateIds.includes(suggestedSource.sourceCandidateId)
      && onUseEffectiveSource,
  );
  const sourceUnverified = !effectiveKnown
    || backgroundEffects.some((item) => item.effect.status === "unverified");
  const imageEffect = effects["background-image"];
  const selectionStatus = imageSelectionModified
    ? text("草稿", "Draft")
    : effectiveKnown
      ? text("最终配置", "Effective configuration")
      : text("当前读取值", "Current value");

  useEffect(() => {
    const availableIds = new Set(assets.map((asset) => asset.id));
    for (const assetId of requestedPreviewsRef.current) {
      if (!availableIds.has(assetId)) requestedPreviewsRef.current.delete(assetId);
    }
  }, [assets]);

  useEffect(() => {
    let canceled = false;
    const orderedIds = [selectedId, ...displayedAssets.map((asset) => asset.id)]
      .filter((assetId): assetId is string => Boolean(assetId))
      .filter((assetId, index, all) => all.indexOf(assetId) === index);
    void (async () => {
      for (const assetId of orderedIds) {
        if (canceled) return;
        const state = previewStates[assetId];
        if (
          state?.status === "ready"
          || state?.status === "loading"
          || state?.status === "error"
          || requestedPreviewsRef.current.has(assetId)
        ) {
          continue;
        }
        requestedPreviewsRef.current.add(assetId);
        await onPreviewRequest(assetId);
      }
    })();
    return () => {
      canceled = true;
    };
  }, [displayedAssets, onPreviewRequest, previewStates, selectedId]);

  const chooseRandom = () => {
    const choices = assets.filter((asset) => asset.id !== selectedId);
    if (choices.length === 0) return;
    const next = choices[Math.floor(Math.random() * choices.length)];
    onSelect(next.id);
  };

  return (
    <section className={`background-editor ${modified ? "background-editor--modified" : ""}`} aria-labelledby="background-editor-title">
      <header className="background-editor__header">
        <div>
          <h2 id="background-editor-title">
            {text("背景图片", "Background image")}
            {modified && <i className="modified-dot" aria-label={text("已修改", "Modified")} />}
          </h2>
        </div>
        <button
          type="button"
          className="button button--secondary"
          onClick={onImport}
          disabled={!desktop || disabled || importing}
        >
          <ImagePlus size={15} />
          {importing ? text("正在处理…", "Preparing…") : text("添加图片", "Add images")}
        </button>
      </header>

      <div className="background-editor__hero">
        <div className={`background-editor__canvas ${selectedPreview ? "has-image" : ""}`}>
          {selectedPreview ? (
            <img src={selectedPreview} alt="" />
          ) : (
            <span>
              {selectedPreviewFailed ? <AlertTriangle size={28} /> : <ImageIcon size={28} />}
              {external
                ? text("选择图库图片后预览", "Choose a library image to preview")
                : selected
                  ? selectedPreviewFailed
                    ? text("无法显示这张图片的预览", "This image preview is unavailable")
                    : text("正在准备预览…", "Preparing preview…")
                  : resetting
                    ? text("保存后关闭背景图片", "Background image will be turned off")
                    : text("尚未选择图片", "No image selected")}
              {selected && selectedPreviewFailed && (
                <button
                  type="button"
                  className="quiet-action"
                  onClick={() => void onPreviewRequest(selected.id, true)}
                >{text("重试预览", "Retry preview")}</button>
              )}
            </span>
          )}
        </div>
        <div className="background-editor__current">
          {selected ? (
            <>
              <span className={`status-chip ${imageEffect?.status === "overridden" ? "status-chip--warning" : ""}`}>
                <Check size={12} /> {selectionStatus}
              </span>
              <strong>{selected.displayName}</strong>
              <small>{selected.mediaType === "image/png" ? "PNG" : "JPEG"} · {selected.width} × {selected.height} · {formatBytes(selected.sizeBytes)}</small>
              {selected.largeImageWarning && (
                <p className="background-editor__warning"><AlertTriangle size={13} /> {text(
                  "高分辨率图片在多分屏时会占用更多显存。",
                  "High-resolution images use more GPU memory across splits.",
                )}</p>
              )}
              <button type="button" className="quiet-action" onClick={onRemove} disabled={disabled}>
                <X size={13} /> {text("关闭背景图片", "Turn off image")}
              </button>
            </>
          ) : external ? (
            <>
              <span className="status-chip status-chip--neutral"><Layers3 size={12} /> {text("外部图片", "External image")}</span>
              <strong>{text("配置文件中的图片", "Image from configuration")}</strong>
              <small>{text("此图片无法在这里预览。选择或添加图库图片即可替换。", "This image cannot be previewed here. Choose or add a library image to replace it.")}</small>
              <button type="button" className="quiet-action" onClick={onRemove} disabled={disabled}>
                <X size={13} /> {text("从配置中移除", "Remove from configuration")}
              </button>
            </>
          ) : (
            <>
              <span className="status-chip status-chip--neutral">{text("未设置", "Not set")}</span>
              <strong>{text("添加背景图片", "Add a background image")}</strong>
              <small>{desktop
                ? text("支持 PNG 与 JPEG；原文件保持不变。", "PNG and JPEG supported. Your original stays unchanged.")
                : text("在桌面应用中可选择本地图片。", "Choose local images in the desktop app.")}</small>
            </>
          )}
        </div>
      </div>

      {feedback && <div className="background-editor__feedback" role="status" aria-live="polite">{feedback}</div>}

      {overriddenEffects.length > 0 && (
        <div className="background-effect-callout background-effect-callout--warning" role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>{text("当前文件不是最终来源", "This file is not the effective source")}</strong>
            <span>{suggestedSource?.sourceLabel
              ? text(
                  "{count} 项背景设置会被 {source} 覆盖。",
                  "{count} background {noun} will be overridden by {source}.",
                  {
                    count: overriddenEffects.length,
                    noun: overriddenEffects.length === 1 ? "setting" : "settings",
                    source: suggestedSource.sourceLabel,
                  },
                )
              : text(
                  "{count} 项背景设置会被后续配置覆盖。",
                  "{count} background {noun} will be overridden by a later configuration.",
                  {
                    count: overriddenEffects.length,
                    noun: overriddenEffects.length === 1 ? "setting" : "settings",
                  },
                )}</span>
          </div>
          {canUseSuggestedSource && (
            <button
              type="button"
              className="button button--secondary"
              onClick={() => onUseEffectiveSource?.(suggestedSource!.sourceCandidateId!)}
              disabled={disabled}
            >{text(
                "改存到 {source}",
                "Save to {source}",
                { source: suggestedSource?.sourceLabel ?? text("生效来源", "effective source") },
              )}</button>
          )}
        </div>
      )}

      {overriddenEffects.length === 0 && inheritedEffects.length > 0 && effectiveKnown && (selected || external) && (
        <div className="background-effect-callout" role="status">
          <Layers3 size={16} />
          <div>
            <strong>{text("当前效果继承自其他配置", "The current appearance is inherited")}</strong>
            <span>{(() => {
              const inheritedLabels = [...new Set(
                inheritedEffects
                  .map((item) => item.effect.sourceLabel)
                  .filter((label): label is string => Boolean(label)),
              )];
              return inheritedLabels.length === 1
                ? text(
                    "当前背景来自 {source}。",
                    "Current background comes from {source}.",
                    { source: inheritedLabels[0] },
                  )
                : text(
                    "当前背景继承自其他配置或默认值。",
                    "Current background is inherited from another configuration or the default.",
                  );
            })()}</span>
          </div>
        </div>
      )}

      {overriddenEffects.length === 0 && sourceUnverified && (selected || external || showInactivePreferences) && (
        <div className="background-effect-callout" role="status">
          <AlertTriangle size={16} />
          <div>
            <strong>{text("最终来源尚未确认", "Effective source not yet verified")}</strong>
            <span>{text(
              "保存时将确认最终生效来源。",
              "The effective source will be checked when saving.",
            )}</span>
          </div>
        </div>
      )}

      {assets.length > 0 && (
        <div className="background-library">
          <div className="background-library__heading">
            <div><strong>{text("图片库", "Image library")}</strong><span>{text("{count} 张", "{count} {noun}", {
              count: assets.length,
              noun: assets.length === 1 ? "image" : "images",
            })}</span></div>
            {assets.length > 1 && (
              <button type="button" className="quiet-action" onClick={chooseRandom} disabled={disabled}>
                <Shuffle size={13} /> {text("随机选择", "Pick at random")}
              </button>
            )}
          </div>
          <div className="background-library__grid" role="radiogroup" aria-label={text("选择背景图片", "Choose a background image")}>
            {displayedAssets.map((asset, index) => {
              const checked = asset.id === selectedId;
              const usageProtected = asset.usage.status !== "available";
              const protectedAsset = checked
                || asset.id === baselineId
                || asset.id === effectiveId
                || usageProtected;
              const firstReference = asset.usage.references[0];
              const previewState = previewStates[asset.id];
              const deleting = deletingAssetId === asset.id;
              const usageLabel = asset.usage.status === "referenced"
                ? asset.usage.references.length === 1 && firstReference?.sourceLabel
                  ? text("被 {source} 使用", "Used by {source}", { source: firstReference.sourceLabel })
                  : text(
                      "被 {count} 份配置使用",
                      "Used by {count} configuration {noun}",
                      {
                        count: asset.usage.references.length,
                        noun: asset.usage.references.length === 1 ? "source" : "sources",
                      },
                    )
                : asset.usage.status === "unknown"
                  ? text("使用状态待确认", "Usage not yet verified")
                  : null;
              return (
                <div className="background-asset-shell" key={asset.id}>
                  <button
                    type="button"
                    role="radio"
                    aria-checked={checked}
                    className={`background-asset ${checked ? "is-selected" : ""}`}
                    onClick={() => onSelect(asset.id)}
                    onKeyDown={(event) => moveRadioSelection(
                      event,
                      index,
                      displayedAssets.length,
                      1,
                      (nextIndex) => onSelect(displayedAssets[nextIndex].id),
                    )}
                    tabIndex={checked || (!selectedId && index === 0) ? 0 : -1}
                    disabled={disabled}
                  >
                    <span className="background-asset__thumb">
                      {previewState?.status === "ready" && previewState.dataUrl
                        ? <img src={previewState.dataUrl} alt="" />
                        : previewState?.status === "error"
                          ? <AlertTriangle size={18} />
                          : previewState?.status === "loading"
                            ? <LoaderCircle className="spin" size={18} />
                            : <ImageIcon size={20} />}
                      {checked && <i><Check size={11} /></i>}
                    </span>
                    <span>
                      <strong>{asset.displayName}</strong>
                      <small>{asset.width} × {asset.height}</small>
                      {usageLabel && <em className="background-asset__usage"><LockKeyhole size={9} /> {usageLabel}</em>}
                    </span>
                  </button>
                  <button
                    type="button"
                    className="background-asset__delete"
                    aria-label={text("从图片库删除 {name}", "Delete {name} from the image library", { name: asset.displayName })}
                    title={asset.usage.status === "referenced"
                      ? text("图片仍被配置使用。请先切换并保存。", "This image is still referenced. Switch it and save first.")
                      : asset.usage.status === "unknown"
                        ? text("使用状态尚未确认，暂时无法删除。", "Usage is not verified, so deletion is unavailable.")
                        : protectedAsset
                          ? text("先关闭或保存其他背景图片。", "Turn off the image or save another one first.")
                      : text("从图片库删除", "Delete from library")}
                    disabled={disabled || protectedAsset || deletingAssetId !== null}
                    aria-busy={deleting || undefined}
                    onClick={() => onDelete(asset.id)}
                  >{deleting ? <LoaderCircle className="spin" size={13} /> : <Trash2 size={13} />}</button>
                  {usageProtected && (
                    <button
                      type="button"
                      className="background-asset__references"
                      onClick={onInspectReferences}
                    >
                      <Layers3 size={11} /> {text("查看写入位置", "View write locations")}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
          {remainingAssets > 0 && (
            <button
              type="button"
              className="background-library__more"
              onClick={() => setLibraryLimit((current) => current + INITIAL_LIBRARY_SIZE)}
            >{text("再显示 {count} 张", "Show {count} more", { count: Math.min(INITIAL_LIBRARY_SIZE, remainingAssets) })}</button>
          )}
        </div>
      )}

      {!selected && !external && showInactivePreferences && (
        <div className="background-preferences-note">
          <strong>{text("显示方式已保留，将用于下一张图片。", "Display preferences will apply to the next image.")}</strong>
        </div>
      )}

      {showControls && <div className="background-controls" aria-disabled={controlsDisabled}>
        <div className="background-control background-control--opacity">
          <div className="background-control__label">
            <div><strong>{text("图片可见度", "Image visibility")}</strong><span>{text("相对于终端背景", "Relative to the terminal background")}</span></div>
            <label className="percentage-control">
              <span className="sr-only">{text("图片可见度百分比", "Image visibility percentage")}</span>
              <input
                type="number"
                min={0}
                step={1}
                value={Math.round(opacity * 100)}
                disabled={controlsDisabled || !canEdit("background-image-opacity")}
                onChange={(event) => {
                  if (event.target.value === "") return;
                  const next = Number(event.target.value) / 100;
                  if (Number.isFinite(next) && next >= 0) onChange("background-image-opacity", String(next));
                }}
              />
              <span aria-hidden="true">%</span>
            </label>
          </div>
          <input
            type="range"
            min={0}
            max={2}
            step={0.01}
            value={Math.min(opacity, 2)}
            disabled={controlsDisabled || !canEdit("background-image-opacity")}
            aria-label={text("图片可见度滑块", "Image visibility slider")}
            style={{ "--range-progress": `${Math.min(opacity / 2, 1) * 100}%` } as CSSProperties}
            onChange={(event) => onChange("background-image-opacity", event.target.value)}
          />
          {opacity > 2 && <small className="background-control__hint">{text(
            "增强值超过 200%；Ghostty 会限制最终不透明度。",
            "Boost is above 200%; Ghostty still caps the final opacity.",
          )}</small>}
        </div>

        <fieldset className="background-control">
          <legend>{text("适配方式", "Fit")}</legend>
          <div className="fit-options">
            {FITS.map((choice) => (
              <label className={fit === choice ? "is-selected" : ""} key={choice}>
                <input
                  type="radio"
                  name="background-fit"
                  value={choice}
                  checked={fit === choice}
                  disabled={controlsDisabled || !canEdit("background-image-fit")}
                  onChange={() => onChange("background-image-fit", choice)}
                />
                <i className={`fit-symbol fit-symbol--${choice}`} />
                <span>{localizedSettingChoice(locale, "background-image-fit", choice)}</span>
              </label>
            ))}
          </div>
        </fieldset>

        <fieldset className="background-control background-control--position">
          <legend>{text("图片位置", "Position")}</legend>
          <div className="position-grid" role="radiogroup" aria-label={text("选择图片位置", "Choose image position")}>
            {POSITIONS.map((choice, index) => (
              <button
                type="button"
                role="radio"
                aria-checked={position === choice}
                aria-label={localizedSettingChoice(locale, "background-image-position", choice)}
                className={position === choice ? "is-selected" : ""}
                key={choice}
                disabled={controlsDisabled || !canEdit("background-image-position")}
                onClick={() => onChange("background-image-position", choice)}
                onKeyDown={(event) => moveRadioSelection(
                  event,
                  index,
                  POSITIONS.length,
                  3,
                  (nextIndex) => onChange("background-image-position", POSITIONS[nextIndex]),
                )}
                tabIndex={position === choice ? 0 : -1}
              ><i /></button>
            ))}
          </div>
        </fieldset>

        <div className="background-control background-control--toggle">
          <div><strong>{text("平铺图片", "Tile image")}</strong><span>{text("图片未铺满时重复显示", "Repeat when the image leaves empty space")}</span></div>
          <button
            type="button"
            className={`switch ${repeat ? "switch--on" : ""}`}
            role="switch"
            aria-checked={repeat}
            aria-label={text("平铺背景图片", "Tile background image")}
            disabled={controlsDisabled || !canEdit("background-image-repeat")}
            onClick={() => onChange("background-image-repeat", repeat ? "false" : "true")}
          ><span /></button>
        </div>
      </div>}

      <p className="background-editor__footnote">{text(
        "所有 Ghostty 窗口共用一张背景图片。",
        "All Ghostty windows share one background image.",
      )}</p>
    </section>
  );
}
