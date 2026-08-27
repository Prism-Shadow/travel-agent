/**
 * `/subagent-review` — four agents examine the same change and answer independently.
 *
 * Each is a separate `pi` process (`--mode json -p --no-session`), so its context is its own:
 * nothing it reads enters this session, and they cannot see each other. Three are given the same
 * model and thinking level and different *questions*, because the signal we want is disagreement
 * about the change, not disagreement about the reviewer. The fourth, `review-ci`, does not judge
 * at all — it runs the pre-push gate's stages and reports exit codes, which matters here
 * because GitHub Actions is paused and nothing else verifies a push.
 *
 * The reviewers live in `.pi/agents/review-*.md` as ordinary agent definitions — frontmatter for
 * the name and tool allowlist, body as the system prompt. Editing one takes effect on the next
 * run; there is nothing to reload.
 *
 * This is not the upstream `subagent` example. That one is a general delegation tool with
 * parallel/chain modes, streaming renderers and agent discovery. This is one command with a
 * fixed roster, which is all the review workflow needs.
 *
 * Two facts about running inside a command handler shape the rest of this file. Pi awaits the
 * handler, so for its whole life the agent is *not* streaming: `ctx.signal` is undefined and Esc
 * reaches nothing, hence the module-level `AbortController` and its own key. And the input loop is
 * not at `getUserInput()`, so a message submitted meanwhile is pushed to `pendingUserInputs`
 * unrendered and sent when this returns — queued, not lost, but invisible, which is why the panel
 * says so.
 */
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import type { ExtensionAPI, ExtensionCommandContext } from "@earendil-works/pi-coding-agent";
import { Box, Text } from "@earendil-works/pi-tui";

/**
 * The roster, in report order. Names match `.pi/agents/<name>.md`.
 *
 * `review-ci` is a different kind of participant from the other three and is marked so. They read
 * the diff and judge it; it runs the gate's stages and reports exit codes. Opinions and
 * facts are both wanted, but a reader must not mistake one for the other — so the report labels
 * it, and it gets the time a full build and test run actually takes.
 */
const REVIEWERS: ReadonlyArray<{
  name: string;
  kind: "judgement" | "execution";
  timeoutMs: number;
}> = [
  { name: "review-invariants", kind: "judgement", timeoutMs: 12 * 60 * 1000 },
  { name: "review-reachability", kind: "judgement", timeoutMs: 12 * 60 * 1000 },
  { name: "review-evidence", kind: "judgement", timeoutMs: 12 * 60 * 1000 },
  { name: "review-ci", kind: "execution", timeoutMs: 30 * 60 * 1000 },
];

/**
 * One model for all three. Different models would make a disagreement ambiguous — is this a real
 * defect, or just two models being different? Holding the model fixed means a split verdict is
 * about the change.
 */
const MODEL = "openai-codex/gpt-5.6-sol";
const THINKING = "xhigh";

/** Beyond this the diff is not a change under review, it is a branch. Reviewing it wastes money. */
const MAX_DIFF_BYTES = 400_000;

/**
 * Paths whose contents no gate executes — prose that ships to readers, not to the product.
 *
 * Deliberately a path rule, not a `.md` rule. Several markdown files in this repository *are*
 * product content with tests behind them: `packages/skills/skills/**\/SKILL.md` is installed
 * verbatim and `packages/skills/test/skills.test.ts` asserts its frontmatter, including that
 * `version` is a natural number bumped on every content change. Treating those as documentation
 * would skip the one suite that catches a malformed skill.
 */
const DOCUMENTATION_ONLY = [
  /^docs\//,
  /^tasks\//,
  /^artifacts\//,
  /^[^/]+\.md$/, // root-level prose: README, AGENTS, SPEC
  /^packages\/[^/]+\/SPEC\.md$/,
  // `.pi/agents/*.md` is deliberately absent. Those files look like prose and are not: each body
  // is the system prompt a reviewer runs under, so editing one changes what the next review does.
  // Classifying them as documentation would drop `review-ci` from the roster on the very change
  // that rewrites `review-ci`'s instructions — the edit would reach every later review without
  // ever having been exercised once.
];

/** True when nothing in the change is executed by any gate, so `review-ci` has nothing to prove. */
function isDocumentationOnly(paths: string[]): boolean {
  return paths.length > 0 && paths.every((p) => DOCUMENTATION_ONLY.some((re) => re.test(p)));
}

interface ReviewerResult {
  name: string;
  kind: "judgement" | "execution";
  text: string;
  error: string | null;
  costUsd: number;
  durationMs: number;
}

/**
 * What a reviewer is doing right now, for the widget above the editor.
 *
 * A run takes minutes and produces nothing until it ends. Without this the only evidence that
 * anything is happening is one frozen line of footer text, which is indistinguishable from a hang.
 */
interface LiveState {
  status: "running" | "done" | "failed";
  turns: number;
  activity: string;
  costUsd: number;
  startedAt: number;
  endedAt: number | null;
}

/**
 * The abort handle for the run in flight, or null.
 *
 * Module-level because the shortcut that cancels is registered once, outside any run. A command
 * handler cannot use `ctx.signal`: that is the *agent's* run signal, and it is undefined whenever
 * the agent is not streaming — which is exactly the case here, since extension commands are
 * dispatched before a turn starts. Without our own controller there is no way to stop a reviewer
 * short of killing pi.
 */
let activeRun: AbortController | null = null;

/**
 * Runs a call into pi that may happen after the command that started it has returned.
 *
 * Background work outlives its handler, and a session can be replaced under it by /new, /resume,
 * /fork or /reload. Every session-bound method then throws "stale after session replacement".
 * Swallowing that is right: a report delivered to a session the person has already left is worth
 * nothing, while an unhandled rejection from a detached promise takes down pi itself.
 */
function safely(fn: () => void): void {
  try {
    fn();
  } catch {
    /* the session moved on; there is nowhere left to deliver this */
  }
}

/** One line of evidence that a reviewer is alive: the tool it just started, with its subject. */
function describeTool(toolName: string, args: unknown): string {
  const record = (args ?? {}) as Record<string, unknown>;
  // Covers every tool in the allowlist: bash takes `command`, read/ls take `path`, grep/find
  // take `pattern`. Anything else degrades to the bare tool name rather than guessing.
  const subject = ["command", "path", "pattern"]
    .map((key) => record[key])
    .find((value) => typeof value === "string" && value.trim());
  return subject ? `${toolName} ${(subject as string).replace(/\s+/g, " ").trim()}` : toolName;
}

function clip(text: string, max: number): string {
  return text.length <= max ? text : `${text.slice(0, max - 1)}…`;
}

function clock(ms: number): string {
  const total = Math.round(ms / 1000);
  return `${Math.floor(total / 60)}m${String(total % 60).padStart(2, "0")}s`;
}

/**
 * How to invoke a child pi.
 *
 * Not the bare name `pi`: that assumes something is on PATH, which is the assumption that a
 * launcher pointing at a moved checkout satisfies right up until it runs. Prefer re-running the
 * exact script this process was started from, so the child is the same pi as the parent — same
 * version, same install. The bare name is the last resort, for a packaged binary that has no
 * script path to re-run.
 */
function piInvocation(args: string[]): { command: string; args: string[] } {
  const script = process.argv[1];
  // A bun single-file build reports a virtual path that exists only inside that process.
  if (script && !script.startsWith("/$bunfs/root/") && fs.existsSync(script)) {
    return { command: process.execPath, args: [script, ...args] };
  }
  const execName = path.basename(process.execPath).toLowerCase();
  // A generic runtime (`node`, `bun`) with no usable script path tells us nothing; anything else
  // is pi itself, compiled, and can take the arguments directly.
  if (!/^(node|bun)(\.exe)?$/.test(execName)) return { command: process.execPath, args };
  return { command: "pi", args };
}

/**
 * A visible pane per reviewer, when the terminal can give us one.
 *
 * One Herdr split holding a tmux grid, rather than four Herdr splits: Herdr's own guidance is to
 * "avoid repeated same-direction splits that create unusably narrow columns", and four columns on
 * the right is exactly that. tmux tiles 2x2 instead, which measured about 100x24 per cell — wide
 * enough to read a command. It is also one unit to close.
 *
 * What the panes show is *our* rendering, tailed from a file, not the child's raw stdout. The
 * child keeps streaming JSON to this process exactly as before, so the parsing that produces the
 * report is untouched by anything here — a display feature must not be able to break the result.
 */
interface PaneHandle {
  session: string;
  paneId: string;
}

/** Label put on the Herdr pane, and the only way a later run finds the one it may close. */
const PANE_LABEL = "subagent-review";
/** Prefix of the tmux sessions this extension creates. Nothing else may be matched by it. */
const TMUX_PREFIX = "ta-review-";

/**
 * Removes the previous run's pane, tmux session and logs.
 *
 * A finished review's pane is left open on purpose — the output is worth scrolling back through.
 * Left *accumulating*, though, it becomes a column of dead panes: each holds four `tail -f`
 * processes that never exit, and once the system sweeps the temp directory they are following
 * deleted inodes, so the pane still looks alive while being permanently blank. Keeping exactly
 * the most recent run is what "leave it open" was actually asking for.
 *
 * Identification is read from the running system rather than remembered: a module variable does
 * not survive `/reload`, and a state file can outlive the thing it describes. A pane qualifies
 * only if Herdr reports our label **and** its foreground process is an attach to one of our tmux
 * sessions — two independent facts, because closing a pane the person opened themselves would be
 * far worse than leaving one of ours behind.
 */
async function closePreviousRun(pi: ExtensionAPI, cwd: string, keepDir: string): Promise<void> {
  const sh = (cmd: string) => pi.exec("sh", ["-c", cmd], { cwd });

  const panes = await (async () => {
    try {
      const out = await pi.exec(
        "herdr",
        ["pane", "list", "--workspace", process.env.HERDR_WORKSPACE_ID ?? ""],
        { cwd },
      );
      const parsed = JSON.parse(out.stdout ?? "{}") as {
        result?: { panes?: Array<{ pane_id?: string }> };
      };
      return parsed.result?.panes ?? [];
    } catch {
      return [];
    }
  })();

  for (const p of panes) {
    const paneId = p.pane_id;
    if (!paneId || paneId === process.env.HERDR_PANE_ID) continue;
    try {
      const got = await pi.exec("herdr", ["pane", "get", paneId], { cwd });
      const label = (JSON.parse(got.stdout ?? "{}") as { result?: { pane?: { label?: string } } })
        .result?.pane?.label;
      if (label !== PANE_LABEL) continue;

      const info = await pi.exec("herdr", ["pane", "process-info", "--pane", paneId], { cwd });
      const running = JSON.stringify(
        (
          JSON.parse(info.stdout ?? "{}") as {
            result?: { process_info?: { foreground_processes?: unknown } };
          }
        ).result?.process_info?.foreground_processes ?? [],
      );
      // An empty pane sitting at a shell prompt is ours too — its tmux session already exited.
      // Anything running that is *not* our attach is someone else's work; leave it alone.
      if (running.includes("tmux") && !running.includes(TMUX_PREFIX)) continue;

      await pi.exec("herdr", ["pane", "close", paneId], { cwd });
    } catch {
      /* a pane that cannot be inspected is a pane we do not touch */
    }
  }

  // Sessions and logs last: killing a session first would drop the attach and leave the pane at a
  // prompt, which the label check above would then have to reason about mid-sweep.
  await sh(
    `tmux ls -F '#{session_name}' 2>/dev/null | grep '^${TMUX_PREFIX}' | xargs -I{} tmux kill-session -t {} 2>/dev/null; true`,
  );
  // Every run directory except the one this run is about to fill. The first version of this line
  // was a bare `subagent-review-*` glob, and the caller creates its directory *before* calling
  // here — so the cleanup deleted the logs of the run it was preparing, `writeFileSync` failed
  // with ENOENT, the catch in setupPanes swallowed it, and the review silently fell back to no
  // panes. A sweep has to know what is alive.
  //
  // Compared by basename, not by path: `$TMPDIR` carries a trailing slash on macOS, so `find`
  // prints `…/T//subagent-review-x` while Node's `path.dirname` yields `…/T/subagent-review-x`.
  // The second attempt used `! -path` against the latter, matched nothing, and deleted the live
  // directory exactly as before — a fix that tested clean in isolation and did nothing in place.
  const keep = path.basename(keepDir);
  await sh(
    `for d in "\${TMPDIR:-/tmp}"/subagent-review-*; do [ -d "$d" ] || continue; [ "$(basename "$d")" = ${JSON.stringify(keep)} ] && continue; rm -rf "$d"; done 2>/dev/null; true`,
  );
}

async function setupPanes(
  pi: ExtensionAPI,
  cwd: string,
  logs: Array<{ name: string; file: string }>,
): Promise<PaneHandle | null> {
  // Both must be true, and neither is worth faking: outside Herdr there is no pane to split, and
  // without tmux there is nothing to tile inside it.
  if (process.env.HERDR_ENV !== "1" || !process.env.HERDR_PANE_ID) return null;
  if ((await pi.exec("sh", ["-c", "command -v tmux"], { cwd })).code !== 0) return null;

  // Exactly one review is visible at a time: whatever the last run left is removed before this
  // one puts anything on screen. The directory holding this run's logs is named so it survives.
  const runDir = logs[0] ? path.dirname(logs[0].file) : "";
  await closePreviousRun(pi, cwd, runDir);

  const session = `${TMUX_PREFIX}${Date.now()}`;
  try {
    // `tail -f` on a file that does not exist yet exits immediately, so every log is created
    // before any pane is told to follow it.
    for (const l of logs) fs.writeFileSync(l.file, `${l.name}\n${"─".repeat(l.name.length)}\n\n`);

    const first = logs[0];
    if (!first) return null;
    const tail = (l: { name: string; file: string }) => `tail -f ${JSON.stringify(l.file)}`;
    if (
      (await pi.exec("tmux", ["new-session", "-d", "-s", session, tail(first)], { cwd })).code !== 0
    )
      return null;
    for (const l of logs.slice(1)) {
      await pi.exec("tmux", ["split-window", "-t", session, tail(l)], { cwd });
      await pi.exec("tmux", ["select-layout", "-t", session, "tiled"], { cwd });
    }

    // --no-focus, because the point is to watch the review without losing the cursor that started
    // it. The pane id comes out of the response rather than being predicted.
    const split = await pi.exec(
      "herdr",
      ["pane", "split", "--current", "--direction", "right", "--cwd", cwd, "--no-focus"],
      { cwd },
    );
    const paneId = (() => {
      try {
        return (JSON.parse(split.stdout ?? "{}") as { result?: { pane?: { pane_id?: string } } })
          .result?.pane?.pane_id;
      } catch {
        return undefined;
      }
    })();
    if (!paneId) {
      await pi.exec("tmux", ["kill-session", "-t", session], { cwd });
      return null;
    }

    // The label is not decoration: it is the mark by which the next run recognises this pane as
    // one it is allowed to close.
    await pi.exec("herdr", ["pane", "rename", paneId, PANE_LABEL], { cwd });
    await pi.exec("herdr", ["pane", "run", paneId, `tmux attach -t ${session}`], { cwd });
    return { session, paneId };
  } catch (err) {
    // A display that cannot be set up is not a reason to abandon the review; it runs headless and
    // the report says so. It is logged rather than swallowed: this catch hid an ENOENT for a whole
    // run — the sweep above had deleted the logs it was about to write — and a silent fallback
    // looks exactly like "panes are not supported here", which is a different and much less
    // fixable problem.
    console.error("[subagent-review] pane setup failed, continuing headless:", err);
    await pi.exec("tmux", ["kill-session", "-t", session], { cwd }).catch?.(() => undefined);
    return null;
  }
}

/** Reads an agent definition, returning its body as the system prompt. */
function loadAgentPrompt(cwd: string, name: string): string | null {
  const file = path.join(cwd, ".pi", "agents", `${name}.md`);
  let raw: string;
  try {
    raw = fs.readFileSync(file, "utf-8");
  } catch {
    return null;
  }
  // Strip YAML frontmatter: the body is the system prompt, the frontmatter is for humans and for
  // the upstream discovery format. A file without frontmatter is used whole.
  const m = /^---\n[\s\S]*?\n---\n?/.exec(raw);
  return (m ? raw.slice(m[0].length) : raw).trim() || null;
}

/**
 * The change under review.
 *
 * Uncommitted work first, because that is what "review before I commit" means. Only when the tree
 * is clean does it fall back to the last commit — reviewing HEAD while dirty would review the
 * wrong thing and say nothing about it.
 */
async function collectDiff(
  pi: ExtensionAPI,
  cwd: string,
  arg: string,
): Promise<{ label: string; diff: string; stat: string; paths: string[] } | { error: string }> {
  const run = async (args: string[]) => (await pi.exec("git", args, { cwd })).stdout ?? "";
  const names = async (args: string[]) => (await run(args)).split("\0").filter(Boolean); // -z everywhere, for the same CJK reason as below

  if (arg.trim()) {
    const label = arg.trim();
    const diff = await run(["diff", label]);
    const stat = await run(["diff", "--stat", label]);
    // A range names a diff, but the agents read — and `review-ci` builds and tests — the files as
    // they are on disk right now. With uncommitted work present those are two different versions
    // of the repository, and a gate that passes may be passing because of a fix that is not in
    // the diff under review. Say so rather than letting the reader assume they match.
    const dirty = (await run(["status", "--porcelain"])).trim();
    const note = dirty
      ? `\n\nWARNING: the working tree has uncommitted changes, so the files on disk are NOT the state this diff describes. Anything you read or run reflects the tree, not \`${label}\`. Treat a passing gate as evidence about the tree only, and say so in your report.`
      : "";
    return finish(label, diff, stat + note, await names(["diff", "--name-only", "-z", label]));
  }

  // Uncommitted work is both the tracked edits and the files git has never seen. `git diff HEAD`
  // shows only the first, so a change that is entirely new files would otherwise look like no
  // change at all. Each untracked file is diffed against /dev/null instead of being staged with
  // `add -N`: reviewing must not mutate the index the person is about to commit from.
  const tracked = await run(["diff", "HEAD"]);
  const trackedStat = await run(["diff", "--stat", "HEAD"]);
  // -z, because git's default output C-quotes any path that is not plain ASCII: a CJK-named file
  // comes back wrapped in quotes with every byte escaped as \NNN, and passing that quoted form to
  // `git diff --no-index` names a file that does not exist. NUL separation returns the real bytes.
  const untracked = (await run(["ls-files", "--others", "--exclude-standard", "-z"]))
    .split("\0")
    .filter(Boolean);

  let diff = tracked;
  let stat = trackedStat;
  for (const file of untracked) {
    // --no-index exits 1 when the files differ, which is the normal case here; pi.exec surfaces
    // that as a non-zero code, so the stdout is used regardless of it.
    const d = await run(["diff", "--no-index", "--", "/dev/null", file]);
    if (d.trim()) {
      diff += d;
      stat += `\n ${file} (new file)`;
    }
  }

  if (diff.trim()) {
    const tracked = await names(["diff", "--name-only", "-z", "HEAD"]);
    return finish("working tree (uncommitted)", diff, stat, [...tracked, ...untracked]);
  }

  const headDiff = await run(["diff", "HEAD~1..HEAD"]);
  const headStat = await run(["diff", "--stat", "HEAD~1..HEAD"]);
  return finish(
    "HEAD (last commit)",
    headDiff,
    headStat,
    await names(["diff", "--name-only", "-z", "HEAD~1..HEAD"]),
  );
}

/** Shared tail of collectDiff: rejects an empty or oversized change with a message worth reading. */
function finish(
  label: string,
  diff: string,
  stat: string,
  paths: string[],
): { label: string; diff: string; stat: string; paths: string[] } | { error: string } {
  if (!diff.trim()) return { error: `No changes to review for ${label}.` };
  if (diff.length > MAX_DIFF_BYTES) {
    return {
      error: `Diff is ${Math.round(diff.length / 1000)} KB, over the ${MAX_DIFF_BYTES / 1000} KB limit. Review a narrower range, e.g. /subagent-review HEAD~1..HEAD`,
    };
  }
  return { label, diff, stat: stat.trim(), paths };
}

/**
 * A fingerprint of the working tree, taken twice: once beside the diff snapshot and once when the
 * reviewers are done.
 *
 * The reviewers read — and `review-ci` builds and tests — the files as they are on disk, minutes
 * after the diff was taken. If the person kept editing meanwhile, the findings and the gate result
 * describe some state between the two, and a verdict on that is worth nothing unless it is
 * labelled as such. This is the only basis the report has for saying so.
 *
 * Four inputs, because three of them miss something on their own: `HEAD` (a commit landing during
 * the run moves every path at once), the porcelain status (files appearing, vanishing or being
 * staged), the tracked diff (content, which status reports only as a flag), and size plus mtime
 * for each untracked file, whose content `git diff HEAD` never sees.
 *
 * Returns null when it cannot be measured — no git, no repository, no commit. An absent
 * measurement claims nothing: the caller warns only when two fingerprints exist and differ.
 */
async function treeFingerprint(pi: ExtensionAPI, cwd: string): Promise<string | null> {
  try {
    const run = async (args: string[]) => (await pi.exec("git", args, { cwd })).stdout ?? "";
    const head = await pi.exec("git", ["rev-parse", "HEAD"], { cwd });
    if (head.code !== 0) return null;

    const hash = createHash("sha256")
      .update(head.stdout ?? "")
      .update(await run(["status", "--porcelain", "-z", "--untracked-files=all"]))
      .update(await run(["diff", "HEAD"]));

    // -z for the same CJK reason as collectDiff: git C-quotes any non-ASCII path by default, and
    // the quoted form names a file that does not exist.
    const untracked = (await run(["ls-files", "--others", "--exclude-standard", "-z"]))
      .split("\0")
      .filter(Boolean)
      .sort();
    for (const file of untracked) {
      let mark = "gone";
      try {
        const s = fs.statSync(path.join(cwd, file));
        mark = `${s.size}:${s.mtimeMs}`;
      } catch {
        // Listed a moment ago and unreadable now. That is itself movement, and reads as one.
      }
      hash.update(`\0${file}\0${mark}`);
    }
    return hash.digest("hex");
  } catch {
    return null;
  }
}

/** Runs one reviewer to completion, reading the JSON event stream for its final text and cost. */
function runReviewer(
  spec: { name: string; kind: "judgement" | "execution"; timeoutMs: number },
  systemPrompt: string,
  task: string,
  cwd: string,
  signal: AbortSignal | undefined,
  live: LiveState,
  onProgress: () => void,
  /** Appended with one readable line per event, and tailed by a visible pane when there is one. */
  logFile: string | null,
): Promise<ReviewerResult> {
  const { name, kind, timeoutMs } = spec;
  const started = Date.now();
  return new Promise((resolve) => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), `pi-review-${name}-`));
    const say = (line: string) => {
      if (!logFile) return;
      // Best-effort: a failed write to a display file must never disturb the run producing it.
      try {
        fs.appendFileSync(logFile, `${line}\n`);
      } catch {
        /* ignore */
      }
    };
    const promptFile = path.join(dir, "system.md");
    fs.writeFileSync(promptFile, systemPrompt, "utf-8");
    // The task holds a whole diff, and an argument vector is not the place for it: the limit is
    // about 256 KB on macOS, 128 KB per argument on Linux and 32 KB on Windows, so a diff that
    // passes MAX_DIFF_BYTES could still make every spawn fail with E2BIG before a single reviewer
    // reports. It goes to a file, and the child is told to read it.
    const taskFile = path.join(dir, "task.md");
    fs.writeFileSync(taskFile, task, "utf-8");

    const done = (text: string, error: string | null, costUsd: number) => {
      live.status = error ? "failed" : "done";
      live.endedAt = Date.now();
      live.costUsd = costUsd;
      live.activity = error ? clip(error, 60) : "reported";
      onProgress();
      say(
        error
          ? `\n✗ ${error}\n`
          : `\n✓ reported — ${live.turns} turns, $${costUsd.toFixed(4)}, ${clock(Date.now() - started)}\n`,
      );
      try {
        // Only this reviewer's own scratch dir. The log lives in the shared run directory and is
        // deliberately left behind: a pane is still tailing it, and the person was told the pane
        // stays so they can scroll back through it.
        fs.rmSync(dir, { recursive: true, force: true });
      } catch {
        /* the temp dir is best-effort; a leftover file must not fail a review */
      }
      resolve({ name, kind, text, error, costUsd, durationMs: Date.now() - started });
    };

    const invocation = piInvocation([
      "--mode",
      "json",
      "-p",
      "--no-session",
      "--model",
      MODEL,
      "--thinking",
      THINKING,
      "--tools",
      "read,bash,grep,find,ls",
      "--append-system-prompt",
      promptFile,
      `Your review task, including the diff, is in the file ${taskFile}. Read it first, then carry it out.`,
    ]);
    const proc = spawn(invocation.command, invocation.args, {
      cwd,
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });

    let finalText = "";
    let cost = 0;
    let stderr = "";
    let buffer = "";
    // Why the exit code is not enough: a provider that fails after streaming some text still ends
    // the turn, and pi's JSON mode exits 0 having reported the failure inside the stream. Judging
    // only by the exit status would publish that partial answer as a finished report — for
    // `review-ci`, a verdict written before the suites it claims to have run.
    let lastStopReason: string | null = null;

    const timer = setTimeout(() => proc.kill("SIGTERM"), timeoutMs);
    const onAbort = () => proc.kill("SIGTERM");
    signal?.addEventListener("abort", onAbort, { once: true });

    proc.stdout.on("data", (chunk: Buffer) => {
      buffer += chunk.toString();
      const lines = buffer.split("\n");
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let ev: {
          type?: string;
          toolName?: string;
          args?: unknown;
          message?: {
            content?: Array<{ type: string; text?: string }>;
            usage?: { cost?: { total?: number } };
            stopReason?: string;
          };
        };
        try {
          ev = JSON.parse(line);
        } catch {
          continue;
        }
        // The child's stream is the only window into a process that prints nothing for minutes.
        // Three event types are enough to tell a working reviewer from a stalled one: a turn
        // beginning, a tool starting, and a turn ending.
        if (ev.type === "turn_start") {
          live.turns += 1;
          live.activity = "thinking";
          say(`\n── turn ${live.turns} ──`);
          onProgress();
        } else if (ev.type === "tool_execution_start" && ev.toolName) {
          live.activity = describeTool(ev.toolName, ev.args);
          say(`  ▸ ${live.activity}`);
          onProgress();
        } else if (ev.type === "turn_end" && ev.message) {
          // turn_end carries the assistant message for that turn; the last one is the report.
          const text = (ev.message.content ?? [])
            .filter((c) => c.type === "text" && typeof c.text === "string")
            .map((c) => c.text as string)
            .join("");
          lastStopReason = ev.message.stopReason ?? null;
          if (text.trim()) {
            finalText = text;
            say(`\n${text.trim()}`);
          }
          cost += ev.message.usage?.cost?.total ?? 0;
          live.costUsd = cost;
          live.activity = "thinking";
          onProgress();
        }
      }
    });
    proc.stderr.on("data", (c: Buffer) => {
      stderr += c.toString();
    });

    proc.on("error", (err) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      done("", `could not start: ${err.message}`, 0);
    });
    proc.on("close", (code) => {
      clearTimeout(timer);
      signal?.removeEventListener("abort", onAbort);
      const text = finalText.trim();
      // A non-zero exit is a failure even when the child produced text. `review-ci` is the reason
      // this matters: a child killed by the timeout mid-`pnpm test` may already have written a
      // hopeful summary, and reporting that as a completed run would be the exact lie its own
      // instructions forbid — a gate nobody finished, presented as a gate that passed.
      // `toolUse` ends a turn that continues; `stop` ends the run. Anything else — `error`,
      // `aborted`, a length cap — means the answer was cut off wherever it happened to be.
      const ended = lastStopReason === "stop" || lastStopReason === "toolUse";
      if (code === 0 && text && ended) return done(text, null, cost);
      if (text) {
        const why = !ended
          ? `the run ended with stopReason "${lastStopReason ?? "unknown"}"`
          : `child exited ${code}`;
        return done(
          text,
          `${why} — this report is from an incomplete run and its verdict cannot be trusted`,
          cost,
        );
      }
      done("", stderr.trim().slice(-600) || `exited with code ${code} and no output`, cost);
    });
  });
}

export default function (pi: ExtensionAPI) {
  // The finished report is a durable transcript entry rather than a queued message, because a
  // queued one is invisible until the person next says something — which, after a six-minute
  // wait, is precisely when they are looking for it. The same text also goes into model context
  // separately, with display off, so it is not printed twice.
  pi.registerEntryRenderer("subagent-review", (entry, { expanded }, theme) => {
    const data = entry.data as { report: string; headline: string };
    const box = new Box(1, 1, (t) => theme.bg("customMessageBg", t));
    box.addChild(new Text(theme.bold(data.headline)));
    if (expanded) {
      for (const line of data.report.split("\n")) box.addChild(new Text(line));
    } else {
      box.addChild(new Text(theme.fg("dim", "Ctrl+O to expand the full report")));
    }
    return box;
  });

  // Esc aborts an agent run; this is not one, so Esc reaches nothing here. Without a key of its
  // own a review that has gone wrong can only be stopped by killing pi, and `review-ci` is
  // allowed thirty minutes.
  //
  // Two bindings because neither is universal: reporting `shift` alongside a letter needs the
  // Kitty keyboard protocol, and `alt` needs the terminal to send it as Meta — pi's
  // `docs/terminal-setup.md` says nothing about the Zed terminal this is used from, so claiming
  // either one works would be a guess. Both are offered and the panel names both.
  const cancelRun = (ctx: { ui: { notify: (m: string, l: "info" | "warning") => void } }) => {
    if (!activeRun) {
      ctx.ui.notify("No subagent-review is running.", "info");
      return;
    }
    activeRun.abort();
    ctx.ui.notify("Cancelling subagent-review — sending SIGTERM to the children.", "warning");
  };
  for (const key of ["ctrl+shift+x", "alt+x"] as const) {
    pi.registerShortcut(key, {
      description: "Cancel a running /subagent-review",
      handler: async (ctx) => cancelRun(ctx),
    });
  }

  // The children are real processes. A session that ends without stopping them leaves four pi
  // instances running — one of them a full build — against a repository nobody is watching.
  pi.on("session_shutdown", async () => {
    activeRun?.abort();
    activeRun = null;
  });

  pi.registerCommand("subagent-review", {
    description: "Four agents review the current change: three read it, one runs the gate",
    handler: async (args: string, ctx: ExtensionCommandContext) => {
      const cwd = ctx.cwd;

      // One at a time. Two concurrent runs would put two `review-ci` agents into the same
      // `pnpm build`, and the second widget would overwrite the first's.
      if (activeRun) {
        ctx.ui.notify(
          "A subagent-review is already running. Cancel it with ctrl+shift+x or alt+x first.",
          "warning",
        );
        return;
      }
      // Claimed here, not after the git calls below. The gap between the check and the assignment
      // is several awaits wide, and two invocations inside it would both pass a guard that only
      // looks true. Every early return from here on has to release it.
      const runAbort = new AbortController();
      activeRun = runAbort;
      const release = () => {
        if (activeRun === runAbort) activeRun = null;
      };

      const collected = await collectDiff(pi, cwd, args ?? "");
      if ("error" in collected) {
        release();
        ctx.ui.notify(collected.error, "warning");
        return;
      }
      const { label, diff, stat, paths } = collected;

      // Taken here, beside the snapshot it belongs to. Everything after this point runs while the
      // person is free to keep editing the same files; the second reading happens when the
      // reviewers report, and the two together are what the report's warning stands on.
      const treeAtStart = await treeFingerprint(pi, cwd);

      // `review-ci` builds and runs every suite for about three minutes. When the change touches
      // nothing any gate executes, that proves only that the repository still compiles — which was
      // not in question. It is dropped, and the report says so, because a reader must be able to
      // tell "the gate passed" from "the gate was not asked".
      const docsOnly = isDocumentationOnly(paths);
      const roster = docsOnly ? REVIEWERS.filter((r) => r.kind !== "execution") : REVIEWERS;

      const prompts = roster.map((spec) => ({ spec, prompt: loadAgentPrompt(cwd, spec.name) }));
      const missing = prompts.filter((p) => p.prompt === null).map((p) => p.spec.name);
      if (missing.length > 0) {
        release();
        ctx.ui.notify(`Missing agent definitions: ${missing.join(", ")} (.pi/agents/)`, "error");
        return;
      }

      // review-evidence is told to weigh the commit message against the diff, so it has to be
      // given one. For a committed range it exists; for uncommitted work it does not, and saying
      // so is the honest input — silently omitting it left that reviewer checking a claim nobody
      // had made.
      //
      // Keyed on what `collectDiff` actually chose, not on whether an argument was passed. Those
      // differ on the ordinary path: with a clean tree and no argument the review falls back to
      // `HEAD~1..HEAD`, which does have a commit message — telling the reviewers there was none
      // sent them looking for claims nobody had made, and hid the one message worth checking.
      const reviewingCommits = label !== "working tree (uncommitted)";
      const message = reviewingCommits
        ? (
            await pi.exec("git", ["log", "-1", "--format=%B", args?.trim() || "HEAD"], { cwd })
          ).stdout?.trim()
        : "";
      const messageBlock = reviewingCommits
        ? [`Commit message under review:`, "```", message || "(empty)", "```", ``]
        : [
            `There is no commit message: this is uncommitted work. Judge the change on its own`,
            `terms and do not treat a missing message as a defect — but do say which claims a`,
            `future message would have to back.`,
            ``,
          ];

      const task = [
        `Review this change. It is the only thing under review; do not review the rest of the repository.`,
        ``,
        `Scope: ${label}`,
        ``,
        ...messageBlock,
        `Files changed:`,
        "```",
        stat.trim(),
        "```",
        ``,
        `Diff:`,
        "```diff",
        diff,
        "```",
        ``,
        `You may read any file in the repository for context. Answer in the report format your`,
        `instructions specify, and nothing else.`,
      ].join("\n");

      // A single static status line for six minutes tells the person nothing about whether
      // anything is happening. The widget names each agent and what it is doing right now, and
      // ticks, so a stall is visible as a stall rather than as patience.
      //
      // The last line is not decoration. While this handler is awaited pi's input loop is not at
      // `getUserInput()`, and the agent is not streaming either, so a message submitted now takes
      // neither the steering path nor the normal one: it lands in `pendingUserInputs`, the editor
      // clears, and nothing renders. It is queued, not lost — it sends the moment this returns —
      // but a person who is not told that has watched their message vanish.
      const startedAll = Date.now();

      // The run directory outlives the run: its logs are what the pane is showing, and the pane
      // stays open afterwards so the output can be scrolled rather than lost.
      const runDir = fs.mkdtempSync(path.join(os.tmpdir(), "subagent-review-"));
      const logs = roster.map((r) => ({ name: r.name, file: path.join(runDir, `${r.name}.log`) }));
      const panes = await setupPanes(pi, cwd, logs);
      const logOf = (name: string) =>
        panes ? (logs.find((l) => l.name === name)?.file ?? null) : null;

      const live = new Map<string, LiveState>(
        roster.map((r) => [
          r.name,
          {
            status: "running",
            turns: 0,
            activity: r.kind === "execution" ? "starting the gate" : "starting",
            costUsd: 0,
            startedAt: startedAll,
            endedAt: null,
          } satisfies LiveState,
        ]),
      );
      const nameWidth = Math.max(...roster.map((r) => r.name.length));
      const mark = { running: "⏳", done: "✓", failed: "✗" } as const;
      const paint = () => {
        const now = Date.now();
        const reported = roster.filter((r) => live.get(r.name)?.status !== "running").length;
        ctx.ui.setWidget("subagent-review", [
          `subagent-review — ${label} — ${clock(now - startedAll)} — ${reported}/${roster.length} reported${panes ? " — live in the pane on the right" : ""}`,
          ...roster.map((r) => {
            const s = live.get(r.name) as LiveState;
            const elapsed = clock((s.endedAt ?? now) - s.startedAt);
            const detail =
              s.status === "running"
                ? `turn ${s.turns} · ${s.activity}`
                : `${s.activity} · ${s.turns} turns · $${s.costUsd.toFixed(4)}`;
            return `  ${mark[s.status]} ${r.name.padEnd(nameWidth)}  ${elapsed.padStart(6)}  ${clip(detail, 72)}`;
          }),
          `  Esc will not stop this — use ctrl+shift+x or alt+x.`,
          `  Keep talking; the report arrives here when it is ready.`,
        ]);
      };
      // Every call site of `paint` is guarded, not just the ones on the happy path. Once the
      // review runs in the background it outlives its command, and after /new, /resume, /fork or
      // /reload the captured `ctx.ui` is stale and throws. The children still emit events until
      // their SIGTERM lands, and each one reaches `onProgress` — inside a promise, where the
      // throw becomes an unhandled rejection and takes pi down with it. A widget that cannot be
      // drawn is not a reason to lose the editor.
      const safePaint = () => safely(paint);
      safePaint();
      const ticker = setInterval(safePaint, 1000);
      ctx.ui.setStatus("subagent-review", `reviewing ${label} — ${roster.length} agents`);

      // `runAbort` above is our own controller, not `ctx.signal`. That one is the agent's run
      // signal and is undefined whenever the agent is not streaming — which is now every moment
      // of this review's life, since it no longer blocks a turn. Wiring the children to it would
      // look like abort support and provide none.

      // All at once: they are independent, and sequencing them would multiply the wait for no
      // extra signal. The three readers only read; `review-ci` writes `dist/` and runs the test
      // suites, and is forbidden by its own instructions from editing source — so the worst a
      // concurrent reader sees is a rebuilt `dist/` it was not reading in the first place.
      //
      // Deliberately not awaited by the command handler. While a handler is awaited pi's input
      // loop is not at `getUserInput()`, so for the seven minutes this takes the person could not
      // talk to the session that started it — anything typed landed in `pendingUserInputs` and the
      // editor simply cleared. Reviewing is background work and now behaves like it: the handler
      // returns immediately, the children keep running, and the report is delivered whenever it
      // is ready. `finish` below therefore runs after its own command is long gone, which is why
      // every call it makes into pi is guarded — see there.
      const run = async () => {
        let results: ReviewerResult[];
        try {
          results = await Promise.all(
            prompts.map((p) =>
              runReviewer(
                p.spec,
                p.prompt as string,
                task,
                cwd,
                runAbort.signal,
                live.get(p.spec.name) as LiveState,
                safePaint,
                logOf(p.spec.name),
              ),
            ),
          );
        } finally {
          // Whatever happens — including an abort — the ticker stops and the panel goes away, or
          // it would keep repainting a review that is no longer running.
          release();
          clearInterval(ticker);
          safely(() => {
            ctx.ui.setWidget("subagent-review", []);
            ctx.ui.setStatus("subagent-review", "");
          });
        }

        // Read before the report is written, and only trusted against a start fingerprint that
        // exists: an unmeasurable tree produces silence, not a warning nobody can act on.
        const treeAfter = await treeFingerprint(pi, cwd);
        const treeMoved = treeAtStart !== null && treeAfter !== null && treeAfter !== treeAtStart;

        const totalCost = results.reduce((sum, r) => sum + r.costUsd, 0);
        const elapsed = Math.round((Date.now() - startedAll) / 1000);
        const report = [
          `# Review of ${label}`,
          ``,
          `${results.length} reviewers, ${MODEL} at ${THINKING}, ${elapsed}s, $${totalCost.toFixed(4)}.`,
          ...(docsOnly
            ? [
                ``,
                `\`review-ci\` was **not run**: every changed path is documentation that no gate`,
                `executes. This is not a passing gate — nobody asked it anything.`,
              ]
            : []),
          ...(panes
            ? [``, `Live output ran in the pane on the right; it is still there to scroll.`]
            : []),
          ...(treeMoved
            ? [
                ``,
                `> **The working tree changed while this ran.** The diff above is the snapshot`,
                `> taken at the start; the reviewers read — and \`review-ci\` built and tested — the`,
                `> files as they were when each touched them. The findings and the gate result`,
                `> describe some state between the two. Re-run against a still tree before`,
                `> trusting a verdict.`,
              ]
            : []),
          ``,
          ...results.flatMap((r) => [
            `---`,
            ``,
            `## ${r.name} — ${r.kind === "execution" ? "ran the gate stages it is allowed to" : "read the diff"}${r.error ? ", DID NOT REPORT" : ""}  _(${Math.round(r.durationMs / 1000)}s, $${r.costUsd.toFixed(4)})_`,
            ``,
            ...(r.error ? [`> **Unreliable: ${r.error}**`, ``] : []),
            r.text || `(no output)`,
            ``,
          ]),
          `---`,
          ``,
          `The readers saw the same diff and could not see each other. Where they disagree, the`,
          `disagreement is the finding: read both and decide, rather than counting votes.`,
          ``,
          `\`review-ci\` is not an opinion — it reports exit codes. A RED there outranks three`,
          `PASS verdicts, and an INCOMPLETE means a gate did not run, which is not the same as`,
          `a gate that passed.`,
        ].join("\n");

        const clean = results.filter((r) => !r.error).length;
        const headline = `subagent-review — ${label} — ${clean}/${results.length} reported, ${elapsed}s, $${totalCost.toFixed(4)}`;

        // Two deliveries, one text: the entry renders in the transcript, the message carries the
        // same report into model context without printing it twice.
        //
        // Delivery is deliberately the default branch of `sendCustomMessage`, not `nextTurn`.
        // Reading that function, the four branches behave very differently, and `nextTurn` is the
        // only one that both defers *and* forgets: it pushes onto `_pendingNextTurnMessages` and
        // never calls `appendCustomMessageEntry`, so the report existed solely in memory and only
        // reached the model when the person next typed. That is what made a finished review
        // invisible to the assistant sitting next to it. The default branch appends to
        // `agent.state.messages` *and* persists the entry, so the report is in context the moment
        // it exists and survives a restart.
        //
        // `triggerTurn: false` is not decoration — omitting the options object entirely is what
        // made this unreliable. `sendCustomMessage` reads `options?.triggerTurn !== false`, and
        // with no options that is `undefined !== false`, i.e. true: a report finishing while the
        // assistant happened to be mid-answer took the *steer* branch instead, was queued into a
        // run that had already made its last model call, and was never consumed. Passing it
        // explicitly forces the append-and-persist branch whatever the session is doing, so the
        // report is in context the moment it exists rather than only when the timing was lucky.
        //
        // It also keeps the promise the flag makes: arriving is not a reason to interrupt. The
        // report is simply there, and the next thing said happens with it already in view.
        //
        // All of it guarded. By now the command that started this has returned, and the session
        // may have been replaced by /new, /resume, /fork or /reload — after which these calls
        // throw "stale after session replacement". Losing a report to a session the person has
        // already left is acceptable; taking down pi with an unhandled rejection is not.
        safely(() => {
          pi.appendEntry("subagent-review", { report, headline });
          pi.sendMessage(
            { customType: "subagent-review", content: report, display: false },
            { triggerTurn: false },
          );
          ctx.ui.notify(headline, clean === results.length ? "info" : "warning");
        });
      };

      // The last unguarded promise in this file, and the one that mattered: building the report
      // threw a ReferenceError for `treeMoved` — referenced, never defined, and nothing
      // typechecks `.pi/` — which surfaced as an unhandled rejection minutes after the command had
      // returned and took the whole editor down with it. The name is defined above; this is the
      // class. Every other call into pi here is already wrapped in `safely` for the same reason,
      // and detached background work must not be able to end the session that started it.
      void run().catch((err) => {
        release();
        console.error("[subagent-review] the review failed:", err);
        safely(() => ctx.ui.notify(`subagent-review failed: ${String(err)}`, "error"));
      });
      ctx.ui.notify(
        `Reviewing ${label} with ${roster.length} agents in the background— keep working; the report lands here.`,
        "info",
      );
    },
  });
}
