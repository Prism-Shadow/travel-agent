/**
 * Address-bar input handling (src/features/chat/browser-url.ts).
 *
 * Two things worth testing, and the second is why this is not a one-liner: an address bar has to
 * complete what people type, and it has to refuse the schemes the pane will not render — with the
 * awkward middle case of `localhost:3000`, which `new URL` reads as the scheme `localhost:`.
 */
import { describe, expect, it } from "vitest";
import { displayUrl, normalizeUrlInput, originOf } from "../src/features/chat/browser-url";

describe("normalizeUrlInput", () => {
  it.each([
    ["https://ctrip.com/", "https://ctrip.com/"],
    ["http://localhost:3000/x", "http://localhost:3000/x"],
    ["HTTPS://Ctrip.com/Hotels", "https://ctrip.com/Hotels"],
  ])("passes %s through", (input, expected) => {
    expect(normalizeUrlInput(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ["ctrip.com", "https://ctrip.com/"],
    ["www.ctrip.com/hotels", "https://www.ctrip.com/hotels"],
    ["  ctrip.com  ", "https://ctrip.com/"],
  ])("completes %s with https", (input, expected) => {
    // https rather than http for a public host: a site that only speaks http redirects, whereas
    // defaulting to http downgrades every site that would have been secure.
    expect(normalizeUrlInput(input)).toEqual({ ok: true, url: expected });
  });

  it.each([
    ["localhost:3000", "http://localhost:3000/"],
    ["localhost", "http://localhost/"],
    ["127.0.0.1:8080/health", "http://127.0.0.1:8080/health"],
    ["127.0.0.53", "http://127.0.0.53/"],
    ["[::1]:5173", "http://[::1]:5173/"],
  ])("completes %s with http, because loopback is not TLS", (input, expected) => {
    // The "it will redirect" argument is false for a local development server: an http-only server
    // cannot answer a TLS handshake at all, so an https guess does not redirect, it fails to
    // connect.
    expect(normalizeUrlInput(input)).toEqual({ ok: true, url: expected });
  });

  it("treats host:port as a host, not as a scheme", () => {
    // `new URL('localhost:3000')` parses as the scheme `localhost:` with path `3000`. Delegating
    // scheme detection to the URL parser would refuse the most common address a developer types.
    expect(normalizeUrlInput("localhost:3000").ok).toBe(true);
    expect(normalizeUrlInput("example.com:8443/x")).toEqual({
      ok: true,
      url: "https://example.com:8443/x",
    });
  });

  it("keeps an explicit scheme on a loopback address", () => {
    expect(normalizeUrlInput("https://localhost:3000/")).toEqual({
      ok: true,
      url: "https://localhost:3000/",
    });
  });

  it.each([
    "file:///etc/passwd",
    "javascript:alert(1)",
    "chrome://settings",
    "data:text/html,<h1>x</h1>",
    "mailto:someone@example.com",
    "ftp://files.example.com/",
    "vscode://open",
  ])("refuses %s by scheme", (input) => {
    expect(normalizeUrlInput(input)).toEqual({ ok: false, reason: "scheme" });
  });

  it.each(["", "   "])("reports empty input as empty rather than invalid", (input) => {
    expect(normalizeUrlInput(input)).toEqual({ ok: false, reason: "empty" });
  });

  it.each(["hotels in shanghai", "what is the best flight", "a b"])(
    "refuses %s rather than mangling a search into a host",
    (input) => {
      expect(normalizeUrlInput(input)).toEqual({ ok: false, reason: "invalid" });
    },
  );

  it("refuses a scheme with nothing after it", () => {
    expect(normalizeUrlInput("https://")).toEqual({ ok: false, reason: "invalid" });
  });
});

describe("displayUrl", () => {
  it("shows a real URL", () => {
    expect(displayUrl("https://ctrip.com/")).toBe("https://ctrip.com/");
  });

  it("hides about:blank, which is an implementation detail of an empty tab", () => {
    expect(displayUrl("about:blank")).toBe("");
  });
});

describe("originOf", () => {
  it("is the host, which is what tells a user where they are", () => {
    expect(originOf("https://hotels.ctrip.com/list?x=1")).toBe("hotels.ctrip.com");
  });

  it("is empty for a blank tab", () => {
    expect(originOf("about:blank")).toBe("");
    expect(originOf("")).toBe("");
  });

  it("falls back to the raw string when it cannot be parsed", () => {
    expect(originOf("not a url")).toBe("not a url");
  });
});
