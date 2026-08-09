import { invoke } from "@tauri-apps/api/core";
import { demoEnvironment, demoSchema, demoSnapshots } from "./demo";
import { assetIdFromBackgroundValue, isBackgroundSetting } from "./backgroundImageModel";
import {
  holdRecordingTransition,
  recordingDemoAsset,
  recordingDemoEnabled,
  recordingDemoPreviewUrl,
} from "./recordingDemo";
import type {
  Backend,
  BackgroundAssetImportResult,
  BackgroundAssetPreview,
  BackgroundAssetSummary,
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

  createConfig(candidateId: string, locale: "zh-CN" | "en" = "en"): Promise<ConfigSession> {
    return invoke("create_config", { candidateId, locale });
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
    locale: "zh-CN" | "en" = "en",
  ): Promise<ApplyResult> {
    return invoke("apply_changes", { sessionId, revision, token, locale });
  }

  listSnapshots(sessionId: string): Promise<SnapshotInfo[]> {
    return invoke("list_snapshots", { sessionId });
  }

  restoreSnapshot(
    sessionId: string,
    revision: string,
    snapshotId: string,
    locale: "zh-CN" | "en" = "en",
  ): Promise<ApplyResult> {
    return invoke("restore_snapshot", { sessionId, revision, snapshotId, locale });
  }

  listBackgroundAssets(): Promise<BackgroundAssetSummary[]> {
    return invoke("list_background_assets");
  }

  chooseBackgroundImages(): Promise<BackgroundAssetImportResult> {
    return invoke("choose_background_images");
  }

  getBackgroundAssetPreview(assetId: string): Promise<BackgroundAssetPreview> {
    return invoke("get_background_asset_preview", { assetId });
  }

  deleteBackgroundAsset(assetId: string, locale: "zh-CN" | "en" = "en"): Promise<void> {
    return invoke("delete_background_asset", { assetId, locale });
  }
}

class BrowserDemoBackend implements Backend {
  private recordingRevision = 0;
  private recordingValues = Object.fromEntries(
    demoSchema.options
      .filter((option) => option.editable)
      .map((option) => [option.key, [...option.currentValues]]),
  );
  private recordingBackgroundImage: ConfigSession["backgroundImage"] = {
    kind: "none",
    assetId: null,
  };
  private recordingAssets: BackgroundAssetSummary[] = [];
  private recordingStage: DraftChange[] = [];

  async probeEnvironment(): Promise<EnvironmentReport> {
    return structuredClone(demoEnvironment);
  }

  async loadRuntimeSchema(): Promise<RuntimeSchema> {
    return structuredClone(demoSchema);
  }

  async loadConfigGraph(): Promise<ConfigGraph> {
    return {
      graphRevision: "demo-graph",
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
    const values = recordingDemoEnabled
      ? structuredClone(this.recordingValues)
      : Object.fromEntries(
        demoSchema.options
          .filter((option) => option.editable)
          .map((option) => [option.key, option.currentValues]),
      );
    const backgroundImage = recordingDemoEnabled
      ? structuredClone(this.recordingBackgroundImage)
      : { kind: "none" as const, assetId: null };
    return {
      id: `demo-${candidateId}`,
      candidateId,
      revision: `demo-revision-${this.recordingRevision}`,
      readOnly: !recordingDemoEnabled,
      values,
      configuredSettings: demoSchema.options.filter((option) => !isBackgroundSetting(option.key)).map((option) => ({
        key: option.key,
        occurrenceCount: Math.max(1, option.currentValues.length),
        valueExposure: option.editable ? "available" : "protected",
      })),
      unrecognizedSettingCount: 0,
      diagnostics: recordingDemoEnabled
        ? ["Synthetic recording session. No local files are read or written."]
        : ["浏览器预览模式固定为只读。请运行 Tauri 应用以访问本地文件。"],
      backgroundImage,
      effectiveValuesKnown: true,
      effectiveValues: structuredClone(values),
      effectiveBackgroundImage: structuredClone(backgroundImage),
      settingEffects: {},
    };
  }

  async createConfig(_candidateId: string): Promise<ConfigSession> {
    throw new Error("浏览器演示模式不会创建本地配置文件");
  }

  async stageChanges(
    _sessionId: string,
    revision: string,
    changes: DraftChange[],
  ): Promise<ChangePreview> {
    if (recordingDemoEnabled) this.recordingStage = structuredClone(changes);
    await holdRecordingTransition();
    const activationRank = {
      unknown: 0,
      reload: 1,
      "reload-new-terminal": 2,
      restart: 3,
    } as const;
    const activation = changes
      .map((change) => demoSchema.options.find((option) => option.key === change.key)?.capability.activation ?? "unknown")
      .reduce<ChangePreview["activation"]>(
        (current, next) => activationRank[next] > activationRank[current] ? next : current,
        "unknown",
      );
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
      diagnostics: [],
      valid: true,
      activation,
      effect: {
        status: "effective",
        affectedKeys: [],
        suggestedCandidateId: null,
        suggestedLabel: null,
      },
    };
  }

  async applyChanges(
    _sessionId: string,
    _revision: string,
    token: string,
  ): Promise<ApplyResult> {
    if (!recordingDemoEnabled) throw new Error("浏览器演示模式禁止写入本地配置");
    if (token !== "demo-stage") throw new Error("The synthetic review is no longer current");

    await holdRecordingTransition();

    for (const change of this.recordingStage) {
      if (change.key === "background-image") {
        const assetId = assetIdFromBackgroundValue(change.after[0]);
        this.recordingBackgroundImage = assetId
          ? { kind: "managed", assetId }
          : { kind: "none", assetId: null };
        continue;
      }
      if (change.after.length === 0) delete this.recordingValues[change.key];
      else this.recordingValues[change.key] = [...change.after];
    }
    this.recordingStage = [];
    this.recordingRevision += 1;
    return {
      revision: `demo-revision-${this.recordingRevision}`,
      snapshotId: "3e924c40-a2b3-4a19-8b16-0be34d01fb52",
      diagnostics: [],
      warnings: [],
      reloadRequired: false,
      activation: "reload",
      effectiveStatus: "verified",
    };
  }

  async listSnapshots(_sessionId: string): Promise<SnapshotInfo[]> {
    return structuredClone(demoSnapshots);
  }

  async restoreSnapshot(): Promise<ApplyResult> {
    throw new Error("浏览器演示模式只展示示例快照，禁止恢复本地配置");
  }

  async listBackgroundAssets(): Promise<BackgroundAssetSummary[]> {
    return recordingDemoEnabled ? structuredClone(this.recordingAssets) : [];
  }

  async chooseBackgroundImages(): Promise<BackgroundAssetImportResult> {
    if (!recordingDemoEnabled) throw new Error("浏览器演示模式不能访问本地图片");
    this.recordingAssets = [structuredClone(recordingDemoAsset)];
    return {
      canceled: false,
      assets: structuredClone(this.recordingAssets),
      rejected: [],
    };
  }

  async getBackgroundAssetPreview(assetId: string): Promise<BackgroundAssetPreview> {
    if (!recordingDemoEnabled || assetId !== recordingDemoAsset.id) {
      throw new Error("浏览器演示模式不能访问本地图片");
    }
    return { assetId, dataUrl: recordingDemoPreviewUrl };
  }

  async deleteBackgroundAsset(assetId: string): Promise<void> {
    if (!recordingDemoEnabled) throw new Error("浏览器演示模式不能删除本地图片");
    this.recordingAssets = this.recordingAssets.filter((asset) => asset.id !== assetId);
  }
}

export const isDesktop = Boolean(window.__TAURI_INTERNALS__);
export const backend: Backend = isDesktop ? new TauriBackend() : new BrowserDemoBackend();
