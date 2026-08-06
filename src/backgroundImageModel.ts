import type { BackgroundImageState, RuntimeOption } from "./types";

export const BACKGROUND_IMAGE_SETTING_KEYS = [
  "background-image",
  "background-image-opacity",
  "background-image-fit",
  "background-image-position",
  "background-image-repeat",
] as const;

export const MANAGED_BACKGROUND_PREFIX = "managed-image:";
export const EXTERNAL_BACKGROUND_TOKEN = "external-image";
export const RESET_BACKGROUND_TOKEN = "reset-background-image";

const EXPECTED_BACKGROUND_CHOICES: Record<string, readonly string[]> = {
  "background-image-fit": ["contain", "cover", "stretch", "none"],
  "background-image-position": [
    "top-left", "top-center", "top-right",
    "center-left", "center", "center-right",
    "bottom-left", "bottom-center", "bottom-right",
  ],
};

export function backgroundValueForState(state: BackgroundImageState): string {
  if (state.kind === "managed" && state.assetId) {
    return `${MANAGED_BACKGROUND_PREFIX}${state.assetId}`;
  }
  return state.kind === "external" ? EXTERNAL_BACKGROUND_TOKEN : "";
}

export function assetIdFromBackgroundValue(value: string | undefined): string | null {
  if (!value?.startsWith(MANAGED_BACKGROUND_PREFIX)) return null;
  const assetId = value.slice(MANAGED_BACKGROUND_PREFIX.length);
  return /^[0-9a-f]{64}$/.test(assetId) ? assetId : null;
}

export function isBackgroundSetting(key: string): boolean {
  return BACKGROUND_IMAGE_SETTING_KEYS.includes(
    key as typeof BACKGROUND_IMAGE_SETTING_KEYS[number],
  );
}

export function supportsBackgroundImageEditor(options: Map<string, RuntimeOption>): boolean {
  const image = options.get("background-image");
  const opacity = options.get("background-image-opacity");
  const fit = options.get("background-image-fit");
  const position = options.get("background-image-position");
  const repeat = options.get("background-image-repeat");
  if (!image || !opacity || !fit || !position || !repeat) return false;

  const commonContract = (option: RuntimeOption) => (
    !option.repeatable
    && option.risk === "normal"
    && option.platform == null
    && option.capability.activation === "reload"
    && option.capability.constraintBehavior === "reject"
    && option.capability.platform == null
  );
  const controlled = (option: RuntimeOption, kind: RuntimeOption["kind"]) => (
    commonContract(option)
    && option.kind === kind
    && option.capability.editMode === "control"
    && option.capability.reason == null
  );
  const exactChoices = (option: RuntimeOption) => {
    const expected = EXPECTED_BACKGROUND_CHOICES[option.key];
    return Boolean(
      expected
      && option.choices.length === expected.length
      && expected.every((choice, index) => option.choices[index] === choice),
    );
  };

  return commonContract(image)
    && image.kind === "text"
    && image.capability.editMode === "none"
    && image.capability.reason === "needs-editor"
    && controlled(opacity, "number")
    && opacity.capability.min === 0
    && opacity.capability.max == null
    && opacity.capability.step === 0.01
    && opacity.capability.unit === "percent"
    && controlled(fit, "select")
    && exactChoices(fit)
    && controlled(position, "select")
    && exactChoices(position)
    && controlled(repeat, "boolean");
}
