/**
 * What the shell holds after it decides how to start.
 *
 * There are two ways up — spawn the server, or attach to one already running for this data root —
 * and exactly one thing about them that must *not* differ: where the data root is. The shell
 * resolves each conversation's download directory from it, so a mode that leaves it unset does not
 * fail loudly; it cancels every download, silently, in one of the two modes.
 *
 * That is what happened: attach mode returned as soon as the window was created and never assigned
 * the root, so `onSessionResolved` returned early and no download in an attached shell ever had
 * anywhere to go. The decision lives here, apart from `main.ts` — which cannot be imported in a
 * test, because importing it starts an Electron app — so that the two modes are produced by one
 * function and the shared parts cannot drift apart again.
 */

export interface BootPlan {
  /** Whether this shell starts the server or attaches to one that is already up. */
  mode: "attach" | "spawn";
  /**
   * The data root, in **both** modes.
   *
   * The lock that reveals a running server lives inside this root, so an attached server is by
   * construction the server *for this root* — its Sessions are under here, and their scratchpads
   * are where this shell's downloads belong.
   */
  dataRoot: string;
  /**
   * Where the app is served from, when that is already known.
   *
   * Attach mode knows it from the lock. Spawn mode does not know it until the server has started,
   * so it is null here and filled in later.
   */
  origin: string | null;
}

/** A live server lock, narrowed to the part this decision uses. */
export interface RunningServer {
  port: number;
}

export function planBoot(dataRoot: string, existing: RunningServer | null): BootPlan {
  if (existing !== null) {
    return { mode: "attach", dataRoot, origin: `http://localhost:${existing.port}` };
  }
  return { mode: "spawn", dataRoot, origin: null };
}
