/**
 * The `process` an executed snippet may see.
 *
 * The old version was a blocklist: intercept `cwd`, `exit` and `chdir`, pass everything else
 * through. Two things are wrong with that, and the second is the serious one:
 *
 * - It grows a hole every time Node adds a property. `process.binding`, `process.dlopen`,
 *   `process.kill` — none of them were ever considered, and all of them were reachable.
 * - **`process.env` was the whole environment.** The harness puts this turn's credential in there
 *   (see the server's `interaction/tokens.ts`), the user's vault entries are there, and a page
 *   whose script the agent happened to evaluate could read all of it. Handing that to code
 *   assembled from a web page is exactly the accidental exposure the no-values rule is about.
 *
 * So this is an allowlist of the properties a browser-automation snippet has any business reading,
 * with `env` reduced to a small, boring subset. It is a **guardrail, not a boundary** — the vm is
 * not one, and the agent has a shell elsewhere — but the sanctioned path no longer hands
 * out secrets by default, which is the difference between a mistake and a design.
 */

/** Environment variables a snippet may read: shape and locale, nothing that authenticates. */
const ALLOWED_ENV_KEYS: readonly string[] = [
  'NODE_ENV',
  'TZ',
  'LANG',
  'LC_ALL',
  'CI',
  'TERM',
  // The browser session's own identity: already known to the caller, and useful in logs.
  'PENGUIN_BROWSER_SESSION',
]

export interface SandboxedProcessOptions {
  /** What `process.cwd()` answers: the session's directory, not the relay's. */
  cwd: () => string
}

/** A refusal that reads as a decision rather than as a missing property. */
function refuse(name: string, advice: string): never {
  const error = new Error(`process.${name} is not available in the sandbox. ${advice}`)
  error.name = 'SandboxRestrictionError'
  throw error
}

/**
 * Builds the object bound to `process` inside the vm.
 *
 * A plain object rather than a Proxy over the real `process`: a Proxy still carries the target's
 * identity, and anything that reached the original through a prototype, a getter, or
 * `Reflect.getPrototypeOf` would have the whole thing back. What the snippet gets is a small object
 * that answers the questions worth answering.
 */
export function sandboxedProcess(options: SandboxedProcessOptions): Record<string, unknown> {
  const env: Record<string, string> = {}
  for (const key of ALLOWED_ENV_KEYS) {
    const value = process.env[key]
    if (typeof value === 'string') env[key] = value
  }

  return {
    /** Frozen copy: a snippet that writes here changes nothing, rather than changing the relay. */
    env: Object.freeze(env),
    platform: process.platform,
    arch: process.arch,
    version: process.version,
    versions: Object.freeze({ ...process.versions }),
    pid: process.pid,
    cwd: () => options.cwd(),
    uptime: () => process.uptime(),
    hrtime: process.hrtime.bind(process),
    memoryUsage: () => process.memoryUsage(),
    nextTick: (callback: (...args: unknown[]) => void, ...args: unknown[]) =>
      process.nextTick(callback, ...args),
    exit: () =>
      refuse('exit()', 'It would take the relay down with every other session running in it.'),
    abort: () => refuse('abort()', 'It would take the relay down with every other session in it.'),
    chdir: () =>
      refuse(
        'chdir()',
        'It would move every other session in this process. Create a session with the cwd you ' +
          'want instead.',
      ),
    kill: () => refuse('kill()', 'Signalling other processes is not part of driving a browser.'),
    binding: () => refuse('binding()', 'It reaches Node internals the allowlist exists to exclude.'),
    dlopen: () => refuse('dlopen()', 'Loading native modules is not part of driving a browser.'),
  }
}

/** The environment keys a snippet can see, for the test that pins the list. */
export function allowedEnvKeys(): readonly string[] {
  return ALLOWED_ENV_KEYS
}
