import { memo, useId } from "react";
import { ChevronRight, GitBranch, Wifi } from "lucide-react";
import { useI18n } from "../i18n";
import { compositePreviewBackground } from "../previewColor";

interface TerminalPreviewProps {
  values: Record<string, string>;
  backgroundImage?: { dataUrl: string; name?: string } | null;
}

function cssColor(value: string | undefined, fallback: string): string {
  if (!value) return fallback;
  const normalized = value.startsWith("#") ? value : `#${value}`;
  return /^#[0-9a-fA-F]{6}([0-9a-fA-F]{2})?$/.test(normalized) ? normalized : fallback;
}

function boundedNumber(value: string | undefined, fallback: number, minimum: number, maximum: number) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(Math.max(parsed, minimum), maximum) : fallback;
}

function backgroundPosition(value: string | undefined): string {
  const positions: Record<string, string> = {
    "top-left": "left top",
    "top-center": "center top",
    "top-right": "right top",
    "center-left": "left center",
    center: "center center",
    "center-right": "right center",
    "bottom-left": "left bottom",
    "bottom-center": "center bottom",
    "bottom-right": "right bottom",
  };
  return positions[value ?? "center"] ?? "center center";
}

function backgroundSize(value: string | undefined): string {
  if (value === "cover") return "cover";
  if (value === "stretch") return "100% 100%";
  if (value === "none") return "auto";
  return "contain";
}

export const TerminalPreview = memo(function TerminalPreview({ values, backgroundImage }: TerminalPreviewProps) {
  const { text } = useI18n();
  const descriptionId = useId();
  const background = cssColor(values.background, "#1e1e2e");
  const foreground = cssColor(values.foreground, "#cdd6f4");
  const fontSize = boundedNumber(values["font-size"], 14, 8, 32);
  const opacity = boundedNumber(values["background-opacity"], 1, 0, 1);
  const padding = boundedNumber(values["window-padding-x"], 12, 6, 48);
  const cursorStyle = values["cursor-style"] ?? "block";
  const imageOpacity = boundedNumber(values["background-image-opacity"], 1, 0, 100);
  const effectiveImageOpacity = Math.min(opacity * imageOpacity, 1);

  return (
    <div
      className="terminal-shell"
      role="img"
      aria-label={text("终端外观模拟预览", "Simulated terminal appearance")}
      aria-describedby={descriptionId}
    >
      <div className="terminal-titlebar" aria-hidden="true">
        <div className="traffic-lights" aria-hidden="true">
          <span className="traffic-light traffic-light--red" />
          <span className="traffic-light traffic-light--yellow" />
          <span className="traffic-light traffic-light--green" />
        </div>
        <span>ghostty — studio</span>
        <Wifi size={13} />
      </div>
      <div
        className="terminal-screen"
        aria-hidden="true"
        style={{
          backgroundColor: compositePreviewBackground(background, opacity),
          color: foreground,
          fontFamily: `"${values["font-family"] ?? "JetBrains Mono"}", monospace`,
          fontSize: `${fontSize}px`,
          padding: `${padding}px`,
        }}
      >
        {backgroundImage && (
          <div
            className="terminal-background-image"
            style={{
              backgroundImage: `url(${JSON.stringify(backgroundImage.dataUrl)})`,
              backgroundSize: backgroundSize(values["background-image-fit"]),
              backgroundPosition: backgroundPosition(values["background-image-position"]),
              backgroundRepeat: values["background-image-repeat"] === "true" ? "repeat" : "no-repeat",
              opacity: effectiveImageOpacity,
            }}
          />
        )}
        <div className="terminal-content">
          <div className="terminal-line terminal-line--muted">Last login: today on ttys002</div>
          <div className="terminal-line prompt-line">
            <span className="prompt-mark">❯</span>
            <span> git status --short</span>
          </div>
          <div className="terminal-line"><span className="git-modified"> M</span> src/config.rs</div>
          <div className="terminal-line"><span className="git-new">??</span> ghostty-studio.conf</div>
          <div className="terminal-line prompt-line terminal-line--spaced">
            <span className="prompt-mark">❯</span>
            <span> cargo test</span>
          </div>
          <div className="terminal-line test-line">
            <span>test result: </span><strong>ok</strong><span>. 42 passed; 0 failed</span>
          </div>
          <div className="terminal-line path-line">
            <ChevronRight size={14} />
            <GitBranch size={13} />
            <span>main</span>
            <i className={`cursor cursor--${cursorStyle}`} />
          </div>
        </div>
      </div>
      <span className="sr-only" id={descriptionId}>
        {text(
          "模拟效果反映背景图片、颜色、字体、间距与光标，但不代表运行中的 Ghostty 窗口已经重新载入。",
          "This simulation reflects the background image, colors, type, spacing, and cursor, but it does not mean a running Ghostty window has reloaded.",
        )}
      </span>
    </div>
  );
});
