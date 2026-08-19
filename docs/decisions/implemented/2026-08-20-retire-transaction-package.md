# Agent Note: Retire the transaction package and place invariants at their action surfaces

Status: implemented

## Problem

`packages/transaction` grouped interaction cards, browser handover, checkpoints, escalation,
commitments, a write-ahead journal, payment capabilities, and booking submission under one package
name. That grouping suggested one production transaction boundary, but the runtime evidence did not
support it:

- interaction cards were consumed by the server and Web;
- browser handover was consumed only by browser-cli;
- no production caller read a task checkpoint or used the escalation adapter;
- no production caller issued a payment capability;
- the only shipped payment port threw an unconfigured error, while its feature flags were
  unreachable behind unmet isolation prerequisites;
- browser-cli already enforced the product's actual end state at the click surface: stop before the
  control that takes the money.

Keeping those unrelated and unreachable mechanisms together made package presence look like product
necessity. It also created two competing payment stories: an agent-triggered execution design and
the stated product behavior in which the person pays.

## Decision

The transaction workspace package is retired without a replacement package.

- The shared interaction-card types live in `packages/server/src/api/types.ts`; their runtime
  validation and lifecycle live in `packages/server/src/interaction/`.
- The handover reducer lives with its only production consumer in
  `packages/browser-cli/src/executor/handover-state.ts`.
- The browser payment gate is unconditional. There is no payment-enable flag, agent payment tool,
  broker operation, server authorization route, desktop payment authority, payment capability, or
  WAL execution path.
- Checkpoint and escalation code with no production reader or caller is deleted.

The seven-field confirmation card remains useful as a review summary and handoff cue. Its approval
does not confer authority to spend; the person completes payment on the merchant page. Price
tolerance fields are removed because they have no meaning when the agent cannot execute payment.

## Alternatives considered

- **Keep `packages/transaction` and delete only dead files.** Rejected because the two remaining
  responsibilities have different owners and change reasons. A shared package would preserve an
  architectural dependency without a shared invariant.
- **Create a smaller replacement package for interaction types.** Rejected because server already
  owns the HTTP/SSE contract and exports `@prismshadow/penguin-server/api` to Web. Another workspace
  package would add a boundary without an independent runtime or release unit.
- **Keep the dormant payment executor for a future phase.** Rejected because the product stops at
  payment, no executor is configured, and inactive security machinery is not protection. A future
  agent-payment product would require a new explicit decision and an end-to-end threat model.
- **Delete the confirmation card with the payment executor.** Rejected because showing the complete
  merchant, item, amount, cancellation, method, expiry, and task still helps the person review what
  the agent prepared before taking over.

## Consequences

- Workspace consumers no longer depend on `@travel-agent/transaction`, and clean installation has
  no transaction workspace package to inject or build.
- Payment safety has one enforceable production story: every enumerated browser click surface passes
  through the unconditional payment gate, and the person performs the final action.
- Interaction outcomes still validate against their card before publication; secret-entry requests
  and outcomes still carry no secret values.
- Historical changelog and design records continue to describe the earlier experiment as history;
  living architecture and contribution docs describe the current boundary.
- Reintroducing agent-triggered payment is a new product and security decision, not a flag flip.

## Testing

Core flag resolution and host-tool tests, server interaction/broker/capability tests, browser-cli
handover/write-gate tests, desktop broker/vault-gating tests, and Web capability tests pin the moved
contracts and the removed execution surface.
