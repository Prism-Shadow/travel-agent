/**
 * Draft-screen example cards, in display order. Three real-site starters, each driving a named
 * site in the visible in-app browser. Copy and full prompts live in the active locale
 * dictionary at `S.chat.exampleTasks[id]`.
 *
 * Skills listed here are pinned only when the selected Agent has them installed; an empty list
 * sends the prompt unchanged.
 */
export const EXAMPLE_TASKS = [
  { id: "ctripFlight", skills: [] },
  { id: "otaCompare", skills: [] },
  { id: "xhsTrip", skills: [] },
] as const;

export type ExampleTask = (typeof EXAMPLE_TASKS)[number];
export type ExampleTaskId = ExampleTask["id"];
