---
id: module-web
type: module-design
status: active
title: web — travel-agent's consumer surface
parent: arch-travel-agent
depends-on:
  - module-server
tags:
  - web
  - ui
---

# web — travel-agent's consumer surface

## Responsibility

The single UI, rendered both by a browser during `pnpm dev` and by the Electron renderer in the
shipped app. There is no second front end: what the desktop shows *is* this SPA.

Its job is to make a traveller's journey the thing on screen. The engine's developer surfaces
are removed: the Agents page (system prompt, tools, MCP, skills, memory, vault, schedules), the
developer console (Usage, Traces, Benchmark), the skills picker, and the per-project settings
dialog. Model configuration stays, as the **Models** page (`/models`, linked at the sidebar's
top beside New trip, My Trips and Saved): model entries and API keys, pricing, and the default model.
On first visit without a configured key, the chat page shows a one-time credential guide that
leads there. Interface preferences (language, theme, font, home currency) live in the
settings panel opened from the sidebar's account menu; new-chat engine defaults (agent, approval mode, thinking level,
workspace) still resolve from the Project's server-side defaults but are not editable on this
surface. The inherited multi-user server API remains available to deployments and test setup, but
this consumer surface does not provision accounts: its admin Users page only lists existing users
and supports password reset or removal.

## What it owns

- **Login presentation.** A responsive sign-in page pairs the Route Penguin mark with a readable
  compact sign-in card and a vertically centered decorative dotted world map. The card centers
  the penguin mark and welcome heading above labeled inputs with decorative prefix icons and a
  navy submit button. Initial credential guidance sits below a subtle divider. The map occupies the open
  space beside the desktop form, with no promotional headline or introduction.
  The illustrative routes contain no account data or availability claims. The local basemap
  is precomputed with the same equirectangular bounds used by the route overlay; resizing scales
  them together. The map loads separately from the form, uses the existing resolved theme,
  and loops automatically without a playback control or footer. It becomes static for the
  system's reduced-motion preference. It is hidden from assistive technology and never intercepts
  form input. Narrow and short screens retain scroll access to
  every field, setting and credential hint. No account, Trip or task is created by the decoration.
- **Login guidance.** The Vite development UI displays the initial username and password as two
  labeled values when both `VITE_PUBLIC_LOGIN_USERNAME` and `VITE_PUBLIC_LOGIN_PASSWORD` are
  explicitly configured. These are public display values, not account provisioning or password
  recovery. Production builds and unconfigured development instances name the `traveler` account
  and direct the person to their server-provided initial password.
- **Default user avatar.** Expanded, collapsed and mobile account controls share a local circular
  penguin portrait in the Route Penguin palette, with a blue route-like scarf and highlighted eye.
  The adjacent username or control label identifies the account; the avatar is decorative.
- **Account continuity.** Before authenticated draft consumers mount,
  a server-confirmed administrator migration moves this origin's active, session and parked
  drafts from `admin` to `traveler`, only when the server reports `admin` as the original
  identity. Existing destination values are never overwritten; conflicts retain their source. A
  completion marker prevents stale tabs from restoring old drafts a second time. A fresh account
  without the server marker, or one reporting an unknown original identity, inherits no legacy
  drafts.
- **Sidebar identity.** The expanded sidebar pairs the canonical Route Penguin mark with the
  application name or current Project switcher. The adjacent text supplies the accessible name.
  A 2rem mark and a slightly larger wordmark keep the brand legible above the navigation.
  The collapse control sits at the right end of that header, after the brand or switcher. Collapse
  and expand use matching compact ghost icon buttons with localized accessible names and state.
- **Account settings.** The avatar opens a compact identity and action menu: Settings, web-only
  administrator User management, and web-only Sign out. An available update marks the Settings entry.
  The popup matches the account button's width and horizontal edges, following changes in font
  size and sidebar layout while remaining inside the viewport.
  Settings opens a centered panel on desktop and a full-height panel on mobile, grouped into
  Appearance, Language & region, Account & security, administrator-only Advanced, and About.
  The `settings` query preserves the active section through a language remount while retaining the
  underlying route state and unsent draft. Interface preferences keep their existing local,
  immediate-save semantics; password and service-wide proxy forms keep explicit Save and Cancel.
  Private Profile reports its unavailable editing capability. About retains version information
  and the web update flow; the desktop shell remains responsible for desktop updates.
- **Dialog presentation.** Settings, confirmations and forms share the dialog radius, border,
  surface, shadow and overlay treatment. Width and content layout remain appropriate to each task.
  Desktop cards round all four corners and clip their contents to that outline; destination
  suggestions can extend outside their form. Mobile bottom sheets retain the same upper corners,
  while full-screen settings use the screen edges.
  Desktop Chrome connection success uses a compact Travel Browser dialog with the Route Penguin
  mark, localized confirmation and existing-tab authorization guidance. Continuing only dismisses
  the dialog; it preserves the draft and browser choice and does not start a task. Keyboard focus
  enters the dialog, cycles through its controls and returns to the trigger on dismissal.
- **The Trip's presentation.** The sidebar is a list of trips with loose conversations kept in a
  place of their own; the trip page shows identity, user-maintained shared notes, the journey's
  conversations and the itinerary.
  A labeled return link above the cover opens My trips, including on direct visits, loading and
  missing-trip states. Deleting a trip also returns to the overview.
  A conversation belonging to no trip is an ordinary state and must never be forced into one.
- **Saved conversations** (`/saved`, linked directly below My trips) collect the current Project's
  saved chats across all Agents, Trips and loose questions. Existing `archived` records supply
  this view; there is no second favorites store or data migration. Saved rows no longer appear
  in nested sidebar folders. The page loads and paginates each Agent's saved category, orders
  loaded rows by conversation creation time, and exposes loading, retryable failure and empty
  states separately. Opening a row resumes the same conversation and records Saved as that
  history entry's return destination. Its toolbar returns to Saved, including after a reload;
  ordinary conversation entries keep their return to the welcome draft. Unsaving preserves its history,
  files and Trip membership and restores its ordinary sidebar category. Rename and confirmed
  deletion remain available. Mutations refresh category cursors so removing a saved row cannot
  cause the next page to skip its neighbor.
- **The Trips overview** (`/trips`, linked by My Trips in the sidebar). The current Project's
  loaded Trip index supplies a leading photo card beside two smaller cards, further dated cards,
  unscheduled cards and collapsed past trips. Dated trips order by earliest known bound; a known
  end before the local calendar day puts a trip in history, latest end first. In-progress trips
  stay in the dated section. A start without an end never implies completion; an end without a
  start never supplies a departure countdown. Flexible, blank, invalid and reversed windows are
  unscheduled, latest touched first. Equal dates use recency then Trip id. The day refreshes at
  local midnight and when the tab returns to the foreground. Cards open `/trips/:tripId` and show
  identity plus positive pending counts from loaded active conversations. No model call or extra
  per-trip request supplies the overview. Loading and retryable failure are distinct from no trips.
  A first visit shows a local decorative coastal background, brief guidance and New trip; both
  creation buttons preserve unsent text as a parked draft and open the existing new-trip composer.
  The first message creates an independent conversation; only an explicit Add to trip confirmation
  creates or joins a Trip. Opening the draft creates no record or directory.
  Completed mutations supersede older index requests and refresh the current Project's list.
  Responses from a previous Project scope cannot populate the current Project's Trips.
- **One global start.** New trip opens the existing chat welcome state, independent of the Trip
  currently on screen. Typed drafts are parked before a fresh start; topic ownership is cached
  with the draft and restored on reload. A missing topic target refuses creation visibly.
  Its sidebar button uses the compact navigation style, with a gray active fill on the draft page.
- **Starter cards below the composer** fill its text with the selected prompt, replacing the
  previous text and focusing the caret at the end. The text is editable and follows the normal
  draft cache, including reload. Choosing a card creates no Session or Trip and starts no task;
  only an explicit composer send runs it, with the current constraints and model settings.
  Filling a prompt does not require a configured model or loaded skills.
- **Explicit conversation promotion.** Add to trip creates a named Trip or joins an existing one,
  preserving the Session id, workspace and message history. A failed attachment after a confirmed
  creation keeps that Trip selected for retry. Existing artifacts stay in their original workspace.
  Model-proposed creation and automatic artifact migration are not implemented.
- **Multiple conversations per Trip.** The Trip page and conversation context bar expose New chat;
  the sidebar Trip action uses the same name. New chat and New trip share the welcome heading,
  composer, starter-card styling and responsive discovery rail. A Trip-bound draft names its
  inherited Trip in the subtitle and offers accommodation, transport and daily-plan prompts in
  the shared cards; all starters only fill editable text. Histories are separate; identity and
  notes are edited through Shared trip details.
  Each message resolves current membership and Trip details and carries them as visible input,
  including the folder and notes. Queued messages use their enqueue-time snapshot. Agent/model
  forks retain the Trip. Sharing does not copy another conversation's transcript.
- **Welcome penguin.** New trip and Trip-bound New chat share a static vector illustration above
  the greeting. It uses the canonical Route Penguin's exact geometry without its square field,
  framed by a solid ice-blue circle, a short dotted route and small blue accents. Dark mode adapts
  the decorative field. The illustration has no gradient, canvas, animation loop or remote
  assets; it ignores pointer input and is hidden from assistive technology. The brand generator
  keeps the local transparent penguin in sync with the canonical mark.
- **The draft screen's discovery rail**, in two mutually exclusive states. First run shows the
  editorial "Get inspired" prompts; choosing one fills the composer with its prompt and sends
  nothing, so the person edits and sends it like any typed sentence. From the first real trip or
  conversation the rail belongs to the person's own work — an "Up next" rail of up to three trip
  cards (soonest future departures first, then latest touched; each with countdown, aggregated
  waiting-on-you badge, the trip's meta line) over the "Jump back in" conversation tiles,
  waiting-on-you first. Every element is
  rendered from trip and session index fields; the rail makes no model call, because the root
  spec declines a proactive AI opener.
- **Decorative travel covers for the discovery rail, Trips overview and Trip detail banner.** A local catalog contains
  192 generated, lazily loaded 960×720 covers: 96 destinations, 48 activities, 24 season/weather scenes, and 24
  location-neutral fallbacks. Explicit activity intent wins over a named destination, which wins
  over seasonal mood; unknown titles can select only neutral fallbacks. When subjects exhaust
  every semantic match, unused neutral fallbacks fill in. Once all eligible candidates are used,
  eligible images may repeat; unrelated destinations never become fallbacks. Selection is
  deterministic for the same ordered subjects and exclusions, and excludes images already
  reserved by another simultaneously visible rail. The overview allocates across its whole
  grouped list, including collapsed history; expanding history leaves covers unchanged. A Trip's
  cover can differ between surfaces or after the surrounding list changes: it is decorative,
  not persisted Trip identity. Covers have empty alternative text because the card title is the
  accessible name, and a generated cover is never evidence of the exact place or offer under discussion.
- **Draft browser selection.** Desktop drafts offer a browser pill after Budget, defaulting to
  the in-app browser. The selector reports the desktop's current draft scope, waits for scope
  confirmation and saves changes through the existing bridge. Selection creates no Session or
  task and does not open the native pane. Draft scopes carry the choice through parking, reload
  and promotion; fresh drafts start on IAB. Sending waits for an acknowledged choice, and is
  disabled for a locked scope or an unavailable selected Chrome backend. Unavailable Chrome stays
  visible with an explanation and never becomes IAB implicitly. Plain web hides this selector.
- **The composer's constraint chips**, which edit the owning Trip's identity when the conversation
  has one, and otherwise remain local prompt scaffolding. Neither editing a chip nor sending
  an independent conversation creates a Trip. Independent draft constraints persist with their
  user/Project-scoped text through reload, language changes and parking; a fresh draft starts
  without those constraints. Malformed cached fields are discarded individually. Trip-bound
  drafts read the owning Trip's current details instead of persisting a second copy.
  Where remains a free-text field; its debounced destination suggestions come from the
  server's replaceable geocoder gateway and a gateway failure never disables Done. Opening Who
  commits its visible one-adult default so the dialog summary and the closed chip cannot disagree.
  Budget is a tier, a stated amount, or both; an amount always carries its currency, picked in
  the dialog and defaulting to the **home currency** — the settings panel's one currency
  preference, which follows the UI language until set (zh → CNY, else USD) and also selects the
  model-cost display currency. Amounts render through `Intl` in the reader's language (¥ and
  US$ in zh, $ and CN¥ in en), a tier's glyphs count in the budget's currency, and the composed
  budget line names the ISO code. No exchange rate exists on this surface or the server's.
  The budget currency picker uses a bounded, scrollable popover with localized currency names,
  ISO codes and a selected checkmark. Pointer selection or keyboard confirmation changes the unit;
  highlighting an option or dismissing the menu leaves the stated amount and currency intact.
- **Rendering the model's documents without editing them.** `itinerary.md` and any map the agent
  drew are read-only here; relative image names resolve through the server's trip-file endpoint.
- **The OmniMessage stream → view-model reduction** (`src/lib/omni/`): start/delta/stop aggregation,
  complete-message replacement, origin-chain nesting into subagent cards. This is the most
  behaviour-dense logic in the package and is unit-tested on its own.

## Boundary

- **DTOs come from [[module-server]] type-only** (`@prismshadow/penguin-server/api`); no server code
  enters the bundle.
- **`@prismshadow/penguin-core` is a runtime dependency, not a type-only one.** Around twenty files
  import from it, and `src/lib/omni/stream-controller.ts` imports the value guards `isEventMessage`
  and `isPartialPayload`. Only the server import is type-only.
- The web app never talks to the browser relay, the vault, or Electron directly. Anything needing
  the shell goes through [[module-desktop]]'s preload surface.

## The rule that keeps the browser pane honest

The backend a conversation uses is the conversation's property, not the screen's — the contract is
[[goal-travel-agent]] requirement 5. What this package owes it: render the state as reported,
including "unavailable", and never present the other backend as a substitute.
