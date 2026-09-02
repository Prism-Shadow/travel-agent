/**
 * Money rendering for trip budgets (lib/currency.ts) and the home-currency default
 * (state/theme.tsx): the symbol follows the reader's language and is qualified exactly when
 * that language would otherwise read it as its own; an unset preference follows the UI language.
 */
import { describe, expect, it } from "vitest";
import { currencyGlyph, formatTripAmount } from "../src/lib/currency";
import { homeCurrencyForLanguage } from "../src/state/theme";

describe("formatTripAmount", () => {
  it("uses the bare sign for the locale's own currency and qualifies the other's", () => {
    expect(formatTripAmount(20000, "CNY", "zh-CN")).toBe("¥20,000");
    expect(formatTripAmount(20000, "USD", "zh-CN")).toBe("US$20,000");
    expect(formatTripAmount(20000, "USD", "en-US")).toBe("$20,000");
    expect(formatTripAmount(20000, "CNY", "en-US")).toBe("CN¥20,000");
    expect(formatTripAmount(20000, "JPY", "zh-CN")).toBe("JP¥20,000");
  });

  it("renders whole units: a budget is a statement, not accounting", () => {
    expect(formatTripAmount(1234567, "EUR", "en-US")).toBe("€1,234,567");
  });
});

describe("currencyGlyph", () => {
  it("is the bare sign in every locale, so a tier scale reads ¥¥ or $$", () => {
    expect(currencyGlyph("CNY", "en-US")).toBe("¥");
    expect(currencyGlyph("USD", "zh-CN")).toBe("$");
    expect(currencyGlyph("GBP", "zh-CN")).toBe("£");
  });
});

describe("homeCurrencyForLanguage", () => {
  it("follows the stored UI language, then the device language, zh → CNY and else USD", () => {
    expect(homeCurrencyForLanguage("zh", "en-US")).toBe("CNY");
    expect(homeCurrencyForLanguage("en", "zh-CN")).toBe("USD");
    expect(homeCurrencyForLanguage("system", "zh-TW")).toBe("CNY");
    expect(homeCurrencyForLanguage(null, "fr-FR")).toBe("USD");
    expect(homeCurrencyForLanguage(null, undefined)).toBe("USD");
  });
});
