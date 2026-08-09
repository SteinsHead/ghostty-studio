import { backgroundValueForState } from "./backgroundImageModel";
import type { ConfigSession, RuntimeOption } from "./types";
import { categoryId } from "./workspaceModel";

export const LAST_CATEGORY_KEY = "ghostty-studio:last-category";
export const PREFERRED_CANDIDATE_KEY = "ghostty-studio:preferred-candidate";

const legacyViewPreferenceIds: Record<string, string> = {
  "常用": "common",
  "我的配置": "configured",
  "设置参考": "catalog",
};

export function normalizeViewPreference(value: string | null): string {
  if (!value) return "common";
  return legacyViewPreferenceIds[value] ?? categoryId(value);
}

export function readPreference(key: string): string | null {
  try {
    return window.localStorage.getItem(key);
  } catch {
    return null;
  }
}

export function writePreference(key: string, value: string): void {
  try {
    window.localStorage.setItem(key, value);
  } catch {
    // A denied preference store must never block configuration work.
  }
}

export function initialValues(options: RuntimeOption[]): Record<string, string> {
  return Object.fromEntries(
    options.map((option) => [option.key, option.defaultValues[0] ?? ""]),
  );
}

export function valuesForSession(
  options: RuntimeOption[],
  session: ConfigSession,
): Record<string, string> {
  const values = initialValues(options);
  for (const [key, configuredValues] of Object.entries(session.values)) {
    if (configuredValues.length > 0 && key in values) {
      values[key] = configuredValues[configuredValues.length - 1];
    }
  }
  values["background-image"] = backgroundValueForState(session.backgroundImage);
  return values;
}

export function effectiveValuesForSession(
  options: RuntimeOption[],
  session: ConfigSession,
): Record<string, string> {
  if (!session.effectiveValuesKnown) return valuesForSession(options, session);
  const values = initialValues(options);
  for (const [key, configuredValues] of Object.entries(session.effectiveValues)) {
    if (configuredValues.length > 0 && key in values) {
      values[key] = configuredValues[configuredValues.length - 1];
    }
  }
  values["background-image"] = backgroundValueForState(session.effectiveBackgroundImage);
  return values;
}

export type MutationKind = "source" | "apply" | "restore" | "refresh";

export interface MutationOperation {
  kind: MutationKind;
  token: symbol;
}

export class MutationCoordinator {
  private active: MutationOperation | null = null;

  get busy(): boolean {
    return this.active !== null;
  }

  begin(kind: MutationKind): MutationOperation | null {
    if (this.active) return null;
    const operation = { kind, token: Symbol(kind) };
    this.active = operation;
    return operation;
  }

  finish(operation: MutationOperation): void {
    if (this.active?.token === operation.token) {
      this.active = null;
    }
  }

  isCurrent(operation: MutationOperation): boolean {
    return this.active?.token === operation.token;
  }
}
