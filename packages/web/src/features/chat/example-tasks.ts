/**
 * Draft-screen example cards, filed into collapsible folders in display order.
 *
 * Folders are what lets the showcase grow past a flat list: exactly ONE folder is open at a
 * time (bookmark-style — opening one closes the other), so the block's height is one row per
 * folder plus the open folder's own rows, never the whole catalog. Adding an example means
 * appending it to the folder it belongs to, not lengthening the page.
 *
 * Keep the folders similarly sized: the draft page reserves no scroll area for this block, so
 * a folder much longer than its siblings is what would make the height jump between them.
 *
 * Copy and full prompts live in the active locale dictionary at `S.chat.exampleFolders[id]`
 * and `S.chat.exampleTasks[id]`. Skills listed here are pinned only when the selected Agent has
 * them installed; an empty list sends the prompt unchanged.
 */
export const EXAMPLE_FOLDERS = [
  {
    id: "plan",
    tasks: [
      { id: "destinationPlan", skills: [] },
      { id: "hotelCompare", skills: [] },
      { id: "flightCompare", skills: [] },
    ],
  },
  {
    id: "booking",
    tasks: [
      { id: "reviewBooking", skills: [] },
      { id: "adjustTrip", skills: [] },
      { id: "browseDeals", skills: [] },
    ],
  },
] as const;

export type ExampleFolder = (typeof EXAMPLE_FOLDERS)[number];
export type ExampleFolderId = ExampleFolder["id"];
export type ExampleTask = ExampleFolder["tasks"][number];
export type ExampleTaskId = ExampleTask["id"];

/**
 * Flat view of every example across folders, in display order. The folders drive the UI; this
 * is for whole-catalog work that doesn't care which folder an example sits in — looking one up
 * by id, or asserting across all of them.
 */
export const EXAMPLE_TASKS: readonly ExampleTask[] = EXAMPLE_FOLDERS.flatMap((folder) => [
  ...folder.tasks,
]);
