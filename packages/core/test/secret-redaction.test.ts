/**
 * The secret-shape redactor (design/003 §4.6), tested with the shapes it exists to catch.
 *
 * This is the last line before a log or a crash report is written, so the cases that matter are the
 * ones a developer would carelessly interpolate: an environment dump, a caught exception whose
 * message quotes a request, a JSON body. What must survive is the *structure* a person reads the
 * log for — the key names, the surrounding prose — with only the value gone.
 */
import { describe, expect, it } from "vitest";

import { redactDeep, redactSecrets } from "../src/internal/secret-redaction.js";

describe("redactSecrets", () => {
  it("redacts a keyed assignment but keeps the key so the log still reads", () => {
    expect(redactSecrets("PENGUIN_INTERACTION_TOKEN=abc123def456")).toBe(
      "PENGUIN_INTERACTION_TOKEN=[REDACTED:secret]",
    );
    expect(redactSecrets('{"apiKey":"sk-verysecretvalue"}')).toContain("[REDACTED:secret]");
    expect(redactSecrets('{"apiKey":"sk-verysecretvalue"}')).toContain("apiKey");
  });

  it("redacts a bearer token in an Authorization header, value and all", () => {
    // The `authorization` key names a secret, so the whole header value goes — the strongest
    // reading, and the one that leaves nothing of the token behind.
    const line = "GET /x\nAuthorization: Bearer eyJhbGciOi.JIUzI1NiIsInR5cCI6";
    const out = redactSecrets(line);
    expect(out).toContain("Authorization: [REDACTED:secret]");
    expect(out).not.toContain("eyJhbGciOi");
  });

  it("redacts a standalone bearer token that has no header key", () => {
    const out = redactSecrets("connecting with bearer eyJhbGciOiJIUzI1NiIsInR5cCI");
    expect(out).toContain("bearer [REDACTED:token]");
    expect(out).not.toContain("eyJhbGci");
  });

  it("redacts a PenguinHarness env secret whatever the value looks like", () => {
    expect(redactSecrets("PENGUIN_BROKER_TOKEN: short")).toContain("[REDACTED:secret]");
    expect(redactSecrets("PENGUIN_DESKTOP_TOKEN=x")).toBe(
      "PENGUIN_DESKTOP_TOKEN=[REDACTED:secret]",
    );
  });

  it("redacts a card number, grouped or not", () => {
    expect(redactSecrets("card 4242 4242 4242 4242 on file")).toBe("card [REDACTED:pan] on file");
    expect(redactSecrets("pan=4242424242424242")).toContain("[REDACTED:");
    expect(redactSecrets("pan=4242424242424242")).not.toContain("4242424242424242");
  });

  it("redacts a long opaque token run", () => {
    const token = "A".repeat(40);
    expect(redactSecrets(`connect ${token} now`)).toBe("connect [REDACTED:token] now");
  });

  it("leaves an opaque vault handle alone — it is a safe reference, not a value", () => {
    // pv:<grantId>:<field> is designed to be loggable; redacting it would hurt debuggability for
    // no security gain.
    expect(redactSecrets("filling pv:g-7f2a:id_number")).toBe("filling pv:g-7f2a:id_number");
  });

  it("leaves ordinary prose and short ids untouched", () => {
    const line = "task-1755000000000-aaaa1111 opened tab T-1 on ctrip.com in 42ms";
    expect(redactSecrets(line)).toBe(line);
  });

  it("is idempotent", () => {
    const once = redactSecrets("token=abcdefabcdefabcdef1234");
    expect(redactSecrets(once)).toBe(once);
  });

  it("catches the value even when the key name is unusual, via the opaque-run rule", () => {
    // A dumped credential with no telltale key still trips the length/shape floor.
    const out = redactSecrets("x-custom-header 9f8e7d6c5b4a39281706fedcba9876543210abcd");
    expect(out).toContain("[REDACTED:token]");
  });
});

describe("redactDeep", () => {
  it("redacts strings, and secret-shaped keys, throughout a structure", () => {
    const out = redactDeep({
      level: "error",
      env: { PENGUIN_BROKER_TOKEN: "abc", PATH: "/usr/bin" },
      headers: { authorization: "Bearer sekrit-token-value-1234" },
    }) as { env: Record<string, string>; headers: Record<string, string> };
    expect(out.env.PENGUIN_BROKER_TOKEN).toBe("[REDACTED:secret]");
    expect(out.env.PATH).toBe("/usr/bin");
    // A value filed under a secret-named key is redacted whole, whatever its shape.
    expect(out.headers.authorization).toBe("[REDACTED:secret]");
  });

  it("bounds its own depth rather than following a pathological object", () => {
    let deep: Record<string, unknown> = {};
    const root = deep;
    for (let i = 0; i < 20; i += 1) {
      const next: Record<string, unknown> = {};
      deep.child = next;
      deep = next;
    }
    expect(() => redactDeep(root, 5)).not.toThrow();
    expect(JSON.stringify(redactDeep(root, 5))).toContain("[REDACTED:depth]");
  });

  it("does not choke on a cycle", () => {
    const a: Record<string, unknown> = { name: "a" };
    a.self = a;
    expect(() => redactDeep(a)).not.toThrow();
    expect(JSON.stringify(redactDeep(a))).toContain("[REDACTED:cycle]");
  });

  it("passes non-string primitives through", () => {
    expect(redactDeep({ n: 42, b: true, z: null })).toEqual({ n: 42, b: true, z: null });
  });
});
