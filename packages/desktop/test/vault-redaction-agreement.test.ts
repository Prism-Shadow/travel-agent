/**
 * Main's half of the redaction contract, pinned to shared golden values.
 *
 * Main (this package) registers a filled value and publishes fingerprints; the relay
 * (penguin-browser, `src/redaction.ts`) matches candidate text against them. The two implement
 * shape and hash independently, and no single-package suite would notice them drifting apart — a
 * changed truncation or a widened character class would simply make every fill invisible to
 * redaction, silently, which is the worst available failure mode.
 *
 * So both suites pin the **same golden constants**: this file and the "the golden pair" block in
 * `browser-cli/src/redaction.unit.test.ts` carry byte-identical inputs and expected outputs, and
 * an implementation that drifts fails its own golden test rather than silently disagreeing with
 * the other package. (A direct cross-package import is not expressible here: the desktop's
 * penguin-browser is a file-installed snapshot and its tsconfig roots exclude the sibling's
 * sources.)
 */
import { describe, expect, it } from "vitest";

import {
  fingerprintOf,
  shapeOf,
  SensitiveElementRegistry,
} from "../src/vault/sensitive-elements.js";

/** Keep byte-identical with browser-cli/src/redaction.unit.test.ts. */
const GOLDEN_SALT = Buffer.from("penguin-redaction-agreement-salt-2026!!!", "utf8");
const GOLDEN = [
  {
    value: "310101199001011234",
    shape: "dddddddddddddddddd",
    fingerprint: "62c14bee086c63d70d253b047ee24b4e",
  },
  { value: "E12345678", shape: "adddddddd", fingerprint: "278c4f26d96792d7922c810d76485a8e" },
] as const;

describe("the golden pair", () => {
  it("computes the pinned shape for each golden value", () => {
    for (const golden of GOLDEN) {
      expect(shapeOf(golden.value)).toBe(golden.shape);
    }
    // The classes themselves, so a widened class fails with a readable diff.
    expect(shapeOf("南京西路 1266 号")).toBe("aaaasddddsa");
  });

  it("computes the pinned fingerprint under the golden salt", () => {
    // Asserted as a value, not recomputed through the same function: the point is that an
    // implementation change fails *here*, which a round-trip test cannot do.
    for (const golden of GOLDEN) {
      expect(fingerprintOf(GOLDEN_SALT, golden.value)).toBe(golden.fingerprint);
    }
  });
});

describe("what main publishes for the relay", () => {
  it("publishes a matchable fingerprint and keeps the value out of it", () => {
    const registry = new SensitiveElementRegistry();
    registry.register({
      field: "id_number",
      value: "310101199001011234",
      targetId: "T-1",
      selector: "#idNumber",
    });
    const [published] = registry.publish("T-1");
    expect(published).toMatchObject({ field: "id_number", length: 18, shape: "d".repeat(18) });
    expect(registry.matches(published!, "310101199001011234")).toBe(true);
    expect(registry.matches(published!, "310101199001011235")).toBe(false);
    expect(JSON.stringify(published)).not.toContain("310101199001011234");
  });
});
