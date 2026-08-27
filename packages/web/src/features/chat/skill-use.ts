/**
 * Skill-invocation helpers for the chat input area (pure logic, shared by chat-input /
 * message-item / the agent settings Skills tab, and unit tests).
 *
 * The `[use_skills]` marker block itself is **not** defined here: it is a globally agreed
 * format shared by the frontend, the backend and the core prompt template, so its producer
 * and parser live in core's marker module (`@prismshadow/penguin-core/markers`) and are
 * re-exported below for this feature's existing importers. What stays local is the UI-only
 * part: the icon path and UI-language text selection.
 *
 * There is no skills picker and no `/<skill_name>` command: skills are built in and the model
 * finds the one it needs. `buildSkillsMessage` survives for the home screen's starter cards,
 * which name the skill their scenario needs, and the parser for rendering messages that carry
 * the block.
 */
import type { SkillMetadataItem } from "@prismshadow/penguin-server/api";

export { buildSkillsMessage, parseSkillsMessage } from "@prismshadow/penguin-core/markers";

/** Book icon (24×24 line path): shared across skill-related UI (nav items are inlined separately in sidebar / app-layout). */
export const BOOK_ICON =
  "M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2zM22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z";

/**
 * Picks copy based on the UI language: uses the Chinese value when locale is zh and one is
 * provided, otherwise falls back to English. Shared by the input area's chip hint and the
 * slash skill item's description (the metadata's Chinese fields are all optional).
 */
export function localizedText(locale: "zh" | "en", enText: string, zhText?: string): string {
  return locale === "zh" && zhText ? zhText : enText;
}

/** Minimal shape needed to pick a short description's copy (SkillMetadataItem is a superset). */
export interface SkillDescLike {
  description: string;
  shortDescription?: string;
  shortDescriptionZh?: string;
}

/**
 * Picks the **short description** for the UI language (falls back to the full description if
 * missing): language takes priority over length — zh tries shortDescriptionZh ->
 * shortDescription -> description in order; en tries shortDescription -> description. Shared by
 * the composer's skills dropdown and the slash description.
 */
export function localizedShortText(locale: "zh" | "en", s: SkillDescLike): string {
  if (locale === "zh") {
    return s.shortDescriptionZh || s.shortDescription || s.description;
  }
  return s.shortDescription || s.description;
}
