/**
 * Turning what someone typed in the address bar into a URL the pane will accept.
 *
 * Two jobs, and the second is the reason this is not a one-liner:
 *
 *  1. **Complete it.** People type `ctrip.com`, not `https://ctrip.com`. A browser adds the scheme;
 *     an address bar that refuses without one is not an address bar. https for a public host, and
 *     **http for loopback**, where an https guess does not merely redirect — it fails to connect.
 *  2. **Refuse the rest, precisely.** The pane navigates http and https only (`isNavigableUrl` in
 *     the main process enforces the same rule). `file:` reads the user's disk, `javascript:` runs in
 *     the page, custom schemes reach other applications, and `chrome:` is Chromium's own settings.
 *     Each of those is a refusal with a reason, not a silent no-op.
 *
 * The awkward case is `localhost:3000`, which `new URL` happily parses as the scheme `localhost:`
 * with path `3000`. Scheme detection is therefore explicit rather than delegated: a scheme counts
 * only when it is followed by `//`, or when it is one of the opaque ones that never are.
 */

export type NormalizedUrl =
  { ok: true; url: string } | { ok: false; reason: "empty" | "scheme" | "invalid" };

/** `scheme:` at the start, per RFC 3986's production. */
const SCHEME = /^([a-z][a-z0-9+.-]*):/i;
/** `host:port` — what `localhost:3000` is, and what the scheme pattern above also matches. */
const HOST_PORT = /^[a-z0-9.-]+:\d+(?:[/?#]|$)/i;

export function normalizeUrlInput(raw: string): NormalizedUrl {
  const text = raw.trim();
  if (text === "") return { ok: false, reason: "empty" };
  // Whitespace inside is never a URL; it is a search someone typed into the wrong box. The pane has
  // no search engine, so saying so beats navigating to a mangled host.
  if (/\s/.test(text)) return { ok: false, reason: "invalid" };

  const scheme = SCHEME.exec(text);
  if (scheme && !HOST_PORT.test(text)) {
    const protocol = scheme[1]!.toLowerCase();
    if (protocol !== "http" && protocol !== "https") return { ok: false, reason: "scheme" };
    return parse(text);
  }

  // No scheme, or a `host:port` that only looked like one. https for a public host, because a site
  // that only speaks http will redirect, whereas defaulting to http downgrades every site that
  // would have been secure.
  //
  // Loopback is the exception, and not a small one: a local development server is almost never
  // TLS, and "it will redirect" is false for one — an http-only server cannot answer a TLS
  // handshake at all, so `localhost:3000` would simply fail to connect.
  return parse(`${isLoopbackHost(text) ? "http" : "https"}://${text}`);
}

/**
 * Whether an address with no scheme names this machine.
 *
 * Deliberately practical rather than exhaustive: the whole `127.0.0.0/8` block, `::1` in the form a
 * URL carries it, and the two names that resolve there. Anything else is treated as public, which
 * is the safe direction — the cost of being wrong is a redirect, not a downgrade.
 */
function isLoopbackHost(text: string): boolean {
  const host = text.split(/[/?#]/, 1)[0]?.split("@").pop() ?? "";
  const bare = host.replace(/:\d+$/, "").toLowerCase();
  if (bare === "localhost" || bare === "localhost.localdomain") return true;
  if (bare === "[::1]" || bare === "::1") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(bare);
}

function parse(candidate: string): NormalizedUrl {
  let url: URL;
  try {
    url = new URL(candidate);
  } catch {
    return { ok: false, reason: "invalid" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return { ok: false, reason: "scheme" };
  // A URL with no host is `https:///foo` and similar — parseable, not navigable.
  if (url.hostname === "") return { ok: false, reason: "invalid" };
  return { ok: true, url: url.toString() };
}

/**
 * What to show in the address bar for a given URL.
 *
 * `about:blank` is an implementation detail of a tab that has not gone anywhere yet, and showing it
 * would invite the user to edit it.
 */
export function displayUrl(url: string): string {
  return url === "about:blank" ? "" : url;
}

/** The origin, for the compact status line: it is what tells a user where they actually are. */
export function originOf(url: string): string {
  if (!url || url === "about:blank") return "";
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}
