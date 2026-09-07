import { cookies } from "next/headers";
import { LANGUAGE_COOKIE, THEME_COOKIE, languagePreference, themePreference } from "./preferences";

export async function requestPreferences() {
  const jar = await cookies();
  return {
    language: languagePreference(jar.get(LANGUAGE_COOKIE)?.value),
    theme: themePreference(jar.get(THEME_COOKIE)?.value),
  };
}
