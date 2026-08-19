# Retire the transaction package

The non-cohesive `packages/transaction` workspace package is retired, with active contracts moved to their real owners and unreachable payment execution machinery removed.

The server API now owns the interaction-card contract and validation, while browser-cli owns its
handover reducer. The unused checkpoint and escalation paths, payment commitments, capabilities,
WAL, server payment guard/routes/tool, desktop payment authority, and broker payment operation are
deleted together with their feature flags and workspace dependencies.

Payment still stops before money moves: browser-cli's enumerated write surface now applies an
unconditional payment-control refusal with no environment flag that can open it. The seven-field
confirmation card remains a review and handoff surface, while the former price-tolerance fields are
removed because the person completes payment in the browser. Living architecture, repository
guides, the built-in browser skill, and isolation docs now describe that single production path.
