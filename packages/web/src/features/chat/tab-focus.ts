/**
 * Where the caret goes when the tab strip changes underneath it.
 *
 * A `tablist` with roving focus has one focusable tab, and keyboard navigation has to *move* that
 * focus, not merely change the selection. In an ordinary strip that is a one-liner: the key handler
 * focuses the node it just selected. Here the selection is applied by the main process and arrives
 * back as a state push a round trip later, so by the time the new tab exists the event that caused
 * it is long over — and the strip is also changed by things that must **not** take the caret: an
 * agent opening a tab, another conversation's state arriving, a click.
 *
 * So a transfer is *armed* by a keyboard action and claimed by the next active tab, and every way
 * that can go wrong disarms rather than leaving the arming behind:
 *
 *   - main refuses the selection or the close, so nothing will ever arrive;
 *   - the strip empties, so there is nothing to focus;
 *   - the tab that arrives has no node yet, which is not a failure — the arming survives one commit
 *     and is claimed by the next.
 *
 * A leftover arming is not a cosmetic bug. It hands the caret to whatever changes the strip next,
 * which in practice means an agent opening a tab pulls the user out of whatever they were typing.
 *
 * Kept apart from the component because each of those transitions is a rule, and rules deserve to
 * be asserted directly rather than through a rendered strip.
 */

export interface RovingFocus {
  /** A keyboard action is about to change the selection; the result should take the caret. */
  arm(): void;
  /** That action was refused. Nothing will arrive, so the arming must not outlive it. */
  disarm(): void;
  /**
   * A new active tab has arrived.
   *
   * Returns the tab that should take the caret, or null for "leave focus where it is". `canFocus`
   * answers whether that tab has a node yet; when it does not, the arming is kept for the next
   * commit rather than spent on nothing.
   */
  claim(activeTabId: string | null, canFocus: (tabId: string) => boolean): string | null;
  /** Whether a transfer is currently armed. For assertions and debugging. */
  isArmed(): boolean;
}

export function createRovingFocus(): RovingFocus {
  let armed = false;
  return {
    arm: () => {
      armed = true;
    },
    disarm: () => {
      armed = false;
    },
    claim: (activeTabId, canFocus) => {
      if (!armed) return null;
      if (activeTabId === null) {
        // Nothing left to focus. Disarmed rather than kept, or the next tab anyone opens — the
        // agent included — would inherit a transfer the user never asked for.
        armed = false;
        return null;
      }
      if (!canFocus(activeTabId)) return null;
      armed = false;
      return activeTabId;
    },
    isArmed: () => armed,
  };
}

/**
 * A pointer action on a tab: run it, take the caret nowhere, and swallow the expected refusal.
 *
 * The keyboard paths already have a `catch`, because a refusal has to disarm the focus transfer.
 * The pointer paths had none, and their promises reject for entirely ordinary reasons — a tab
 * closed by the agent a moment before the click lands, a conversation switched underneath, a window
 * going away — which surfaced as unhandled rejections in the middle of normal use.
 *
 * Nothing is reported to the user: a tab that is already gone is the outcome they asked for, and a
 * selection of a tab that no longer exists corrects itself on the next state push.
 */
export function pointerTabAction(work: Promise<unknown> | undefined): void {
  void work?.catch(() => {});
}
