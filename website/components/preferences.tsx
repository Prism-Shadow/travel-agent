"use client";

import { useEffect, useRef, useState } from "react";
import { content, type Locale } from "../lib/content";
import {
  LANGUAGE_COOKIE,
  THEME_COOKIE,
  localePath,
  preferenceCookie,
  systemLocale,
  type LanguagePreference,
  type Preferences,
  type ThemePreference,
} from "../lib/preferences";

function ControlIcon({ name }: { name: "globe" | "sun" | "moon" | "monitor" }) {
  return <span className={`control-mark control-mark-${name}`} aria-hidden="true" />;
}

// Write before navigating so the next server request uses the user's explicit choice.
function persistPreference(
  name: typeof LANGUAGE_COOKIE | typeof THEME_COOKIE,
  value: LanguagePreference | ThemePreference,
) {
  document.cookie = preferenceCookie(name, value);
}

export function WebsitePreferences({ locale, initial }: { locale: Locale; initial: Preferences }) {
  const t = content[locale];
  const [language, setLanguage] = useState(initial.language);
  const [theme, setTheme] = useState(initial.theme);
  const languageMenu = useRef<HTMLDetailsElement>(null);
  const themeMenu = useRef<HTMLDetailsElement>(null);

  useEffect(() => {
    const dismiss = (event: PointerEvent | KeyboardEvent) => {
      for (const menu of [languageMenu.current, themeMenu.current]) {
        if (!menu?.open) continue;
        if (event instanceof KeyboardEvent) {
          if (event.key !== "Escape") continue;
          menu.open = false;
          menu.querySelector("summary")?.focus();
        } else if (event.target instanceof Node && !menu.contains(event.target)) {
          menu.open = false;
        }
      }
    };
    document.addEventListener("pointerdown", dismiss);
    document.addEventListener("keydown", dismiss);
    return () => {
      document.removeEventListener("pointerdown", dismiss);
      document.removeEventListener("keydown", dismiss);
    };
  }, []);

  useEffect(() => {
    if (language !== "system") return;
    const syncLanguage = () => {
      const next = systemLocale(navigator.languages);
      if (next !== locale)
        window.location.replace(localePath(next) + window.location.search + window.location.hash);
    };
    window.addEventListener("languagechange", syncLanguage);
    return () => window.removeEventListener("languagechange", syncLanguage);
  }, [language, locale]);

  function chooseLanguage(next: LanguagePreference) {
    persistPreference(LANGUAGE_COOKIE, next);
    setLanguage(next);
    if (languageMenu.current) languageMenu.current.open = false;
    languageMenu.current?.querySelector("summary")?.focus();
    const resolved = next === "system" ? systemLocale(navigator.languages) : next;
    if (resolved !== locale)
      window.location.assign(localePath(resolved) + window.location.search + window.location.hash);
  }

  function chooseTheme(next: ThemePreference) {
    persistPreference(THEME_COOKIE, next);
    document.documentElement.setAttribute("data-theme", next);
    setTheme(next);
    if (themeMenu.current) themeMenu.current.open = false;
    themeMenu.current?.querySelector("summary")?.focus();
  }

  return (
    <div className="website-preferences">
      <details
        className="preference-menu"
        ref={languageMenu}
        onToggle={(event) => {
          if (event.currentTarget.open && themeMenu.current) themeMenu.current.open = false;
        }}
      >
        <summary aria-label={`${t.language}: ${t.languageOptions[language]}`}>
          <ControlIcon name="globe" />
          <span className="preference-value">
            {language === "system" ? t.systemShort : language === "zh" ? "中" : "EN"}
          </span>
          <span className="preference-chevron" aria-hidden="true" />
        </summary>
        <div className="preference-panel" role="group" aria-label={t.language}>
          <p>{t.language}</p>
          {(["system", "zh", "en"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className="preference-option"
              aria-pressed={language === value}
              onClick={() => chooseLanguage(value)}
            >
              {t.languageOptions[value]}
              {language === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </details>
      <details
        className="preference-menu theme-menu"
        ref={themeMenu}
        onToggle={(event) => {
          if (event.currentTarget.open && languageMenu.current) languageMenu.current.open = false;
        }}
      >
        <summary
          aria-label={`${t.theme}: ${t.themeOptions[theme]}`}
          title={`${t.theme}: ${t.themeOptions[theme]}`}
        >
          <ControlIcon name={theme === "system" ? "monitor" : theme === "dark" ? "moon" : "sun"} />
        </summary>
        <div className="preference-panel" role="group" aria-label={t.theme}>
          <p>{t.theme}</p>
          {(["system", "light", "dark"] as const).map((value) => (
            <button
              type="button"
              key={value}
              className="preference-option"
              aria-pressed={theme === value}
              onClick={() => chooseTheme(value)}
            >
              <ControlIcon
                name={value === "system" ? "monitor" : value === "dark" ? "moon" : "sun"}
              />
              {t.themeOptions[value]}
              {theme === value && <span aria-hidden="true">✓</span>}
            </button>
          ))}
        </div>
      </details>
    </div>
  );
}
