/**
 * Deciding when the pane may show a conversation's tabs.
 *
 * React paints conversation B as soon as the route changes; main hears about it over IPC, some
 * milliseconds later, and goes on publishing A's tabs until it does. Anything that rendered from
 * those pushes would put A's pages — their titles, their URLs, the native view still showing one of
 * them — inside B.
 *
 * So the strip is gated on agreement between three things, and the reason there are three is that
 * each of the obvious two is insufficient on its own:
 *
 *   - what the renderer is *asking* for (the route),
 *   - what main *confirmed* for that request, which is how a reply that arrived out of order is
 *     told from the current one,
 *   - what main is *publishing*, because a state push queued before the switch carries the previous
 *     conversation's scope with the previous conversation's tabs.
 *
 * Kept pure and separate from the hook so all three can be posed directly; the hook holds only the
 * request counter that feeds `isCurrentAnswer`.
 */

export interface ScopeInput {
  /** The conversation the renderer is on. Null on a draft or the session list. */
  requested: string | null;
  /** The scope main confirmed for the most recent request, or null while one is in flight. */
  confirmed: string | null;
  /** The scope main's latest state push says it is showing. */
  published: string | null;
}

/**
 * Whether the pane may show what main is publishing.
 *
 * Fails closed everywhere: no conversation, an unconfirmed switch, a refused switch, or a push that
 * disagrees all produce false, and false means an empty strip with the native view hidden. The
 * alternative — showing something and correcting it a frame later — is showing one conversation's
 * pages inside another.
 */
export function isScopeSettled({ requested, confirmed, published }: ScopeInput): boolean {
  if (requested === null) return false;
  return confirmed === requested && published === requested;
}

/**
 * Whether an answer belongs to the switch still in flight.
 *
 * Two route changes in quick succession can settle out of order, and the earlier answer names a
 * conversation the user has already left. Taking it would confirm the wrong one — and because the
 * confirmation is what unlocks the strip, that is precisely the frame where A's tabs appear in B.
 */
export function isCurrentAnswer(answered: number, current: number): boolean {
  return answered === current;
}

/**
 * The conversation switch: hide the native view *before this returns*, then say which conversation
 * it is.
 *
 * Two halves, and they are different kinds of call on purpose.
 *
 * The **hide is synchronous**. This runs inside the commit that changed the route, and the native
 * view is a surface composited above the frame React is about to paint; until main is told
 * otherwise it goes on showing the previous conversation's page. An asynchronous message only
 * *starts* that — the effect returns, the frame paints, and whether main got there first is a race
 * with the IPC. Blocking the renderer until main answers is the only thing that actually makes the
 * guarantee, so the hide is the one blocking call in the whole bridge, and it can do nothing except
 * hide.
 *
 * The **announcement is asynchronous**, because nothing is on screen until it comes back: the strip
 * stays gated on a confirmed scope, so a slow answer costs an empty pane rather than a wrong one.
 *
 * Returns the scope main confirmed, or null when the hide failed, the switch was superseded, or
 * main refused. Null keeps every tab and the view hidden, which is the direction this fails in.
 */
export function applySessionSwitch(options: {
  /** Withdraws the hole *now*. False means main did not confirm it, and the switch stops. */
  hide: () => boolean;
  /** Tells main which conversation this is, and answers with the scope it accepted. */
  announce: (sessionId: string | null) => Promise<string | null>;
  sessionId: string | null;
  /** False once another switch has started; checked after every await. */
  isCurrent: () => boolean;
  /** Called once the hide is confirmed, so the hook can forget the bounds it last sent. */
  onHidden?: () => void;
}): Promise<string | null> {
  let hidden = false;
  try {
    hidden = options.hide();
  } catch {
    hidden = false;
  }
  if (!hidden) {
    // The view may still be painting the other conversation. Confirming a scope now would unlock a
    // strip over a page that is not this conversation's.
    return Promise.resolve(null);
  }
  options.onHidden?.();
  if (!options.isCurrent()) return Promise.resolve(null);
  return options
    .announce(options.sessionId)
    .then((scope) => (options.isCurrent() ? scope : null))
    .catch(() => null);
}
