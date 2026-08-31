# Agent Note: Cap agent tasks at 200 turns

Status: implemented — new and default-restored Agents stop a Task after 200 model turns

## Problem

The built-in Agent configuration leaves `max_turns` unlimited. That removes the last bounded-cost
stop when a model keeps exploring a live site without reaching a user-visible result. A three-OTA
flight comparison also demonstrates that 100 turns is too small for the current browser workflow:
the run reached the third site's results after 100 completed model requests and stopped before it
could compare the offers.

The product needs a finite default that contains a stalled run without making today's representative
multi-site task fail at the first safety boundary.

## Decision

`defaultSystemConfig()` sets `max_turns` to 200. This applies to newly materialized Agent configs and
to an explicit restore to defaults. The kernel generation records the value, so a smart kernel
update advances an untouched historical default while preserving any positive limit or unlimited
value that a person configured themselves.

The direct `ContextEngine` SDK fallback remains `-1` when a caller omits `maxTurns`. Product policy
belongs to the materialized Agent config; the engine primitive does not silently impose it on other
callers.

The 200-turn limit is containment, not the remedy for inefficient browser work. Browser workflows
still need to batch related page actions, avoid timeout budgets that cannot fit their own waits, and
return a partial comparison before consuming the final budget.

## Alternatives considered

- **Keep the default unlimited.** This never cuts off a legitimate long task, but it also gives a
  stuck browser workflow no bounded-cost terminal condition.
- **Use 100 turns.** The observed three-site starter task exhausted that budget before producing its
  comparison, so it does not cover a product-owned representative scenario.
- **Change only the current development Agent.** That repairs one local run but leaves newly created
  and default-restored Agents with different behavior.
- **Make the budget dynamic by task complexity.** The runtime has no reliable code-side measure of
  browser-task complexity, and adding a rule table for that judgement conflicts with the product's
  model-judges boundary.

## Consequences

Long-running Tasks can consume twice the turns allowed by the current development Agent's former
100-turn customization, so model cost and elapsed time can increase before containment fires.
Conversely, a task that would run indefinitely now terminates at a predictable boundary. Tests pin
the default, kernel generation, smart-merge behavior, and the engine's unchanged direct-construction
fallback.
