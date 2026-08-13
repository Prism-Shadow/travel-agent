import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { CheckpointStore } from "../src/checkpoint.js";
import { escalation } from "../src/escalation.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "txn-cp-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe("CheckpointStore", () => {
  it("reads back what it wrote", async () => {
    const store = new CheckpointStore<{ candidates: number }>(path.join(root, "cp.json"));
    expect(await store.read()).toBeUndefined();

    await store.write("exploring", { candidates: 12 });
    const read = await store.read();
    expect(read?.stage).toBe("exploring");
    expect(read?.payload).toEqual({ candidates: 12 });
    expect(read?.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });

  it("advances the stage in place", async () => {
    const store = new CheckpointStore(path.join(root, "cp.json"));
    await store.write("exploring", { a: 1 });
    await store.write("representatives_ready", { b: 2 });
    expect((await store.read())?.stage).toBe("representatives_ready");
  });

  it("creates missing parent directories", async () => {
    const store = new CheckpointStore(path.join(root, "deep", "nested", "cp.json"));
    await store.write("presence_check", {});
    expect((await store.read())?.stage).toBe("presence_check");
  });

  // A half-written checkpoint costs at most some repeated read-only work, unlike a half-written
  // journal — so it degrades to "no checkpoint" rather than failing the task.
  it("treats a corrupt checkpoint as absent", async () => {
    const file = path.join(root, "cp.json");
    await fs.writeFile(file, "{ not json");
    expect(await new CheckpointStore(file).read()).toBeUndefined();
  });

  it("leaves no temp file behind", async () => {
    const store = new CheckpointStore(path.join(root, "cp.json"));
    await store.write("filling", {});
    expect((await fs.readdir(root)).filter((name) => name.includes("tmp"))).toEqual([]);
  });

  it("clear removes it and is safe to call twice", async () => {
    const store = new CheckpointStore(path.join(root, "cp.json"));
    await store.write("done", {});
    await store.clear();
    await store.clear();
    expect(await store.read()).toBeUndefined();
  });
});

describe("escalation", () => {
  it("defaults to suspending on lapse, not failing", () => {
    const esc = escalation({ kind: "capability_gap", ask: "请输入验证码", summary: "登录被拦截" });
    expect(esc.onTimeout).toBe("suspend");
    expect(esc.timeoutMs).toBe(120_000);
    expect(esc.id).toMatch(/^esc-/);
  });

  // Every option must justify its place on the card: a person scanning a phone decides from the
  // rationale, not by comparing attributes.
  it("refuses an option that cannot say why it is on the card", () => {
    expect(() =>
      escalation({
        kind: "knowledge_gap",
        ask: "选一个方案",
        summary: "三个候选",
        options: [{ id: "a", label: "东航 MU5137", rationale: "  ", plan: {} }],
      }),
    ).toThrow(/rationale/);
  });

  it("accepts options that carry a rationale", () => {
    const esc = escalation({
      kind: "knowledge_gap",
      ask: "选一个方案",
      summary: "北京 → 上海 8月20日",
      options: [
        { id: "a", label: "东航 MU5137 14:20 ¥1280", rationale: "唯一直飞", plan: { price: 1280 } },
        {
          id: "b",
          label: "春秋 9C8916 13:05 ¥880",
          rationale: "最便宜，省 400",
          plan: { price: 880 },
        },
      ],
    });
    expect(esc.context.options).toHaveLength(2);
    expect(esc.kind).toBe("knowledge_gap");
  });

  it("requires a default option when the lapse policy is to proceed", () => {
    expect(() =>
      escalation({
        kind: "knowledge_gap",
        ask: "选一个",
        summary: "s",
        onTimeout: "proceed_with_default",
      }),
    ).toThrow(/defaultOptionId/);
  });

  it("ids are unique within a process", () => {
    const ids = new Set(
      Array.from(
        { length: 50 },
        () => escalation({ kind: "authority_gap", ask: "确认", summary: "s" }).id,
      ),
    );
    expect(ids.size).toBe(50);
  });
});
