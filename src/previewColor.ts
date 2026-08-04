const PREVIEW_BACKDROP = "#111318";

interface ParsedColor {
  red: number;
  green: number;
  blue: number;
  alpha: number;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(Math.max(value, minimum), maximum);
}

function parseHexColor(value: string, fallback: ParsedColor): ParsedColor {
  const normalized = value.startsWith("#") ? value : `#${value}`;
  if (!/^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized)) return fallback;

  return {
    red: Number.parseInt(normalized.slice(1, 3), 16),
    green: Number.parseInt(normalized.slice(3, 5), 16),
    blue: Number.parseInt(normalized.slice(5, 7), 16),
    alpha: normalized.length === 9
      ? Number.parseInt(normalized.slice(7, 9), 16) / 255
      : 1,
  };
}

/**
 * Produces the same pixels as a translucent terminal background over the
 * preview shell, while keeping the WebView layer itself fully opaque.
 *
 * WKWebView can otherwise switch compositor paths when alpha crosses 1.0,
 * causing a full-window flash during continuous range input.
 */
export function compositePreviewBackground(
  color: string,
  opacity: number,
  backdrop = PREVIEW_BACKDROP,
): string {
  const opaqueBlack = { red: 0, green: 0, blue: 0, alpha: 1 };
  const parsedBackdrop = parseHexColor(backdrop, opaqueBlack);
  const parsedColor = parseHexColor(color, parsedBackdrop);
  const requestedOpacity = Number.isFinite(opacity) ? clamp(opacity, 0, 1) : 1;
  const alpha = requestedOpacity * parsedColor.alpha;
  const mix = (foreground: number, background: number) => (
    Math.round(foreground * alpha + background * (1 - alpha))
  );

  return `rgb(${mix(parsedColor.red, parsedBackdrop.red)}, ${mix(parsedColor.green, parsedBackdrop.green)}, ${mix(parsedColor.blue, parsedBackdrop.blue)})`;
}
