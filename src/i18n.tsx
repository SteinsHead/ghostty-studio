import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
} from "react";

export type AppLocale = "zh-CN" | "en";
export type LanguagePreference = "system" | AppLocale;

const LANGUAGE_PREFERENCE_KEY = "ghostty-studio.language.v1";

type Replacements = Record<string, string | number>;

interface I18nContextValue {
  locale: AppLocale;
  preference: LanguagePreference;
  setPreference(preference: LanguagePreference): void;
  text(zhCN: string, en: string, replacements?: Replacements): string;
}

export type LocalizedText = I18nContextValue["text"];

function interpolate(template: string, replacements?: Replacements): string {
  if (!replacements) return template;
  return template.replace(/\{(\w+)\}/g, (match, key: string) => (
    Object.prototype.hasOwnProperty.call(replacements, key)
      ? String(replacements[key])
      : match
  ));
}

export function textForLocale(
  locale: AppLocale,
  zhCN: string,
  en: string,
  replacements?: Replacements,
): string {
  return interpolate(locale === "zh-CN" ? zhCN : en, replacements);
}

function systemLocale(): AppLocale {
  if (typeof navigator === "undefined") return "zh-CN";
  const languages = navigator.languages?.length ? navigator.languages : [navigator.language];
  return languages.some((language) => language.toLowerCase().startsWith("zh")) ? "zh-CN" : "en";
}

function storedPreference(): LanguagePreference {
  if (typeof window === "undefined") return "system";
  try {
    const stored = window.localStorage.getItem(LANGUAGE_PREFERENCE_KEY);
    if (stored === "system" || stored === "zh-CN" || stored === "en") return stored;
  } catch {
    // The language selector still works for this session when storage is unavailable.
  }
  return "system";
}

const defaultContext: I18nContextValue = {
  locale: "zh-CN",
  preference: "zh-CN",
  setPreference: () => undefined,
  text: (zhCN, _en, replacements) => interpolate(zhCN, replacements),
};

const I18nContext = createContext<I18nContextValue>(defaultContext);

export function I18nProvider({ children }: { children: ReactNode }) {
  const [preference, setPreferenceState] = useState<LanguagePreference>(storedPreference);
  const [detectedLocale, setDetectedLocale] = useState<AppLocale>(systemLocale);
  const locale = preference === "system" ? detectedLocale : preference;

  useEffect(() => {
    const updateSystemLocale = () => setDetectedLocale(systemLocale());
    window.addEventListener("languagechange", updateSystemLocale);
    return () => window.removeEventListener("languagechange", updateSystemLocale);
  }, []);

  useEffect(() => {
    document.documentElement.lang = locale === "zh-CN" ? "zh-Hans" : "en";
    document.title = "Ghostty Studio";
    const description = document.querySelector<HTMLMetaElement>('meta[name="description"]');
    if (description) {
      description.content = locale === "zh-CN"
        ? "安全、直观地调整 Ghostty 配置"
        : "A safe, thoughtful way to configure Ghostty";
    }
  }, [locale]);

  const setPreference = useCallback((nextPreference: LanguagePreference) => {
    setPreferenceState(nextPreference);
    try {
      window.localStorage.setItem(LANGUAGE_PREFERENCE_KEY, nextPreference);
    } catch {
      // A blocked preference store must not interrupt the current editing session.
    }
  }, []);

  const text = useCallback((zhCN: string, en: string, replacements?: Replacements) => (
    textForLocale(locale, zhCN, en, replacements)
  ), [locale]);

  const value = useMemo<I18nContextValue>(() => ({
    locale,
    preference,
    setPreference,
    text,
  }), [locale, preference, setPreference, text]);

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
}

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export function localeLabel(locale: AppLocale): string {
  return locale === "zh-CN" ? "简体中文" : "English";
}
