/**
 * Task-level checkpoints.
 *
 * Distinct from the browser's own state (which tab, which URL, the Playwright session's
 * `state`): this is where the *task* got to — requirements parsed, candidates gathered, the
 * representative set shown, which one the human picked. After a handoff or a crash the agent
 * resumes from here instead of re-running the search.
 *
 * Deliberately not durable across sessions. This project's product shape is a single delegated
 * booking, so a checkpoint's life is the session's life and it lives in the session scratchpad.
 * Long-lived state is what monitoring and re-booking would need, and those are out of scope —
 * carrying the machinery for them anyway would buy nothing and cost the hardest class of bug.
 *
 * A checkpoint is a value, not a lock: writing one is atomic (write-then-rename), reading one
 * never blocks, and a missing file simply means the task has not reached that stage yet.
 */
import fs from "node:fs/promises";
import path from "node:path";

/** Where a booking task has got to. Advances monotonically. */
export type TaskStage =
  | "presence_check"
  | "exploring"
  | "representatives_ready"
  | "awaiting_choice"
  | "filling"
  | "awaiting_confirmation"
  | "submitted"
  | "done";

export interface Checkpoint<TPayload = Record<string, unknown>> {
  stage: TaskStage;
  /** Stage-specific data: candidates, the representative set, the chosen plan. */
  payload: TPayload;
  updatedAt: string;
}

export class CheckpointStore<TPayload = Record<string, unknown>> {
  readonly filePath: string;

  constructor(filePath: string) {
    this.filePath = filePath;
  }

  /** The last checkpoint, or undefined when the task has not written one. */
  async read(): Promise<Checkpoint<TPayload> | undefined> {
    try {
      const raw = await fs.readFile(this.filePath, "utf8");
      return JSON.parse(raw) as Checkpoint<TPayload>;
    } catch (error) {
      const code = (error as NodeJS.ErrnoException).code;
      if (code === "ENOENT") return undefined;
      // A torn checkpoint is recoverable in a way a torn journal is not: the worst case is
      // redoing read-only work, so treat it as "no checkpoint" rather than failing the task.
      if (error instanceof SyntaxError) return undefined;
      throw error;
    }
  }

  /** Writes atomically (temp file + rename), so a crash never leaves a half-written stage. */
  async write(stage: TaskStage, payload: TPayload): Promise<Checkpoint<TPayload>> {
    const checkpoint: Checkpoint<TPayload> = {
      stage,
      payload,
      updatedAt: new Date().toISOString(),
    };
    await fs.mkdir(path.dirname(this.filePath), { recursive: true });
    const tempPath = `${this.filePath}.${process.pid}.tmp`;
    await fs.writeFile(tempPath, `${JSON.stringify(checkpoint, null, 2)}\n`, "utf8");
    await fs.rename(tempPath, this.filePath);
    return checkpoint;
  }

  async clear(): Promise<void> {
    await fs.rm(this.filePath, { force: true });
  }
}
