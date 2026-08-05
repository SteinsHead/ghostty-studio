import {
  AlertTriangle,
  ArrowDown,
  FileCode2,
  GitMerge,
  Layers3,
  Link2,
  LockKeyhole,
  X,
} from "lucide-react";
import { useI18n, type AppLocale } from "../i18n";
import type { ConfigGraph } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface ConfigGraphPanelProps {
  graph: ConfigGraph | null;
  onClose(): void;
}

const edgeStatusLabels: Record<string, Record<AppLocale, string>> = {
  loaded: { "zh-CN": "已加载", en: "Loaded" },
  optional_missing: { "zh-CN": "可选文件不存在", en: "Optional file not found" },
  missing: { "zh-CN": "文件不存在", en: "File not found" },
  permission_required: { "zh-CN": "未读取", en: "Not read" },
  cycle_or_duplicate: { "zh-CN": "循环或重复引用", en: "Cycle or duplicate" },
  queued: { "zh-CN": "等待读取", en: "Queued" },
};

function displayLayerName(locale: AppLocale, value: string): string {
  if (locale === "zh-CN") return value;
  const numberedLayer = value.match(/^配置层 (\d+)$/);
  if (numberedLayer) return `Layer ${numberedLayer[1]}`;
  if (value === "未公开的 include 路径") return "Hidden include path";
  if (value === "未公开路径") return "Hidden path";
  return value;
}

function graphDiagnosticMessage(locale: AppLocale, code: string): string {
  const chinese = locale === "zh-CN";
  const messages: Record<string, [string, string]> = {
    graph_file_limit: ["配置文件过多，加载已停止。", "Too many configuration files were found, so loading stopped."],
    graph_depth_limit: ["配置引用层级过深，部分文件未加载。", "The include chain is too deep, so some files were not loaded."],
    config_read_failed: ["有一份配置文件无法读取。", "A configuration file could not be read."],
    cycle_or_duplicate: ["同一配置文件被重复引用，或引用形成了循环。", "A configuration file is included more than once, or the includes form a cycle."],
    external_include_blocked: ["引用的文件位于已授权目录之外，因此未读取。", "An included file is outside the approved folders and was not read."],
    graph_byte_limit: ["配置文件总大小超过安全上限，加载已停止。", "The configuration files exceed the safe size limit, so loading stopped."],
    invalid_encoding: ["有一份配置文件不是有效的 UTF-8。", "A configuration file is not valid UTF-8."],
    assignment_limit: ["单个配置文件包含过多设置，加载已停止。", "One configuration file contains too many settings, so loading stopped."],
    graph_edge_limit: ["配置引用过多，加载已停止。", "There are too many includes, so loading stopped."],
  };
  const message = messages[code];
  if (message) return chinese ? message[0] : message[1];
  return chinese ? "部分配置来源无法读取。" : "Part of the configuration could not be read.";
}

export function ConfigGraphPanel({ graph, onClose }: ConfigGraphPanelProps) {
  const { locale, text } = useI18n();
  const dialogRef = useDialogFocus(onClose);
  const numberFormatter = new Intl.NumberFormat(locale);
  const keySources = new Map<string, Set<string>>();
  for (const entry of graph?.provenance ?? []) {
    const sources = keySources.get(entry.key) ?? new Set<string>();
    sources.add(entry.sourceId);
    keySources.set(entry.key, sources);
  }
  const overridden = [...keySources.entries()]
    .filter(([, sources]) => sources.size > 1)
    .map(([key, sources]) => ({ key, count: sources.size }));

  return (
    <div className="review-backdrop" role="presentation" onMouseDown={onClose}>
      <section
        ref={dialogRef}
        className="review-panel graph-panel"
        role="dialog"
        aria-modal="true"
        aria-labelledby="graph-title"
        tabIndex={-1}
        onMouseDown={(event) => event.stopPropagation()}
      >
        <header className="review-header">
          <div>
            <span className="eyebrow"><Layers3 size={14} /> {text("加载关系", "Loading relationships")}</span>
            <h2 id="graph-title">{text("配置来源", "Configuration sources")}</h2>
          </div>
          <button
            className="icon-button"
            type="button"
            onClick={onClose}
            aria-label={text("关闭配置来源", "Close configuration sources")}
          >
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label={text("配置来源详情", "Configuration source details")}>
          {!graph ? (
            <div className="loading-card">{text("尚未加载配置来源。", "Configuration sources have not been loaded yet.")}</div>
          ) : (
            <>
              <div className="graph-metrics">
                <div><strong>{numberFormatter.format(graph.nodes.length)}</strong><span>{text("配置文件", graph.nodes.length === 1 ? "File" : "Files")}</span></div>
                <div><strong>{numberFormatter.format(graph.edges.length)}</strong><span>{text("引用关系", graph.edges.length === 1 ? "Include" : "Includes")}</span></div>
                <div><strong>{numberFormatter.format(overridden.length)}</strong><span>{text("多文件设置", overridden.length === 1 ? "Repeated setting" : "Repeated settings")}</span></div>
                <div><strong>{numberFormatter.format(Math.ceil(graph.totalBytes / 1024))} KB</strong><span>{text("配置大小", "Total size")}</span></div>
              </div>

              <div className="graph-note">
                <LockKeyhole size={15} />
                <span>
                  {text(
                    "为保护隐私，这里只显示配置名、层级和行号，不显示路径或配置值。",
                    "To protect your privacy, this view shows keys, layers, and line numbers—not paths or values.",
                  )}
                </span>
              </div>

              {!graph.complete && (
                <div className="diagnostic">
                  <AlertTriangle size={15} />
                  <span>{text("加载关系不完整，部分配置文件无法读取。", "Some configuration sources could not be read.")}</span>
                </div>
              )}

              {!graph.semanticsKnown && (
                <div className="diagnostic" role="status">
                  <AlertTriangle size={15} />
                  <span>
                    {text(
                      "这里显示加载顺序和设置来源，但尚不能确定多文件配置的最终生效值。",
                      "This view shows loading order and setting sources, but it cannot yet determine the final values across multiple files.",
                    )}
                  </span>
                </div>
              )}

              <section className="graph-section">
                <div className="graph-section__title"><GitMerge size={15} /> {text("加载顺序", "Loading order")}</div>
                {graph.nodes.length === 0 ? (
                  <div className="graph-empty">{text("没有可显示的配置文件。", "No configuration files to show.")}</div>
                ) : (
                  <div className="load-timeline">
                    {graph.nodes
                      .slice()
                      .sort((a, b) => a.loadIndex - b.loadIndex)
                      .map((node, index) => (
                        <div className="load-node" key={node.id}>
                          <div className="load-index">{node.loadIndex + 1}</div>
                          <div className="load-node__copy">
                            <strong>{displayLayerName(locale, node.path)}</strong>
                            <span>
                              {text(
                                `${node.assignmentCount} 项设置 · 第 ${node.depth + 1} 层`,
                                `${node.assignmentCount} ${node.assignmentCount === 1 ? "setting" : "settings"} · Level ${node.depth + 1}`,
                              )}
                              {node.symlink ? text(" · 符号链接", " · Symlink") : ""}
                            </span>
                          </div>
                          {index < graph.nodes.length - 1 && <ArrowDown className="load-arrow" size={14} />}
                        </div>
                      ))}
                  </div>
                )}
              </section>

              {graph.edges.length > 0 && (
                <section className="graph-section">
                  <div className="graph-section__title"><Link2 size={15} /> include</div>
                  <div className="edge-list">
                    {graph.edges.map((edge, index) => (
                      <div className="edge-row" key={`${edge.fromId}-${edge.line}-${index}`}>
                        <FileCode2 size={14} />
                        <div>
                          <code>{displayLayerName(locale, edge.declaredPath)}</code>
                          <span>
                            {text(`第 ${edge.line} 行`, `Line ${edge.line}`)}
                            {edge.optional ? text(" · 可选", " · Optional") : ""}
                          </span>
                        </div>
                        <em className={`edge-status edge-status--${edge.status}`}>
                          {edgeStatusLabels[edge.status]?.[locale] ?? edge.status}
                        </em>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="graph-section">
                <div className="graph-section__title"><Layers3 size={15} /> {text("多文件设置", "Settings in multiple files")}</div>
                {overridden.length === 0 ? (
                  <div className="graph-empty">{text("没有设置出现在多个文件中。", "No settings appear in more than one file.")}</div>
                ) : (
                  <div className="override-list">
                    {overridden.slice(0, 20).map((item) => (
                      <div key={item.key}>
                        <code>{item.key}</code>
                        <span>
                          {text(
                            `来自 ${item.count} 个文件`,
                            `Found in ${item.count} ${item.count === 1 ? "file" : "files"}`,
                          )}
                        </span>
                      </div>
                    ))}
                    {overridden.length > 20 && (
                      <div className="graph-more">
                        {text(
                          `另有 ${overridden.length - 20} 个配置名未展开。`,
                          `${overridden.length - 20} more ${overridden.length - 20 === 1 ? "key is" : "keys are"} not shown.`,
                        )}
                      </div>
                    )}
                  </div>
                )}
              </section>

              {graph.diagnostics.length > 0 && (
                <section className="graph-section">
                  <div className="graph-section__title"><AlertTriangle size={15} /> {text("需要注意", "Needs attention")}</div>
                  {graph.diagnostics.map((diagnostic, index) => (
                    <div className="diagnostic" key={`${diagnostic.code}-${index}`}>
                      <AlertTriangle size={15} /><span>{graphDiagnosticMessage(locale, diagnostic.code)}</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="review-footer">
          <span className="readonly-note">
            {text(
              "Studio 不会自动读取 Ghostty 配置目录之外的文件。",
              "Studio does not automatically read files outside Ghostty's configuration folders.",
            )}
          </span>
          <button type="button" className="button button--secondary" onClick={onClose}>
            {text("完成", "Done")}
          </button>
        </footer>
      </section>
    </div>
  );
}
