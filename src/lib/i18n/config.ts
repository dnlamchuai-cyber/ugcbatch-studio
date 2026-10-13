/** Locale configuration: Vietnamese is the default; English is the switchable alternative (zh hidden) */
export const LOCALES = ["en", "vi"] as const;
export type Locale = (typeof LOCALES)[number];

/** Default locale: Vietnamese */
export const DEFAULT_LOCALE: Locale = "vi";

/** Labels shown in the language switcher */
export const LOCALE_LABELS: Record<Locale, string> = {
  en: "English",
  vi: "Tiếng Việt",
};

/** Bilingual message entries for a single namespace (one page/module) */
export interface NamespaceMessages {
  /** Legacy upstream Chinese strings — never shown (zh is not a selectable locale). */
  zh?: Record<string, string>;
  en: Record<string, string>;
  /** Vietnamese overrides; generated translations live in ./messages/vi.generated.json; missing keys fall back to English. */
  vi?: Record<string, string>;
}

/** Coerce any persisted/legacy value (e.g. the removed "zh") to a supported locale. */
export function normalizeLocale(v: unknown): Locale {
  return v === "en" ? "en" : "vi";
}

/**
 * Upstream helpers/data are keyed by the legacy "zh" | "en" pair. The Vietnamese UI falls back to the
 * English variant for those (never to Chinese).
 */
export type LegacyLocale = "zh" | "en";
export function legacyLocale(_l: Locale): LegacyLocale {
  void _l;
  return "en";
}

/**
 * Auto-detects the UI locale from the user's system/browser language.
 * English browsers (en / en-US…) → en; everything else → vi (Vietnamese is the default).
 * Returns the default locale in environments without navigator (SSR).
 */
export function detectBrowserLocale(): Locale {
  if (typeof navigator === "undefined") return DEFAULT_LOCALE;
  const langs = (navigator.languages && navigator.languages.length
    ? navigator.languages
    : [navigator.language]) as string[];
  for (const l of langs) {
    if (!l) continue;
    return l.toLowerCase().startsWith("en") ? "en" : "vi";
  }
  return DEFAULT_LOCALE;
}
