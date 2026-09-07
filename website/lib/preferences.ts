import type { Locale } from "./content.ts";

export type LanguagePreference = "system" | Locale;
export type ThemePreference = "system" | "light" | "dark";
export type Preferences = { language: LanguagePreference; theme: ThemePreference };
export const LANGUAGE_COOKIE = "travel-site-language";
export const THEME_COOKIE = "travel-site-theme";

export function languagePreference(value?: string): LanguagePreference {
  return value === "zh" || value === "en" ? value : "system";
}

export function themePreference(value?: string): ThemePreference {
  return value === "light" || value === "dark" ? value : "system";
}

export function systemLocale(languages: readonly string[]): Locale {
  for (const language of languages) {
    if (/^zh(?:-|$)/i.test(language)) return "zh";
    if (/^en(?:-|$)/i.test(language)) return "en";
  }
  return "en";
}

export function requestLocale(preference: LanguagePreference, acceptLanguage: string): Locale {
  if (preference !== "system") return preference;
  const languages = acceptLanguage
    .split(",")
    .map((part) => {
      const [language, ...parameters] = part.trim().split(";");
      const quality = parameters.find((parameter) => parameter.trim().startsWith("q="));
      return { language, quality: quality ? Number(quality.trim().slice(2)) : 1 };
    })
    .filter(({ quality }) => quality > 0 && quality <= 1)
    .sort((a, b) => b.quality - a.quality)
    .map(({ language }) => language);
  return systemLocale(languages);
}

export function localePath(locale: Locale): string {
  return locale === "zh" ? "/" : "/en";
}

export function preferenceCookie(
  name: typeof LANGUAGE_COOKIE | typeof THEME_COOKIE,
  value: LanguagePreference | ThemePreference,
): string {
  return `${name}=${encodeURIComponent(value)}; Path=/; Max-Age=31536000; SameSite=Lax`;
}
