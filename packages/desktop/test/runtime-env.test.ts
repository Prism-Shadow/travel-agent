import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { developmentWebDistEnv, tripsDirEnv } from "../src/runtime-env.js";

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

describe("tripsDirEnv", () => {
  it("gives a packaged app a trips folder in the person's home directory", () => {
    expect(tripsDirEnv(true, undefined, "/Users/someone")).toEqual({
      PENGUIN_TRIPS_DIR: path.join("/Users/someone", "Penguin Trips"),
    });
  });

  it("leaves a source run unset, so trips stay beside its dev data root", () => {
    // The guarantee this encodes: `pnpm desktop` runs against ~/.penguin/dev-data and must
    // never be able to write into real trips.
    expect(tripsDirEnv(false, undefined, "/Users/someone")).toEqual({});
  });

  it("preserves an explicit PENGUIN_TRIPS_DIR override in both modes", () => {
    expect(tripsDirEnv(true, "/custom/trips", "/Users/someone")).toEqual({});
    expect(tripsDirEnv(false, "/custom/trips", "/Users/someone")).toEqual({});
  });
});
