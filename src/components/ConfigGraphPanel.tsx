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
import type { ConfigGraph } from "../types";
import { useDialogFocus } from "./useDialogFocus";

interface ConfigGraphPanelProps {
  graph: ConfigGraph | null;
  onClose(): void;
}

const edgeStatusLabels: Record<string, string> = {
  loaded: "已加载",
  optional_missing: "可选文件不存在",
  missing: "文件不存在",
  permission_required: "未读取",
  cycle_or_duplicate: "循环或重复引用",
  queued: "等待读取",
};

export function ConfigGraphPanel({ graph, onClose }: ConfigGraphPanelProps) {
  const dialogRef = useDialogFocus(onClose);
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
            <span className="eyebrow"><Layers3 size={14} /> 加载关系</span>
            <h2 id="graph-title">配置来源</h2>
          </div>
          <button className="icon-button" type="button" onClick={onClose} aria-label="关闭来源图" data-dialog-initial-focus>
            <X size={18} />
          </button>
        </header>

        <div className="review-body" tabIndex={0} aria-label="配置来源图内容">
          {!graph ? (
            <div className="loading-card">还没有加载来源信息。</div>
          ) : (
            <>
              <div className="graph-metrics">
                <div><strong>{graph.nodes.length}</strong><span>配置文件</span></div>
                <div><strong>{graph.edges.length}</strong><span>引用关系</span></div>
                <div><strong>{overridden.length}</strong><span>多文件设置</span></div>
                <div><strong>{Math.ceil(graph.totalBytes / 1024)}K</strong><span>配置大小</span></div>
              </div>

              <div className="graph-note">
                <LockKeyhole size={15} />
                <span>为保护隐私，这里只显示配置键、层级和行号，不显示路径或配置值。</span>
              </div>

              {!graph.complete && (
                <div className="diagnostic"><AlertTriangle size={15} /><span>加载关系不完整：部分引用的配置文件无法读取。</span></div>
              )}

              {!graph.semanticsKnown && (
                <div className="diagnostic" role="status">
                  <AlertTriangle size={15} />
                  <span>Ghostty 的完整合并语义尚未计算；这里的加载顺序与多文件来源仅供观察，不能代表最终生效值。</span>
                </div>
              )}

              <section className="graph-section">
                <div className="graph-section__title"><GitMerge size={15} /> 加载顺序</div>
                {graph.nodes.length === 0 ? (
                  <div className="graph-empty">没有可显示的配置文件。</div>
                ) : (
                  <div className="load-timeline">
                    {graph.nodes
                      .slice()
                      .sort((a, b) => a.loadIndex - b.loadIndex)
                      .map((node, index) => (
                        <div className="load-node" key={node.id}>
                          <div className="load-index">{node.loadIndex + 1}</div>
                          <div className="load-node__copy">
                            <strong>{node.path}</strong>
                            <span>
                              {node.assignmentCount} 项 · 第 {node.depth + 1} 层
                              {node.symlink ? " · 符号链接" : ""}
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
                  <div className="graph-section__title"><Link2 size={15} /> Include</div>
                  <div className="edge-list">
                    {graph.edges.map((edge, index) => (
                      <div className="edge-row" key={`${edge.fromId}-${edge.line}-${index}`}>
                        <FileCode2 size={14} />
                        <div><code>{edge.declaredPath}</code><span>第 {edge.line} 行{edge.optional ? " · 可选" : ""}</span></div>
                        <em className={`edge-status edge-status--${edge.status}`}>{edgeStatusLabels[edge.status] ?? edge.status}</em>
                      </div>
                    ))}
                  </div>
                </section>
              )}

              <section className="graph-section">
                <div className="graph-section__title"><Layers3 size={15} /> 多文件设置</div>
                {overridden.length === 0 ? (
                  <div className="graph-empty">没有设置项出现在多个文件中。</div>
                ) : (
                  <div className="override-list">
                    {overridden.slice(0, 20).map((item) => (
                      <div key={item.key}><code>{item.key}</code><span>来自 {item.count} 个文件</span></div>
                    ))}
                    {overridden.length > 20 && (
                      <div className="graph-more">另有 {overridden.length - 20} 个重复键未展开。</div>
                    )}
                  </div>
                )}
              </section>

              {graph.diagnostics.length > 0 && (
                <section className="graph-section">
                  <div className="graph-section__title"><AlertTriangle size={15} /> 问题</div>
                  {graph.diagnostics.map((diagnostic, index) => (
                    <div className="diagnostic" key={`${diagnostic.code}-${index}`}>
                      <AlertTriangle size={15} /><span>{diagnostic.message}</span>
                    </div>
                  ))}
                </section>
              )}
            </>
          )}
        </div>

        <footer className="review-footer">
          <span className="readonly-note">应用不会自动读取 Ghostty 配置目录外的文件。</span>
          <button type="button" className="button button--secondary" onClick={onClose}>完成</button>
        </footer>
      </section>
    </div>
  );
}
