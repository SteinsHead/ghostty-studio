import { invoke } from "@tauri-apps/api/core";
import { demoEnvironment, demoSchema, demoSnapshots } from "./demo";
import type {
  Backend,
  ApplyResult,
  ChangePreview,
  ConfigGraph,
  ConfigSession,
  DraftChange,
  EnvironmentReport,
  RuntimeSchema,
  SnapshotInfo,
} from "./types";

class TauriBackend implements Backend {
  probeEnvironment(): Promise<EnvironmentReport> {
    return invoke("probe_environment");
  }

  loadRuntimeSchema(): Promise<RuntimeSchema> {
    return invoke("load_runtime_schema");
  }

  loadConfigGraph(): Promise<ConfigGraph> {
    return invoke("load_config_graph");
  }

  openConfig(candidateId: string): Promise<ConfigSession> {
    return invoke("open_config", { candidateId });
  }

  stageChanges(
    sessionId: string,
    revision: string,
    changes: DraftChange[],
  ): Promise<ChangePreview> {
    return invoke("stage_changes", { sessionId, revision, changes });
  }

  applyChanges(
    sessionId: string,
    revision: string,
    token: string,
  ): Promise<ApplyResult> {
    return invoke("apply_changes", { sessionId, revision, token });
  }

  listSnapshots(sessionId: string): Promise<SnapshotInfo[]> {
    return invoke("list_snapshots", { sessionId });
  }

  restoreSnapshot(
    sessionId: string,
    revision: string,
    snapshotId: string,
  ): Promise<ApplyResult> {
    return invoke("restore_snapshot", { sessionId, revision, snapshotId });
  }
}

class BrowserDemoBackend implements Backend {
  async probeEnvironment(): Promise<EnvironmentReport> {
    return structuredClone(demoEnvironment);
  }

  async loadRuntimeSchema(): Promise<RuntimeSchema> {
    return structuredClone(demoSchema);
  }

  async loadConfigGraph(): Promise<ConfigGraph> {
    return {
      complete: true,
      semanticsKnown: false,
      nodes: [
        {
          id: "layer-1",
          path: "配置层 1",
          loadIndex: 0,
          depth: 0,
          assignmentCount: 28,
          symlink: false,
        },
        {
          id: "layer-2",
          path: "配置层 2",
          loadIndex: 1,
          depth: 0,
          assignmentCount: 10,
          symlink: false,
        },
        {
          id: "layer-3",
          path: "配置层 3",
          loadIndex: 2,
          depth: 1,
          assignmentCount: 6,
          symlink: false,
        },
      ],
      edges: [
        {
          fromId: "layer-1",
          toId: "layer-3",
          declaredPath: "配置层 3",
          line: 22,
          optional: false,
          status: "loaded",
        },
      ],
      provenance: [
        { key: "font-size", sourceId: "layer-1", sourcePath: "配置层 1", line: 4, loadIndex: 0 },
        { key: "font-size", sourceId: "layer-2", sourcePath: "配置层 2", line: 7, loadIndex: 1 },
        { key: "background-opacity", sourceId: "layer-3", sourcePath: "配置层 3", line: 3, loadIndex: 2 },
      ],
      diagnostics: [],
      totalBytes: 7073,
    };
  }

  async openConfig(candidateId: string): Promise<ConfigSession> {
    const candidate = demoEnvironment.candidates.find((item) => item.id === candidateId);
    if (!candidate) throw new Error("Unknown demo config candidate");
    return {
      id: `demo-${candidateId}`,
      candidateId,
      path: candidate.path,
      revision: "demo-revision",
      readOnly: true,
      values: Object.fromEntries(
        demoSchema.options.map((option) => [option.key, option.currentValues]),
      ),
      diagnostics: ["浏览器预览模式固定为只读。请运行 Tauri 应用以访问本地文件。"],
    };
  }

  async stageChanges(
    _sessionId: string,
    revision: string,
    changes: DraftChange[],
  ): Promise<ChangePreview> {
    const unifiedDiff = changes
      .flatMap((change) => [
        `-${change.key} = ${change.before.join(", ")}`,
        `+${change.key} = ${change.after.join(", ")}`,
      ])
      .join("\n");
    return {
      token: "demo-stage",
      revision,
      changes,
      unifiedDiff,
      diagnostics: ["这是演示结果，不会写入文件。"],
      valid: true,
    };
  }

  async applyChanges(): Promise<ApplyResult> {
    throw new Error("浏览器演示模式禁止写入本地配置");
  }

  async listSnapshots(_sessionId: string): Promise<SnapshotInfo[]> {
    return structuredClone(demoSnapshots);
  }

  async restoreSnapshot(): Promise<ApplyResult> {
    throw new Error("浏览器演示模式只展示示例快照，禁止恢复本地配置");
  }
}

export const isDesktop = Boolean(window.__TAURI_INTERNALS__);
export const backend: Backend = isDesktop ? new TauriBackend() : new BrowserDemoBackend();
