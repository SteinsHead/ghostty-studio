import { backend } from "./backend";
import { textForLocale, type AppLocale } from "./i18n";
import { errorMessage } from "./studioMessages";
import type { ConfigGraph, EnvironmentReport, RuntimeSchema } from "./types";

export interface WorkspaceResources {
  environment: EnvironmentReport | null;
  schema: RuntimeSchema | null;
  graph: ConfigGraph | null;
  failures: WorkspaceResourceFailure[];
}

export type WorkspaceResourceKind = "environment" | "schema" | "graph";

export interface WorkspaceResourceFailure {
  resource: WorkspaceResourceKind;
  reason: unknown;
}

export function workspaceResourceMessage(
  locale: AppLocale,
  failure: WorkspaceResourceFailure,
): string {
  const prefix = failure.resource === "environment"
    ? textForLocale(locale, "环境检查失败：", "Environment check failed: ")
    : failure.resource === "schema"
      ? textForLocale(locale, "设置读取失败：", "Settings could not be loaded: ")
      : textForLocale(locale, "配置来源读取失败：", "Configuration sources could not be loaded: ");
  return `${prefix}${errorMessage(locale, failure.reason)}`;
}

export function workspaceResourceMessages(
  locale: AppLocale,
  failures: WorkspaceResourceFailure[],
): string[] {
  return failures.map((failure) => workspaceResourceMessage(locale, failure));
}

export function workspaceGraphError(
  locale: AppLocale,
  failures: WorkspaceResourceFailure[],
): string | null {
  const failure = failures.find((item) => item.resource === "graph");
  return failure ? workspaceResourceMessage(locale, failure) : null;
}

export async function loadWorkspaceResources(): Promise<WorkspaceResources> {
  const [environmentResult, schemaResult, graphResult] = await Promise.allSettled([
    backend.probeEnvironment(),
    backend.loadRuntimeSchema(),
    backend.loadConfigGraph(),
  ]);
  const failures: WorkspaceResourceFailure[] = [];
  if (environmentResult.status === "rejected") {
    failures.push({ resource: "environment", reason: environmentResult.reason });
  }
  if (schemaResult.status === "rejected") {
    failures.push({ resource: "schema", reason: schemaResult.reason });
  }
  if (graphResult.status === "rejected") {
    failures.push({ resource: "graph", reason: graphResult.reason });
  }
  return {
    environment: environmentResult.status === "fulfilled" ? environmentResult.value : null,
    schema: schemaResult.status === "fulfilled" ? schemaResult.value : null,
    graph: graphResult.status === "fulfilled" ? graphResult.value : null,
    failures,
  };
}
