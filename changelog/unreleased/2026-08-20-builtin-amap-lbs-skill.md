# Amap location services join the built-in skill library

The official Amap skill (`amap-web/amap-lbs-skill` @ `cc41817`, MIT) is vendored into
`packages/skills` as a second built-in skill, giving every agent mainland-China geographic
grounding — POI and nearby search, geocoding, walking/driving/transit/cycling routes, day-trip
planning, shareable map links — over the Amap Web Service REST API.

- Distribution rides the existing preinstall path (installed at agent creation, refreshed on
  load); a new "Travel" (出行) skill group carries it in the library UI.
- The user's own key rides the Agent vault (`AMAP_KEY`, the name every bundled script accepts) into every command's environment,
  never the model context; without a key the skill is visibly inert and asks, consistent with
  no-silent-fallback.
- Adaptations are recorded in the decision note
  (`docs/decisions/implemented/2026-08-20-builtin-amap-lbs-skill.md`): house frontmatter and
  `## Before you start` per library conventions, and the six upstream "第零步" analytics-beacon
  instructions removed — a built-in skill must not instruct telemetry the user never agreed to.
  Scripts are vendored byte-for-byte; the directory joins `.prettierignore` like the other
  vendored packages.
- Chosen over seeding the first-party Amap MCP server: preinstall and vault are existing, tested
  seams, while MCP seeding would need new mechanism and stores its key material in plaintext
  config (full comparison in the decision note).
