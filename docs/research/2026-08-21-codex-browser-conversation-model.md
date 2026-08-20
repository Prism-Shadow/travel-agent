# Codex: how the built-in browser relates to conversations (2026-08-21 snapshot)

Companion to the transport-layer comparison in
`../architecture/iab-in-app-browser.md` §6, which deliberately stopped at containers and CDP.
This snapshot covers the layer issue 0008 questions: who owns the browser surface, and what a
conversation that is not on screen may do.

## Findings

1. **One shared surface "inside a chat", currently a single visible page — no tab strip.**
   The official docs frame the built-in browser as "a shared view of websites and local web
   apps inside a chat". Issue #23314 (open feature request) states the current behavior
   plainly: "the in-app browser currently behaves like a single visible browser surface", and
   asks for a tab strip; "restore active browser tabs when returning to the same thread" is
   listed as a *nice-to-have* — i.e. per-thread tab restore is not established behavior. Our
   per-conversation strips with restore are *ahead* of Codex here.

2. **Parallelism is solved at the thread level, including pop-out windows.** Codex's desktop
   pattern is "threads are meant to be switched": threads, worktrees, and pop-out windows —
   no in-window split view. A popped-out thread gets its own window, so "which conversation
   is visible" has no single answer in Codex; multiple can be on screen at once.

3. **No visibility gate on agent browsing; the gates are per-site and per-action.** ChatGPT
   "asks before it uses a website unless you have already allowed that site" and "asks for
   confirmation before sensitive actions such as submitting information, making a purchase".
   No public evidence of any analog to our `IAB_SESSION_NOT_VISIBLE` ("your conversation
   must be on screen to start browsing").

4. **Fully invisible agent browsing exists as a first-class mode.** The cloud browser (Work
   mode) runs server-side with no live pane at all; the user "follows the browser's progress
   in the chat" and opens screenshots and a replay afterwards. Visibility is delivered as
   evidence in the transcript, not by forcing a pane on screen.

## Sources

- Official browser docs (shared view inside a chat; per-site approval; sensitive-action
  confirmation; cloud browser progress/replay):
  <https://learn.chatgpt.com/docs/browser?surface=app>
- Current single-visible-surface behavior and requested tab strip: openai/codex issue #23314
  <https://github.com/openai/codex/issues/23314>
- Thread-switching-not-split-view, worktrees, pop-out windows (third-party analysis,
  2026-06-26): <https://smartscope.blog/en/generative-ai/chatgpt/codex-split-view-workarounds/>
