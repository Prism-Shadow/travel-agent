# Dragging the split no longer blanks the in-app browser

Resizing the chat/browser split hides the native `WebContentsView` for the duration of the
drag — it is a native surface above the DOM and would swallow the pointer events the drag
needs. That part is by design; what was missing was any stand-in: the pane rendered as an
empty white hole for the whole drag.

The splitter now freezes the page the same way the Browser menu already does. On pointer-down
the renderer captures the visible page **before** hiding it (capture refuses once the view is
occluded, so the order matters), pins the frozen frame to the hole's own origin at its captured
pixel size — the live view keeps content anchored to the viewport origin while resizing, and
the stand-in behaves the same instead of stretching — and keeps it for a 120 ms grace after
release while the native surface comes back. Occlusion is capped at 80 ms behind the capture so
a slow capture can never leave the native surface eating the drag.

Verification: the viewport markup tests cover the pinned drag frame and its absence outside a
drag; the full web suite (70 files, 820 tests) and typecheck pass.
