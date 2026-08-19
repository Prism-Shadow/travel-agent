/**
 * Scrubbing secret-shaped strings out of anything that gets written down.
 *
 * The vault has its own redaction — fingerprint-matching a *known* value out of a page snapshot.
 * This is the other kind: a log line, a crash payload, an error message that was *not* supposed to
 * contain a secret but might, because it interpolated an environment, an exception, or a request.
 * There is no known value to match here, so this works by **shape**: the patterns that a token, a
 * card number, or a credential-carrying assignment take, replaced with a labelled placeholder.
 *
 * Two honest limits, stated so nothing downstream oversells it:
 *
 * - **Shape is a heuristic, not a proof.** It catches the credential formats this project actually
 *   produces (base64url tokens, `PENGUIN_*` secrets, bearer headers, Luhn-valid card numbers) and
 *   will miss a secret that looks like ordinary prose. It is a safety net over the real rule, which
 *   is that values are not supposed to reach a log in the first place (the vault, the interaction
 *   layer and the broker all enforce that structurally). Defence in depth, not the depth.
 * - **It errs toward redacting, but not into uselessness.** A false redaction costs a
 *   `[REDACTED:…]` in a log; a missed one costs a credential. Where the two collide — a bare digit
 *   run that could be a card number or could be one of this system's own millisecond task-id
 *   timestamps — the card rule uses a Luhn check so a real PAN is caught without shredding every
 *   long number in the logs.
 *
 * Pure and dependency-free, so the exact behaviour is unit-tested and so it can run in the main
 * process, a utility process, or the server without dragging anything in.
 */

/** Substrings that make a key's value a secret, wherever the key appears. */
const SECRET_WORD =
  "token|secret|password|passwd|api[_-]?key|apikey|auth(?:orization)?|cookie|credential|bearer|session[_-]?id|private[_-]?key";

/** A key is "secret" when it contains one of the words above. Used for strings and for object keys. */
const SECRET_KEY_RE = new RegExp(`(?:${SECRET_WORD})`, "i");

interface RedactionRule {
  label: string;
  pattern: RegExp;
  replace: (...args: string[]) => string;
}

const RULES: RedactionRule[] = [
  // Header/JSON/env assignment where the *key* names a secret, quoted or not. The value runs to the
  // next structural delimiter (comma, quote, semicolon, ampersand, newline), so a header value like
  // `Bearer eyJ…` — spaces and all — is taken whole, while a following JSON field is not.
  {
    label: "secret-assignment",
    pattern: new RegExp(
      `("?)([A-Za-z0-9_.-]*(?:${SECRET_WORD})[A-Za-z0-9_.-]*)\\1(\\s*[:=]\\s*)("?)([^"',;&\\r\\n]*)\\4`,
      "gi",
    ),
    replace: (_m, k1, key, sep, v1, _value) => `${k1}${key}${k1}${sep}${v1}[REDACTED:secret]${v1}`,
  },
  // `Bearer <token>` standing on its own (not already caught as a header value).
  {
    label: "bearer",
    pattern: /\b(bearer\s+)[A-Za-z0-9._~+/=-]{8,}/gi,
    replace: (_m, prefix) => `${prefix}[REDACTED:token]`,
  },
  // A long opaque base64url/hex run with no spaces — the shape of a raw token or key. The length
  // floor keeps ordinary words, short ids and hashes-in-URLs from tripping it; `pv:` handles are
  // deliberately not matched (opaque references, safe to log — see the vault design).
  {
    label: "opaque-token",
    pattern: /(?<![A-Za-z0-9_/:-])(?![Pp][Vv]:)[A-Za-z0-9_-]{32,}(?![A-Za-z0-9_-])/g,
    replace: () => "[REDACTED:token]",
  },
];

/**
 * Whether a bare digit string is a payment card number.
 *
 * 13–19 digits *and* Luhn-valid. The Luhn check is what separates a real PAN from this system's own
 * long numbers — a millisecond task-id timestamp is 13 digits and almost never Luhn-valid — so the
 * card rule can be aggressive about length without redacting every timestamp in the logs.
 */
function looksLikeCard(digits: string): boolean {
  if (digits.length < 13 || digits.length > 19) return false;
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let value = digits.charCodeAt(i) - 48;
    if (double) {
      value *= 2;
      if (value > 9) value -= 9;
    }
    sum += value;
    double = !double;
  }
  return sum % 10 === 0;
}

/** Replaces card-number-shaped runs (tolerating the spaces/dashes people group them with). */
function redactCardNumbers(text: string): string {
  return text.replace(/\d(?:[ -]?\d){12,18}/g, (match) => {
    const digits = match.replace(/[ -]/g, "");
    return looksLikeCard(digits) ? "[REDACTED:pan]" : match;
  });
}

/**
 * Redacts secret-shaped substrings from a string.
 *
 * Named/keyed rules run before the generic opaque-token rule, so `token=abc…` becomes
 * `token=[REDACTED:secret]` (which says *what* was there) rather than the blunter
 * `[REDACTED:token]`. Idempotent: a `[REDACTED:…]` placeholder matches none of the patterns.
 */
export function redactSecrets(text: string): string {
  if (!text) return text;
  let out = text;
  for (const rule of RULES) {
    out = out.replace(rule.pattern, rule.replace);
  }
  return redactCardNumbers(out);
}

/**
 * Redacts secrets throughout a structure, returning a new one.
 *
 * Three things beyond a plain string pass: a value whose **key** names a secret is redacted whole
 * (a short token under `apiKey` would otherwise survive, since the value alone has no tell); keys
 * are themselves redacted (a token used as a map key); and the recursion is depth- and
 * cycle-bounded, because a crash reporter must never be the thing that crashes.
 */
export function redactDeep(value: unknown, maxDepth = 8): unknown {
  return redactAt(value, maxDepth, new WeakSet());
}

function redactAt(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return redactSecrets(value);
  if (value === null || typeof value !== "object") return value;
  if (depth <= 0) return "[REDACTED:depth]";
  if (seen.has(value)) return "[REDACTED:cycle]";
  seen.add(value);

  if (Array.isArray(value)) {
    return value.map((entry) => redactAt(entry, depth - 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    const safeKey = redactSecrets(key);
    // A value filed under a secret-named key is a secret whatever its shape.
    out[safeKey] = SECRET_KEY_RE.test(key)
      ? redactValueUnderSecretKey(entry, depth - 1, seen)
      : redactAt(entry, depth - 1, seen);
  }
  return out;
}

/** A string value under a secret key is fully redacted; a nested object is still walked. */
function redactValueUnderSecretKey(value: unknown, depth: number, seen: WeakSet<object>): unknown {
  if (typeof value === "string") return value === "" ? value : "[REDACTED:secret]";
  if (value !== null && typeof value === "object") return redactAt(value, depth, seen);
  return value;
}
