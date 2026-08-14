import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { developmentWebDistEnv } from "../src/runtime-env.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

describe("developmentWebDistEnv", () => {
  it("points a source-run desktop server at this checkout's Web build", () => {
    expect(developmentWebDistEnv(false, undefined)).toEqual({
      PENGUIN_WEB_DIST: path.join(repoRoot, "packages", "web", "dist"),
    });
  });

  it("lets packaged servers use their bundled web-dist", () => {
    expect(developmentWebDistEnv(true, undefined)).toEqual({});
  });

  it("preserves an explicit PENGUIN_WEB_DIST override", () => {
    expect(developmentWebDistEnv(false, "/custom/web-dist")).toEqual({});
  });
});
