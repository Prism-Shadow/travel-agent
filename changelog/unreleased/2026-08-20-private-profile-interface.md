# Private Profile interface

Private Profile now has a dedicated, account-owned management surface that reports the runtime's real privacy capabilities without inventing stored personal data.

- Add `Private Profile` to the bottom-left account menu and route it to
  `/settings/private-profile`.
- Recreate the selected quiet-overview design with Overview, Personal details, Preferences, and
  Privacy & activity tabs, plus a direct Why? path from blocked identity fields to the privacy
  explanation.
- Distinguish standalone web, enabled, quietly off, and probe-denied vault states from the existing
  capability report; preserve the runtime's denial reason when one exists.
- Keep identity/contact fields unavailable until `vault.l2l3` is truly enabled and state which
  payment and authentication secrets are never stored.
- Render all profile fields as `Not saved` and disable write/delete controls until a real Desktop
  Vault CRUD bridge exists; no `localStorage` fallback or mock personal data is introduced.
- Add English and Chinese UI copy plus pure model tests for route parsing and fail-closed capability
  presentation.
