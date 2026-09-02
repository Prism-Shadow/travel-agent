/**
 * Money on the trip surfaces — the stated budget on a chip, a card's meta line, the composed
 * prompt. Rendered through Intl so the symbol is the one the reader's language uses, and
 * qualified exactly when that language would otherwise read it as its own: zh shows a CNY
 * budget as ¥20,000 and a USD one as US$20,000; en shows $20,000 and CN¥20,000. No exchange
 * rate lives here or anywhere else in the product: the model converts against the prices it
 * actually sees, and says so.
 */
import type { TripCurrency } from "@prismshadow/penguin-server/api";

/** "¥20,000" / "US$20,000" / "CN¥20,000": whole units, the locale's symbol. */
export function formatTripAmount(amount: number, currency: TripCurrency, locale: string): string {
  return new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "symbol",
    maximumFractionDigits: 0,
  }).format(amount);
}

/**
 * The one-glyph mark the tier scale repeats ("¥¥", "$$"): the narrow symbol, the bare sign.
 * Ambiguity is fine here — the scale is relative, and the currency it counts in stands beside it.
 */
export function currencyGlyph(currency: TripCurrency, locale: string): string {
  const parts = new Intl.NumberFormat(locale, {
    style: "currency",
    currency,
    currencyDisplay: "narrowSymbol",
  }).formatToParts(1);
  return parts.find((part) => part.type === "currency")?.value ?? currency;
}
