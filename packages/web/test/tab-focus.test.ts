/**
 * Roving focus in the browser tab strip (src/features/chat/tab-focus.ts).
 *
 * The reason this is a state machine rather than a `node.focus()` next to the key handler: the
 * selection is applied by the main process and comes back as a state push, so the tab that should
 * take the caret does not exist when the key is pressed. Every case below is a way that round trip
 * can end other than "the tab I chose arrived".
 */
import { describe, expect, it } from "vitest";

import { createRovingFocus } from "../src/features/chat/tab-focus";

const anyNode = (): boolean => true;
const noNode = (): boolean => false;

describe("createRovingFocus", () => {
  it("hands the caret to the tab a keyboard selection produced", () => {
    const focus = createRovingFocus();
    focus.arm();
    expect(focus.claim("tab-2", anyNode)).toBe("tab-2");
  });

  it("spends the arming once", () => {
    // The state push that follows a selection is not the only one that arrives; a second must not
    // move the caret again.
    const focus = createRovingFocus();
    focus.arm();
    expect(focus.claim("tab-2", anyNode)).toBe("tab-2");
    expect(focus.claim("tab-2", anyNode)).toBeNull();
    expect(focus.isArmed()).toBe(false);
  });

  it("takes nothing when the change was not a keyboard one", () => {
    // A click already put the caret where the user is looking, and an agent opening a tab must not
    // move it at all.
    const focus = createRovingFocus();
    expect(focus.claim("tab-2", anyNode)).toBeNull();
  });

  it("gives up the arming when main refuses the selection", () => {
    // The regression this exists for: a rejected `selectTab` left the flag armed, so the *next*
    // change to the strip — an agent opening a tab, seconds later — pulled the caret out of
    // whatever the user was doing.
    const focus = createRovingFocus();
    focus.arm();
    focus.disarm();
    expect(focus.isArmed()).toBe(false);
    expect(focus.claim("tab-9", anyNode)).toBeNull();
  });

  it("gives up the arming when a keyboard close fails", () => {
    const focus = createRovingFocus();
    focus.arm();
    focus.disarm();
    expect(focus.claim("tab-3", anyNode)).toBeNull();
  });

  it("moves to whatever became active after a keyboard close", () => {
    // Delete/Backspace on a tab: the neighbour main selects is the one that gets the caret, so the
    // strip stays navigable from the keyboard instead of dropping focus to the document.
    const focus = createRovingFocus();
    focus.arm();
    expect(focus.claim("tab-neighbour", anyNode)).toBe("tab-neighbour");
  });

  it("disarms when the strip empties, and does not follow the next tab opened", () => {
    // Closing the last tab. Keeping the arming would hand the caret to whatever appears next, which
    // is usually a tab the agent opened while the user was reading somewhere else.
    const focus = createRovingFocus();
    focus.arm();
    expect(focus.claim(null, anyNode)).toBeNull();
    expect(focus.isArmed()).toBe(false);
    expect(focus.claim("tab-agent-opened", anyNode)).toBeNull();
  });

  it("waits for a tab whose node has not rendered yet", () => {
    // Not a failure: main's state push and React's commit are two different moments, and the tab
    // arrives in the strip a beat before it has a node. Disarming here would lose the transfer the
    // user actually asked for.
    const focus = createRovingFocus();
    focus.arm();
    expect(focus.claim("tab-2", noNode)).toBeNull();
    expect(focus.isArmed()).toBe(true);
    expect(focus.claim("tab-2", anyNode)).toBe("tab-2");
  });

  it("keeps the last arming when two keyboard actions overlap", () => {
    const focus = createRovingFocus();
    focus.arm();
    focus.arm();
    expect(focus.claim("tab-2", anyNode)).toBe("tab-2");
    expect(focus.isArmed()).toBe(false);
  });
});
