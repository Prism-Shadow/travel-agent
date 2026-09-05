/**
 * resolveServerConfig parsing tests.
 *
 * PORT: both the default (missing) and empty string (the common `PORT=` empty value in
 * `.env`) fall back to 7364 — Number("") === 0 used to make the empty string pass range
 * validation and bind to a random port; explicit "0" is preserved (explicit semantics
 * for a random available port); invalid values throw. (These semantics were shared
 * with the since-retired upstream CLI's serve command.)
 * PENGUIN_SEED_ADMIN_PASSWORD: unset/empty/whitespace → null (the fixed default at seed time).
 */
import { describe, expect, it } from "vitest";
import { resolveServerConfig } from "../src/config.js";

const base = { PENGUIN_HOME: "/tmp/penguin-config-test" };

describe("resolveServerConfig: PORT parsing", () => {
  it("defaults to 7364; empty string treated as unset (does not fall to port 0)", () => {
    expect(resolveServerConfig({ ...base }).port).toBe(7364);
    expect(resolveServerConfig({ ...base, PORT: "" }).port).toBe(7364);
  });

  it('explicit value takes effect; "0" is preserved (binds a random available port)', () => {
    expect(resolveServerConfig({ ...base, PORT: "8930" }).port).toBe(8930);
    expect(resolveServerConfig({ ...base, PORT: "0" }).port).toBe(0);
  });

  it("non-integer or out-of-range values throw", () => {
    for (const bad of ["abc", "3.14", "-1", "65536"]) {
      expect(() => resolveServerConfig({ ...base, PORT: bad }), bad).toThrow(/Invalid port/);
    }
  });
});

describe("resolveServerConfig: desktop-mode seed password", () => {
  it("desktop mode without a pinned value seeds the same fixed default as web mode", () => {
    // One rule in every mode: a data root opened later with `penguin web` answers to the
    // documented credentials, and the desktop token flow never needed the value anyway.
    expect(
      resolveServerConfig({ ...base, PENGUIN_DESKTOP_TOKEN: "tok" }).seedAdminPassword,
    ).toBeNull();
  });

  it("an explicit PENGUIN_SEED_ADMIN_PASSWORD still wins in desktop mode", () => {
    expect(
      resolveServerConfig({
        ...base,
        PENGUIN_DESKTOP_TOKEN: "tok",
        PENGUIN_SEED_ADMIN_PASSWORD: "pinned-password",
      }).seedAdminPassword,
    ).toBe("pinned-password");
  });
});

describe("resolveServerConfig: PENGUIN_SEED_ADMIN_PASSWORD parsing", () => {
  it("unset/empty/whitespace → null; a value is kept trimmed", () => {
    expect(resolveServerConfig({ ...base }).seedAdminPassword).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: "" }).seedAdminPassword,
    ).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: "  " }).seedAdminPassword,
    ).toBeNull();
    expect(
      resolveServerConfig({ ...base, PENGUIN_SEED_ADMIN_PASSWORD: " pinned-9999 " })
        .seedAdminPassword,
    ).toBe("pinned-9999");
  });
});
