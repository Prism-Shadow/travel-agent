import assert from "node:assert/strict";
import test from "node:test";
import {
  LANGUAGE_COOKIE,
  THEME_COOKIE,
  languagePreference,
  themePreference,
  requestLocale,
  systemLocale,
  localePath,
  preferenceCookie,
} from "../lib/preferences.ts";

test("first visits and invalid saved values follow the system", () => {
  for (const value of [undefined, "", "auto", "invalid", "<script>"]) {
    assert.equal(languagePreference(value), "system");
    assert.equal(themePreference(value), "system");
  }
  assert.equal(languagePreference("en"), "en");
  assert.equal(themePreference("dark"), "dark");
  assert.equal(themePreference("light"), "light");
});

test("explicit language choices take precedence over the browser", () => {
  assert.equal(requestLocale("zh", "en-US,en;q=0.9"), "zh");
  assert.equal(requestLocale("en", "zh-CN,zh;q=0.9"), "en");
  assert.equal(localePath("zh"), "/");
  assert.equal(localePath("en"), "/en");
});

test("system language respects quality weights and excluded locales", () => {
  assert.equal(requestLocale("system", "en;q=0.4,zh-TW;q=0.9"), "zh");
  assert.equal(requestLocale("system", "zh-CN;q=0,en-US;q=1"), "en");
  assert.equal(requestLocale("system", "en;q=invalid,zh;q=0.6"), "zh");
  assert.equal(requestLocale("system", "fr-FR,zh-HK;q=0.8,en;q=0.5"), "zh");
  assert.equal(requestLocale("system", "fr-FR,de;q=0.9"), "en");
  assert.equal(requestLocale("system", ""), "en");
  assert.equal(systemLocale(["zh-Hans-CN", "en-US"]), "zh");
  assert.equal(systemLocale(["de-DE", "en-GB", "zh-CN"]), "en");
});

test("saved preferences are available to both locale routes for one year", () => {
  for (const [key, value] of [
    [LANGUAGE_COOKIE, "system"],
    [THEME_COOKIE, "dark"],
  ] as const) {
    const cookie = preferenceCookie(key, value);
    assert.ok(cookie.startsWith(`${key}=${value};`));
    assert.match(cookie, /; Path=\/;/);
    assert.match(cookie, /; Max-Age=31536000;/);
    assert.match(cookie, /; SameSite=Lax$/);
    assert.doesNotMatch(cookie, /Domain=/);
  }
});
