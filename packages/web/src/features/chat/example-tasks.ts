/**
 * Draft-screen example cards, in display order. Choosing a starter fills the composer;
 * the person can edit it before sending. Copy and full prompts live in the active locale
 * dictionary at `S.chat.exampleTasks[id]`.
 */
export const EXAMPLE_TASKS = [
  { id: "ctripFlight" },
  { id: "otaCompare" },
  { id: "xhsTrip" },
] as const;

export type ExampleTask = (typeof EXAMPLE_TASKS)[number];
export type ExampleTaskId = ExampleTask["id"];
