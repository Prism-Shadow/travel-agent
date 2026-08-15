/**
 * Tab lifecycle policy (src/tab-lifecycle.ts).
 *
 * Every rule here decides the fate of a page a user may have been working in, so each is asserted
 * directly rather than inferred from Electron behaviour. Three of these tests exist because the
 * first implementation got them wrong in the dangerous direction — treating an OOM kill as a
 * deliberate close, restoring a dead run's ownership, and losing a good checkpoint to a failed
 * rename.
 */
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  TAB_CHECKPOINT_VERSION,
  TabCheckpointStore,
  buildCheckpoint,
  isRestorableUrl,
  mergeCheckpoints,
  parseCheckpoint,
  pendingRestoreCount,
  planCrashRecovery,
  planTaskEnd,
  resolveTabDisposition,
} from "../src/tab-lifecycle.js";
import type { TabCheckpointEntry } from "../src/tab-lifecycle.js";

const tempDirs: string[] = [];

function tempFile(name = "checkpoint.json"): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "iab-checkpoint-"));
  tempDirs.push(dir);
  return path.join(dir, name);
}

afterEach(() => {
  vi.restoreAllMocks();
  while (tempDirs.length > 0) {
    const dir = tempDirs.pop()!;
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

describe("resolveTabDisposition", () => {
  it("closes a read-only task's tabs", () => {
    expect(resolveTabDisposition({ id: "t1", retain: false, ownedByTask: "a" }, "read_only")).toBe(
      "close",
    );
  });

  it.each(["committed", "failed", "unknown"] as const)("retains after %s", (outcome) => {
    expect(resolveTabDisposition({ id: "t1", retain: false, ownedByTask: "a" }, outcome)).toBe(
      "retain",
    );
  });

  it("lets the user's own mark override the read-only rule", () => {
    // The rule that outranks every other rule: a user who said "keep this" must not have it
    // overturned by a policy that classified the task as a search.
    expect(resolveTabDisposition({ id: "t1", retain: true, ownedByTask: "a" }, "read_only")).toBe(
      "retain",
    );
  });
});

describe("planTaskEnd", () => {
  const tabs = [
    { id: "t1", retain: false, ownedByTask: "task-a" },
    { id: "t2", retain: true, ownedByTask: "task-a" },
    { id: "t3", retain: false, ownedByTask: "task-b" },
    { id: "t4", retain: false, ownedByTask: null },
  ];

  it("only considers the ending task's tabs", () => {
    const plan = planTaskEnd(tabs, "task-a", "read_only");
    expect(plan.close).toEqual(["t1"]);
    expect(plan.retain).toEqual(["t2"]);
  });

  it("never touches a tab that has already been released", () => {
    // A released tab is the user's. Ending any task must leave it exactly where it is.
    expect(planTaskEnd(tabs, "task-a", "failed").close).not.toContain("t4");
    expect(planTaskEnd(tabs, "task-a", "failed").retain).not.toContain("t4");
  });

  it("is a no-op the second time, so a repeated end cannot close twice", () => {
    const after = tabs.map((tab) =>
      tab.ownedByTask === "task-a" ? { ...tab, ownedByTask: null } : tab,
    );
    expect(planTaskEnd(after, "task-a", "read_only")).toEqual({ close: [], retain: [] });
  });
});

describe("planCrashRecovery", () => {
  it("rebuilds a crashed tab at its last URL", () => {
    expect(planCrashRecovery({ reason: "crashed", lastUrl: "https://ctrip.com/" })).toEqual({
      rebuild: true,
      url: "https://ctrip.com/",
    });
  });

  it.each(["oom", "killed", "abnormal-exit", "launch-failed", "integrity-failure"] as const)(
    "rebuilds after %s",
    (reason) => {
      // `killed` above all: the Linux OOM killer, a container memory limit and a user's `kill -9`
      // all report it, and those are exactly the cases where the page must come back. An earlier
      // revision read it as "someone closed this deliberately" and silently dropped the tab.
      expect(planCrashRecovery({ reason, lastUrl: "https://ctrip.com/" }).rebuild).toBe(true);
    },
  );

  it("does not rebuild what we are closing ourselves", () => {
    expect(
      planCrashRecovery({ reason: "killed", lastUrl: "https://ctrip.com/", deliberate: true }),
    ).toEqual({ rebuild: false });
  });

  it("does not rebuild after a clean exit", () => {
    expect(planCrashRecovery({ reason: "clean-exit", lastUrl: "https://ctrip.com/" })).toEqual({
      rebuild: false,
    });
  });

  it("rebuilds empty rather than reopening a URL it would refuse to navigate", () => {
    expect(planCrashRecovery({ reason: "crashed", lastUrl: "about:blank" })).toEqual({
      rebuild: true,
    });
    expect(planCrashRecovery({ reason: "crashed", lastUrl: "file:///etc/passwd" })).toEqual({
      rebuild: true,
    });
  });
});

describe("isRestorableUrl", () => {
  it.each(["https://ctrip.com/", "http://localhost:3000/x"])("allows %s", (url) => {
    expect(isRestorableUrl(url)).toBe(true);
  });

  it.each(["file:///etc/passwd", "javascript:alert(1)", "chrome://settings", "about:blank", ""])(
    "refuses %s",
    (url) => {
      expect(isRestorableUrl(url)).toBe(false);
    },
  );
});

describe("buildCheckpoint", () => {
  const entry = (over: Partial<TabCheckpointEntry> = {}): TabCheckpointEntry => ({
    id: "t1",
    url: "https://ctrip.com/",
    taskScope: "session-1",
    retain: false,
    active: false,
    ...over,
  });

  it("keeps only URLs that could be reopened", () => {
    const checkpoint = buildCheckpoint([entry(), entry({ id: "t2", url: "about:blank" })]);
    expect(checkpoint.tabs.map((tab) => tab.id)).toEqual(["t1"]);
    expect(checkpoint.version).toBe(TAB_CHECKPOINT_VERSION);
  });

  it("writes no owner at all, so a restore cannot resurrect one", () => {
    // The strongest form of "restored tabs come back unowned": the field is not in the format, so
    // no reader can be tempted by it and no writer can start emitting it by accident.
    const [written] = buildCheckpoint([entry()]).tabs;
    expect(written && "ownedByTask" in written).toBe(false);
  });
});

describe("parseCheckpoint", () => {
  const file = (tabs: unknown[]): string =>
    JSON.stringify({ version: TAB_CHECKPOINT_VERSION, tabs });

  it("round-trips what buildCheckpoint wrote", () => {
    const built = buildCheckpoint([
      { id: "t1", url: "https://ctrip.com/", taskScope: "s1", retain: true, active: true },
    ]);
    expect(parseCheckpoint(JSON.stringify(built))).toEqual(built);
  });

  it.each(["", "not json", "{}", '{"version":2,"tabs":[]}', '{"version":1}'])(
    "returns null for %s",
    (raw) => {
      expect(parseCheckpoint(raw)).toBeNull();
    },
  );

  it("drops an entry with a URL it would not navigate to", () => {
    const parsed = parseCheckpoint(
      file([
        { id: "t1", url: "file:///etc/passwd", taskScope: "s1" },
        { id: "t2", url: "https://ok.example/", taskScope: "s1" },
      ]),
    );
    expect(parsed?.tabs.map((tab) => tab.id)).toEqual(["t2"]);
  });

  it("ignores an ownedByTask someone added to the file", () => {
    const parsed = parseCheckpoint(
      file([{ id: "t1", url: "https://ok.example/", taskScope: "s1", ownedByTask: "task-old" }]),
    );
    expect(parsed?.tabs[0] && "ownedByTask" in parsed.tabs[0]).toBe(false);
  });

  it("drops a duplicate id rather than keeping two tabs that answer to one name", () => {
    const parsed = parseCheckpoint(
      file([
        { id: "t1", url: "https://a.example/", taskScope: "s1" },
        { id: "t1", url: "https://b.example/", taskScope: "s1" },
      ]),
    );
    expect(parsed?.tabs).toHaveLength(1);
    expect(parsed?.tabs[0]?.url).toBe("https://a.example/");
  });

  it("keeps at most one active tab per scope", () => {
    const parsed = parseCheckpoint(
      file([
        { id: "t1", url: "https://a.example/", taskScope: "s1", active: true },
        { id: "t2", url: "https://b.example/", taskScope: "s1", active: true },
        { id: "t3", url: "https://c.example/", taskScope: "s2", active: true },
      ]),
    );
    expect(parsed?.tabs.filter((tab) => tab.taskScope === "s1" && tab.active)).toHaveLength(1);
    expect(parsed?.tabs.find((tab) => tab.id === "t3")?.active).toBe(true);
  });

  it("refuses an over-long id and blanks an over-long scope", () => {
    const parsed = parseCheckpoint(
      file([
        { id: "x".repeat(65), url: "https://a.example/", taskScope: "s1" },
        { id: "t2", url: "https://b.example/", taskScope: "s".repeat(129) },
      ]),
    );
    expect(parsed?.tabs.map((tab) => tab.id)).toEqual(["t2"]);
    expect(parsed?.tabs[0]?.taskScope).toBeNull();
  });

  it("caps how many tabs a file can claim", () => {
    const many = Array.from({ length: 250 }, (_unused, index) => ({
      id: `t${index}`,
      url: `https://example.com/${index}`,
      taskScope: "s1",
    }));
    expect(parseCheckpoint(file(many))?.tabs.length).toBe(100);
  });
});

describe("mergeCheckpoints", () => {
  const tab = (over: Partial<TabCheckpointEntry>): TabCheckpointEntry => ({
    id: "t1",
    url: "https://a.example/",
    taskScope: "s1",
    retain: false,
    active: false,
    ...over,
  });

  it("keeps both runs' pages", () => {
    // The case: crashed, the user closed the window without answering the prompt, opened the app
    // again, crashed again. Neither run's pages may be dropped because the prompt outlived one.
    const merged = mergeCheckpoints(
      buildCheckpoint([tab({ url: "https://a.example/" })]),
      buildCheckpoint([tab({ id: "t9", url: "https://b.example/" })]),
    );
    expect(merged.tabs.map((entry) => entry.url)).toEqual([
      "https://a.example/",
      "https://b.example/",
    ]);
  });

  it("de-duplicates the same page in the same conversation", () => {
    const merged = mergeCheckpoints(
      buildCheckpoint([tab({ url: "https://a.example/" })]),
      buildCheckpoint([tab({ id: "t9", url: "https://a.example/" })]),
    );
    expect(merged.tabs).toHaveLength(1);
  });

  it("keeps the same URL in different conversations apart", () => {
    const merged = mergeCheckpoints(
      buildCheckpoint([tab({ url: "https://a.example/", taskScope: "s1" })]),
      buildCheckpoint([tab({ id: "t9", url: "https://a.example/", taskScope: "s2" })]),
    );
    expect(merged.tabs).toHaveLength(2);
  });

  it("renumbers ids so two runs' tabs cannot collide", () => {
    // Ids are per-run; a duplicate would be dropped by the parser on the way back in.
    const merged = mergeCheckpoints(
      buildCheckpoint([tab({ id: "tab-1", url: "https://a.example/" })]),
      buildCheckpoint([tab({ id: "tab-1", url: "https://b.example/" })]),
    );
    expect(new Set(merged.tabs.map((entry) => entry.id)).size).toBe(2);
    expect(parseCheckpoint(JSON.stringify(merged))?.tabs).toHaveLength(2);
  });

  it("keeps one active tab per conversation", () => {
    const merged = mergeCheckpoints(
      buildCheckpoint([tab({ url: "https://a.example/", active: true })]),
      buildCheckpoint([tab({ id: "t9", url: "https://b.example/", active: true })]),
    );
    expect(merged.tabs.filter((entry) => entry.active)).toHaveLength(1);
  });
});

describe("TabCheckpointStore", () => {
  it("writes and reads back", () => {
    const store = new TabCheckpointStore(tempFile());
    const checkpoint = buildCheckpoint([
      { id: "t1", url: "https://ctrip.com/", taskScope: "s1", retain: false, active: true },
    ]);
    store.write(checkpoint);
    expect(store.read()).toEqual(checkpoint);
  });

  it("creates the directory it was pointed at", () => {
    const nested = path.join(path.dirname(tempFile()), "deeper", "checkpoint.json");
    const store = new TabCheckpointStore(nested);
    store.write(buildCheckpoint([]));
    expect(fs.existsSync(nested)).toBe(true);
  });

  it("returns null when there is no file", () => {
    expect(new TabCheckpointStore(tempFile("missing.json")).read()).toBeNull();
  });

  it("keeps the previous checkpoint when the replacement cannot be moved into place", () => {
    // The guarantee is "old or new, never neither". Windows can fail the rename while an antivirus
    // scanner holds the destination open; an earlier revision unlinked the destination first and
    // would have left the user with no checkpoint at all — losing exactly the pages the file
    // exists to recover.
    const target = tempFile();
    const store = new TabCheckpointStore(target);
    const good = buildCheckpoint([
      { id: "t1", url: "https://ctrip.com/", taskScope: "s1", retain: false, active: true },
    ]);
    store.write(good);

    const failure = Object.assign(new Error("EPERM"), { code: "EPERM" });
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw failure;
    });
    store.write(buildCheckpoint([]));
    vi.restoreAllMocks();

    expect(store.read()).toEqual(good);
  });

  it("leaves no temporary file behind after a failed replacement", () => {
    const target = tempFile();
    const store = new TabCheckpointStore(target);
    vi.spyOn(fs, "renameSync").mockImplementation(() => {
      throw Object.assign(new Error("EPERM"), { code: "EPERM" });
    });
    store.write(buildCheckpoint([]));
    vi.restoreAllMocks();
    expect(fs.readdirSync(path.dirname(target))).toEqual([]);
  });

  it("clears", () => {
    const store = new TabCheckpointStore(tempFile());
    store.write(buildCheckpoint([]));
    store.clear();
    expect(store.read()).toBeNull();
  });
});

describe("pendingRestoreCount", () => {
  it("is zero without a checkpoint", () => {
    expect(pendingRestoreCount(null)).toBe(0);
  });

  it("counts the tabs a crashed run left", () => {
    const checkpoint = buildCheckpoint([
      { id: "t1", url: "https://a.example/", taskScope: "s1", retain: false, active: false },
      { id: "t2", url: "https://b.example/", taskScope: "s1", retain: false, active: true },
    ]);
    expect(pendingRestoreCount(checkpoint)).toBe(2);
  });
});
