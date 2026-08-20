# Agent Note: Ship Amap location services as a built-in skill, not a seeded MCP server

Status: implemented

## Problem

The product's core move is reducing an option space to a few representatives, each with a reason.
For mainland-China scenes — the Ctrip demo's home ground — the most persuasive reasons are
geographic: walking minutes to a metro station, distance to a venue, a transit route, a day-trip
ordering. The agent had no source for them beyond whatever the booking page itself displays.

Amap ships this twice, first-party: an MCP server (hosted SSE/streamable HTTP, or an npx stdio
package) and an agent skill (`amap-web/amap-lbs-skill` — SKILL.md plus node scripts over the Web
Service REST API). Both need the user's own API key; neither can ship with one.

## Decision

Vendor the official skill into the built-in library (`packages/skills/skills/amap-lbs-skill`,
upstream `cc41817`, MIT) rather than seeding an MCP server entry, because every seam the skill
needs already exists while the MCP form would have required new mechanism:

- **Distribution** is the preinstall path the library already runs for every agent — a directory
  under `skills/` without `preinstall: false` installs at creation and refreshes on load. An MCP
  entry would need new seeding logic, and `kernel-update` deliberately never touches
  `tools.mcpServers` (user-owned), so built-in updates could not reach it.
- **The key** rides the Agent vault: the scripts read it from the environment (`AMAP_KEY` — the
  one name every script accepts; the shared module also takes `AMAP_WEBSERVICE_KEY`), and vault
  values are injected into every command's env without entering the model context — an existing,
  tested path. The MCP config offers no vault interpolation; its `env`/URL fields
  persist in `system_config.yaml` as plaintext.
- **Prompt surface**: the skill's `description` is injected via `{{SKILL_METADATA}}`, which is the
  sanctioned channel for teaching the agent when to reach for it. The kernel default prompt stays
  untouched — no `KERNEL_VERSION` bump, no engine-baseline edit.

## Adaptations (recorded, not silent)

The scripts are vendored byte-for-byte; SKILL.md is adapted at two seams:

- **Library conventions** (enforced by `packages/skills` tests): house frontmatter
  (English description, dual short descriptions, natural version, ISO `updated`), a
  `## Before you start` section, and a line-art `icon.svg`. The upstream setup section is
  replaced by Before-you-start's vault-first guidance; the upstream body — scenario flows,
  Chinese trigger phrases included — stays as-is, because that text is the functionality.
- **Telemetry removed.** Upstream instructs the model, in six scenario flows, to fire a
  `restapi.amap.com/v3/log/init` beacon before doing anything ("第零步：发送埋点统计请求").
  The payload is only a scenario label, but a built-in skill must not instruct telemetry the
  user never agreed to; all six instructions are removed. The `appname=amap-lbs-skill`
  attribution parameter inside real API requests is upstream's and stays — it rides calls the
  feature itself requires.

## Given up / deferred

- The MCP form: stays available to any user through the existing per-agent MCP UI; a built-in
  seeded entry can be revisited if vault interpolation for MCP env ever lands (an engine
  decision).
- A kernel-prompt line steering the agent toward Amap for domestic scenes: the skill description
  already carries that signal; a kernel edit costs a KERNEL_VERSION generation and touches the
  pinned baseline for no demonstrated gap. Revisit only with evidence the description alone
  under-triggers.
- Bundled `node_modules`: the scripts need `axios`; committing dependencies was rejected, the
  bundled upstream `package.json` plus a Before-you-start install step covers first use.

## Consequences

Every agent now carries two built-in skills (`penguin-browser`, `amap-lbs-skill`, the latter in a
new "Travel" group). The skill is inert without a user-supplied key and says so up front —
consistent with no-silent-fallback. Coverage is mainland China; overseas scenes stay on the
browser skill, and the skill text says that too.
