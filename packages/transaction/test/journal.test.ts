/**
 * Journal tests, including the milestone's actual acceptance criterion: kill the process
 * around an irreversible action and prove recovery does not repeat it.
 *
 * The crash cases spawn a real child process and `SIGKILL` it — no mocked failure, no injected
 * exception. A duplicate order is a real-money bug, and the only convincing evidence that
 * recovery is safe is an actually-killed process.
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { DanglingIntentError, Journal, openJournal } from "../src/journal.js";

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), "txn-journal-"));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

const journalPath = () => path.join(root, "journal.jsonl");
/** Every time the fake "submit order" side effect ran, one line each. Never truncated. */
const sideEffectPath = () => path.join(root, "orders-submitted.log");

async function sideEffectCount(): Promise<number> {
  try {
    const raw = await fs.readFile(sideEffectPath(), "utf8");
    return raw.split("\n").filter((line) => line.trim() !== "").length;
  } catch {
    return 0;
  }
}

/** Absolute path to the module under test, independent of the runner's cwd. */
const JOURNAL_MODULE = fileURLToPath(new URL("../src/journal.ts", import.meta.url));

interface Child {
  process: ReturnType<typeof spawn>;
  /** Everything the child printed — surfaced in failures so a broken child is not a mystery. */
  output: () => string;
}

/**
 * Runs a snippet in a fresh Node process against the same journal file, so "recovery" means an
 * actual new process reading the log — not a reset object in the same heap.
 */
async function runChild(body: string): Promise<Child> {
  const scriptPath = path.join(root, `child-${Math.random().toString(36).slice(2)}.mts`);
  await fs.writeFile(
    scriptPath,
    `
import { openJournal } from ${JSON.stringify(JOURNAL_MODULE)};
import fs from 'node:fs';
const journalPath = ${JSON.stringify(journalPath())};
const sideEffectPath = ${JSON.stringify(sideEffectPath())};
const submitOrder = async () => {
  fs.appendFileSync(sideEffectPath, 'order-submitted\\n');
  return { orderId: 'ORD-1' };
};
// Holds the event loop open so the child survives until the parent SIGKILLs it. Awaiting a
// never-settling promise is not enough: with nothing else pending Node calls that an unsettled
// top-level await and exits 13, and the process would be gone before the kill lands.
const keepAlive = setInterval(() => {}, 1000);
void keepAlive;
${body}
`,
    "utf8",
  );

  const child = spawn(process.execPath, ["--experimental-strip-types", scriptPath], {
    stdio: ["ignore", "pipe", "pipe"],
  });
  let output = "";
  child.stdout?.on("data", (chunk) => (output += String(chunk)));
  child.stderr?.on("data", (chunk) => (output += String(chunk)));
  return { process: child, output: () => output };
}

function waitForExit(child: Child): Promise<number | null> {
  // The child may already be gone by the time we get here — registering an `exit` listener
  // after the fact would wait for an event that has already fired, i.e. forever.
  const { exitCode, signalCode } = child.process;
  if (exitCode !== null || signalCode !== null) return Promise.resolve(exitCode);
  return new Promise((resolve) => child.process.on("exit", (code) => resolve(code)));
}

async function waitForFile(filePath: string, child: Child, timeoutMs = 20_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    try {
      await fs.access(filePath);
      return;
    } catch {
      if (Date.now() > deadline) {
        throw new Error(
          `Timed out waiting for ${filePath}. Child output:\n${child.output() || "(none)"}`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 50));
    }
  }
}

describe("Journal replay semantics", () => {
  it("runs an action once and returns the recorded outcome forever after", async () => {
    const journal = await openJournal(journalPath());
    let runs = 0;
    const op = { action: "ctrip.submitHotelOrder", params: { hotel: "A", night: "2026-08-20" } };

    const first = await journal.replay(op, async () => {
      runs += 1;
      return { orderId: "ORD-1" };
    });
    const second = await journal.replay(op, async () => {
      runs += 1;
      return { orderId: "SHOULD-NOT-HAPPEN" };
    });

    expect(first).toEqual({ orderId: "ORD-1" });
    expect(second).toEqual({ orderId: "ORD-1" });
    expect(runs).toBe(1);
  });

  it("treats different params as different operations", async () => {
    const journal = await openJournal(journalPath());
    const seen: string[] = [];
    await journal.replay({ action: "book", params: { guest: "A" } }, async () => {
      seen.push("A");
      return "a";
    });
    await journal.replay({ action: "book", params: { guest: "B" } }, async () => {
      seen.push("B");
      return "b";
    });
    expect(seen).toEqual(["A", "B"]);
  });

  it("keys are insensitive to param key order", async () => {
    const journal = await openJournal(journalPath());
    let runs = 0;
    await journal.replay({ action: "book", params: { a: 1, b: 2 } }, async () => {
      runs += 1;
      return "x";
    });
    await journal.replay({ action: "book", params: { b: 2, a: 1 } }, async () => {
      runs += 1;
      return "y";
    });
    expect(runs).toBe(1);
  });

  it("an explicit key separates two legitimately identical operations", async () => {
    const journal = await openJournal(journalPath());
    let runs = 0;
    const exec = async () => {
      runs += 1;
      return runs;
    };
    await journal.replay({ action: "book", params: { room: "deluxe" }, key: "guest-1" }, exec);
    await journal.replay({ action: "book", params: { room: "deluxe" }, key: "guest-2" }, exec);
    expect(runs).toBe(2);
  });

  it("propagates a failing action without recording a result, and can be retried", async () => {
    const journal = await openJournal(journalPath());
    const op = { action: "book", params: { id: 1 } };
    await expect(
      journal.replay(op, async () => {
        throw new Error("network died");
      }),
    ).rejects.toThrow("network died");

    // The intent is on disk with no result: the action may or may not have landed, so the next
    // attempt must not blindly re-run.
    expect(journal.danglingIntents().map((entry) => entry.action)).toEqual(["book"]);
    await expect(journal.replay(op, async () => "second try")).rejects.toBeInstanceOf(
      DanglingIntentError,
    );
  });
});

describe("Journal recovery after a killed process", () => {
  // THE acceptance criterion for the transaction layer.
  it("does not resubmit an order when the process is killed between the action and its result", async () => {
    const child = await runChild(`
      const journal = await openJournal(journalPath);
      await journal.replay(
        { action: 'ctrip.submitHotelOrder', params: { hotel: 'A' } },
        async () => {
          const outcome = await submitOrder();
          // Killed here: the order exists in the outside world, the journal has only an intent.
          fs.writeFileSync(journalPath + '.killme', '1');
          await new Promise(() => {});
          return outcome;
        },
      );
    `);
    await waitForFile(`${journalPath()}.killme`, child);
    child.process.kill("SIGKILL");
    await waitForExit(child);

    expect(await sideEffectCount()).toBe(1);

    // Recovery, in this process: a dangling intent, and replay refuses to guess.
    const recovered = await openJournal(journalPath());
    const dangling = recovered.danglingIntents();
    expect(dangling).toHaveLength(1);
    expect(dangling[0]!.action).toBe("ctrip.submitHotelOrder");

    await expect(
      recovered.replay({ action: "ctrip.submitHotelOrder", params: { hotel: "A" } }, async () => {
        await fs.appendFile(sideEffectPath(), "order-submitted\n");
        return { orderId: "DUPLICATE" };
      }),
    ).rejects.toBeInstanceOf(DanglingIntentError);
    expect(await sideEffectCount()).toBe(1);

    // With a reconcile function — "go ask the order system what actually happened" — the task
    // continues, and the action still never runs a second time.
    const outcome = await recovered.replay(
      { action: "ctrip.submitHotelOrder", params: { hotel: "A" } },
      async () => {
        await fs.appendFile(sideEffectPath(), "order-submitted\n");
        return { orderId: "DUPLICATE" };
      },
      { reconcile: async () => ({ orderId: "ORD-1", reconciled: true }) },
    );
    expect(outcome).toEqual({ orderId: "ORD-1", reconciled: true });
    expect(await sideEffectCount()).toBe(1);

    // And the reconciled outcome is durable: a third process replays it, still no re-run.
    const again = await openJournal(journalPath());
    expect(again.danglingIntents()).toHaveLength(0);
    expect(
      await again.replay({ action: "ctrip.submitHotelOrder", params: { hotel: "A" } }, async () => {
        await fs.appendFile(sideEffectPath(), "order-submitted\n");
        return { orderId: "DUPLICATE" };
      }),
    ).toEqual({ orderId: "ORD-1", reconciled: true });
    expect(await sideEffectCount()).toBe(1);
  }, 60_000);

  it("does not rerun an order when the process is killed after the result was recorded", async () => {
    const child = await runChild(`
      const journal = await openJournal(journalPath);
      await journal.replay(
        { action: 'ctrip.submitHotelOrder', params: { hotel: 'A' } },
        submitOrder,
      );
      // Both records are fsynced by now; dying here must look like a clean completion.
      fs.writeFileSync(journalPath + '.killme', '1');
      await new Promise(() => {});
    `);
    await waitForFile(`${journalPath()}.killme`, child);
    child.process.kill("SIGKILL");
    await waitForExit(child);

    expect(await sideEffectCount()).toBe(1);

    const recovered = await openJournal(journalPath());
    expect(recovered.danglingIntents()).toHaveLength(0);
    const outcome = await recovered.replay(
      { action: "ctrip.submitHotelOrder", params: { hotel: "A" } },
      async () => {
        await fs.appendFile(sideEffectPath(), "order-submitted\n");
        return { orderId: "DUPLICATE" };
      },
    );
    expect(outcome).toEqual({ orderId: "ORD-1" });
    expect(await sideEffectCount()).toBe(1);
  }, 60_000);

  it("does not run the action at all when killed before it started", async () => {
    const child = await runChild(`
      fs.writeFileSync(journalPath + '.killme', '1');
      await new Promise(() => {});
    `);
    await waitForFile(`${journalPath()}.killme`, child);
    child.process.kill("SIGKILL");
    await waitForExit(child);

    expect(await sideEffectCount()).toBe(0);
    const recovered = await openJournal(journalPath());
    expect(recovered.danglingIntents()).toHaveLength(0);
    const outcome = await recovered.replay(
      { action: "ctrip.submitHotelOrder", params: { hotel: "A" } },
      async () => {
        await fs.appendFile(sideEffectPath(), "order-submitted\n");
        return { orderId: "ORD-FRESH" };
      },
    );
    expect(outcome).toEqual({ orderId: "ORD-FRESH" });
    expect(await sideEffectCount()).toBe(1);
  }, 60_000);
});

describe("Journal durability details", () => {
  it("drops a torn final line but keeps every complete record", async () => {
    const journal = await openJournal(journalPath());
    await journal.replay({ action: "a", params: {} }, async () => "done-a");
    await fs.appendFile(journalPath(), '{"seq":3,"kind":"inte');

    const reloaded = await openJournal(journalPath());
    let runs = 0;
    expect(
      await reloaded.replay({ action: "a", params: {} }, async () => {
        runs += 1;
        return "rerun";
      }),
    ).toBe("done-a");
    expect(runs).toBe(0);
  });

  it("refuses to load a log corrupt anywhere but the last line", async () => {
    await fs.writeFile(journalPath(), 'not json\n{"seq":2,"kind":"intent","key":"k","action":"a","params":{},"at":"x"}\n');
    await expect(openJournal(journalPath())).rejects.toThrow(/corrupt at line 1/);
  });

  it("inspect reports completed and dangling operations", async () => {
    const journal = await openJournal(journalPath());
    await journal.replay({ action: "done-op", params: {} }, async () => "ok");
    await expect(
      journal.replay({ action: "failed-op", params: {} }, async () => {
        throw new Error("boom");
      }),
    ).rejects.toThrow();

    expect(journal.inspect()).toEqual([
      { key: expect.any(String), action: "done-op", status: "completed", outcome: "ok" },
      { key: expect.any(String), action: "failed-op", status: "dangling" },
    ]);
  });

  it("requires load() before use", () => {
    const journal = new Journal(journalPath());
    expect(() => journal.danglingIntents()).toThrow(/load\(\)/);
  });
});
