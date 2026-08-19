/**
 * The one place that types a protected value into a page.
 *
 * Implemented over the Chrome debugger protocol in an **isolated world**: a separate execution
 * context that shares the page's DOM but none of its JavaScript. That choice is the point of the
 * file. Setting `element.value` from the page's own world would expose the write to every script
 * the site runs (a keylogger shim over the setter, a MutationObserver, a framework's own
 * bookkeeping); the isolated world keeps the *write path* out of the page's reach, even though the
 * written value is necessarily in the DOM afterwards — that residual is accepted by design, not owned by this file.
 *
 * The write dispatches `input` and `change` events because framework-controlled inputs ignore a
 * bare value assignment (recorded as the known-fragile part; `fillWithSuggestion`
 * in the browser CLI hit the same wall). React needs the native setter trick — calling the
 * prototype's `value` setter rather than the instance property — and that is what is done.
 *
 * Everything here is written against a small `DebuggerLike` port instead of Electron's
 * `webContents.debugger` directly, for the usual two reasons: the logic is testable without a
 * browser, and the surface that can type secrets is one narrow, reviewable interface.
 */
import type { BoundingBox } from "./sensitive-elements.js";
import type { FillPort } from "./secure-fill.js";
import type { SecretPhasePort } from "./secret-phase.js";

/** The slice of `webContents.debugger` (or a CDP session) this module needs. */
export interface DebuggerLike {
  attach(version?: string): void;
  detach(): void;
  isAttached(): boolean;
  sendCommand(method: string, params?: Record<string, unknown>): Promise<unknown>;
}

/** Resolves a targetId to the debugger and URL of the tab it names, or null when it is gone. */
export interface TargetResolver {
  debuggerFor(targetId: string): DebuggerLike | null;
  urlOf(targetId: string): string | null;
  /** Closes the tab (secret-phase exit c). */
  destroy(targetId: string): Promise<void>;
  /** Revokes / restores the *agent's* channel to the target — the relay's, not ours. */
  detachAgent(input: { targetId: string; sessionId: string }): Promise<void>;
  attachAgent(input: { targetId: string; sessionId: string }): Promise<void>;
}

/** The name under which the isolated world is created. Stable, so worlds are reused per frame. */
const WORLD_NAME = "penguin-vault";

/**
 * The function evaluated in the isolated world to perform one fill.
 *
 * Serialised as text because CDP takes source, and kept as a single declaration so the whole
 * write path can be read in one screen. The native-setter dance is the React workaround; the
 * events are what Vue/Svelte/plain listeners need.
 */
const FILL_FUNCTION = `
function (selector, value) {
  const element = document.querySelector(selector);
  if (!element) return { filled: false, reason: "missing" };
  const proto = element instanceof HTMLTextAreaElement
    ? HTMLTextAreaElement.prototype
    : HTMLInputElement.prototype;
  const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
  if (setter) setter.call(element, value); else element.value = value;
  element.dispatchEvent(new Event("input", { bubbles: true }));
  element.dispatchEvent(new Event("change", { bubbles: true }));
  const rect = element.getBoundingClientRect();
  return {
    filled: true,
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}`;

const READ_FUNCTION = `
function (selector) {
  const element = document.querySelector(selector);
  if (!element) return { present: false, value: null };
  return { present: true, value: "value" in element ? String(element.value) : null };
}`;

const CLICK_FUNCTION = `
function (selector) {
  const element = document.querySelector(selector);
  if (!element) return false;
  element.click();
  return true;
}`;

export class DebuggerFillPort implements FillPort, SecretPhasePort {
  constructor(private readonly targets: TargetResolver) {}

  private async inWorld<T>(
    targetId: string,
    declaration: string,
    args: unknown[],
  ): Promise<T | null> {
    const session = this.targets.debuggerFor(targetId);
    if (!session) return null;
    const attachedHere = !session.isAttached();
    if (attachedHere) session.attach("1.3");
    try {
      // The main frame's id doubles as its frameId for createIsolatedWorld.
      const tree = (await session.sendCommand("Page.getFrameTree")) as {
        frameTree: { frame: { id: string } };
      };
      const world = (await session.sendCommand("Page.createIsolatedWorld", {
        frameId: tree.frameTree.frame.id,
        worldName: WORLD_NAME,
      })) as { executionContextId: number };

      const result = (await session.sendCommand("Runtime.callFunctionOn", {
        functionDeclaration: declaration,
        executionContextId: world.executionContextId,
        arguments: args.map((value) => ({ value })),
        returnByValue: true,
      })) as { result?: { value?: T }; exceptionDetails?: unknown };

      if (result.exceptionDetails) return null;
      return result.result?.value ?? null;
    } finally {
      // Detached only if this call attached: a secret phase may hold the attachment across
      // several operations, and tearing down its session under it would end the phase early.
      if (attachedHere && session.isAttached()) session.detach();
    }
  }

  /**
   * Runs one function declaration in a tab's isolated world.
   *
   * Exposed so the saved-login filler can reuse this file's world handling rather than opening a
   * second debugger path to the same pages — the surface that can type secrets should stay one
   * reviewable place. It is deliberately not a general "evaluate anything" channel reachable from
   * outside the main process: `ipc.ts` exposes no route to it, and the only declarations passed are
   * the constants in `login-forms.ts`.
   */
  async evaluate<T>(input: {
    targetId: string;
    declaration: string;
    args: unknown[];
  }): Promise<T | null> {
    return this.inWorld<T>(input.targetId, input.declaration, input.args);
  }

  async fillField(input: {
    targetId: string;
    selector: string;
    value: string;
  }): Promise<{ filled: boolean; box?: BoundingBox }> {
    const outcome = await this.inWorld<{ filled: boolean; box?: BoundingBox }>(
      input.targetId,
      FILL_FUNCTION,
      [input.selector, input.value],
    );
    if (!outcome) return { filled: false };
    return outcome.filled ? outcome : { filled: false };
  }

  async readField(input: { targetId: string; selector: string }): Promise<string | null> {
    const outcome = await this.inWorld<{ present: boolean; value: string | null }>(
      input.targetId,
      READ_FUNCTION,
      [input.selector],
    );
    return outcome?.present ? outcome.value : null;
  }

  async hasField(input: { targetId: string; selector: string }): Promise<boolean> {
    const outcome = await this.inWorld<{ present: boolean }>(input.targetId, READ_FUNCTION, [
      input.selector,
    ]);
    return outcome?.present === true;
  }

  async currentUrl(input: { targetId: string }): Promise<string | null> {
    return this.targets.urlOf(input.targetId);
  }

  async submit(input: { targetId: string; selector: string }): Promise<boolean> {
    return (await this.inWorld<boolean>(input.targetId, CLICK_FUNCTION, [input.selector])) === true;
  }

  async detachAgent(input: { targetId: string; sessionId: string }): Promise<void> {
    await this.targets.detachAgent(input);
  }

  async attachAgent(input: { targetId: string; sessionId: string }): Promise<void> {
    await this.targets.attachAgent(input);
  }

  async destroyTarget(input: { targetId: string }): Promise<void> {
    await this.targets.destroy(input.targetId);
  }
}
