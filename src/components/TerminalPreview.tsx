import { memo, useId } from "react";
import { ChevronRight, GitBranch, Wifi } from "lucide-react";
import { useI18n } from "../i18n";
import { compositePreviewBackground } from "../previewColor";

interface TerminalPreviewProps {
  values: Record<string, string>;
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

export const TerminalPreview = memo(function TerminalPreview({ values }: TerminalPreviewProps) {
  const { text } = useI18n();
  const descriptionId = useId();
  const background = cssColor(values.background, "#1e1e2e");
  const foreground = cssColor(values.foreground, "#cdd6f4");
  const fontSize = boundedNumber(values["font-size"], 14, 8, 32);
  const opacity = boundedNumber(values["background-opacity"], 1, 0, 1);
  const padding = boundedNumber(values["window-padding-x"], 12, 6, 48);
  const cursorStyle = values["cursor-style"] ?? "block";

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
      <span className="sr-only" id={descriptionId}>
        {text(
          "模拟效果仅反映颜色、字体、间距与光标。它不会运行 Ghostty，也不能计算多份配置的最终生效值。",
          "This simulation reflects color, font, spacing, and cursor settings. It does not run Ghostty or calculate final values across multiple configuration files.",
        )}
      </span>
    </div>
  );
});
