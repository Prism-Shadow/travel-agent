# todo — consumer-surface backlog from the 2026-09-01 review

Eight observations from using the product, triaged against the code. Four shipped (git history
has them: destination suggestions in zh, inspiration cards that fill the composer, "Saved",
budgets with a currency). One was tried and withdrawn: removing the sidebar's "New chat" beside
"New trip" (2026-09-02, the owner prefers both entries — a loose question should not have to
become a journey). The two below wait on a decision, recorded under each.

## Waiting on a decision

- [ ] **(6) Private profile: cannot add entries.** Not a gate: the four Add/Delete buttons are
      hardcoded `disabled`, and the write path does not exist — no IPC channel, no preload
      method, zero production callers of `ProfileVault.put`; `vault.enabled` defaults to false so
      the vault shell is never constructed. D3 permits user-entered **L1** fields (name, email,
      city, seat/room/breakfast) today; L2 (passport, phone, address, birth date) stays closed.
      Work: desktop IPC `vault:*` + preload exposure (web SPEC forbids a server route), UI inputs
      bound to L1 fields, label→field mapping against `vault/tiers.ts`, enable `vault.enabled`,
      split the `editingUnavailable` copy. Desktop-only to test.
- [ ] **(2) "Explore" hub across users.** No Explore surface exists; the nearest thing is the
      first-run "Get inspired" rail (three static prompts). Trips carry no user column and no
      public/shared flag; no cross-user query exists. The root SPEC's Declined table names
      "an inspiration feed, community" and "a planning hub that is itself the product". Building
      this means amending the root SPEC first. A second local user is easy regardless:
      `POST /api/admin/users {userId,password}` as admin (see `e2e/auth.mjs` `provisionUser`).
