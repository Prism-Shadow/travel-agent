---
id: goal-travel-agent
type: goal-and-requirements
status: active
title: travel-agent — what the product is, and what it refuses to be
tags:
  - product
---

# travel-agent — what the product is, and what it refuses to be

The root of this repository's spec graph. It states the product's goal, the interaction it is
judged on, and the scope decisions that constrain every feature. Architecture is
[[arch-travel-agent]]; the reasoning behind a particular boundary lives in
[`docs/decisions/`](docs/decisions/README.md), never here.

## Goal

travel-agent is an **open-source consumer travel application** built on PenguinHarness (the agent
engine) and penguin-browser (the visible in-app browser, plus an optional connection to the
person's own Chrome). This repository is the only place those two are joined.

Its first-class object is the **Trip**: a journey the person is taking, which owns a directory on
their own disk and gathers that journey's conversations, identity (where / when / who / budget) and
itinerary. Conversations are the instrument; the Trip is what accumulates.

## The interaction it is judged on

A person says one sentence. The agent searches, reduces the option space to a few representatives
**each with a reason**, waits for a click that is also authorization, fills the form, and **stops
on the payment page**.

Every requirement below exists to keep that sentence true.

## Why it is worth building in the open

It drives real pages with the person's own browser and accounts. Two consequences follow, and they
are the product's whole claim:

- **Reach.** It works on sites no API partnership covers, because it uses the site the way a person
  does.
- **Custody.** The money never leaves the person's hands, and a trip is a folder they can back up,
  move, or keep after uninstalling.

## Requirements

1. **The agent never completes a payment.** It stops at the payment gate, which has no enable flag.
   The person performs the irreversible action. Enforcement lives in `packages/browser-cli`
   ([[module-browser-cli]]) because the model controls the click surface and is therefore inside
   the threat model.
2. **Every reduction of the option space carries a reason.** A list without reasons is a search
   result, not the product.
3. **A click is authorization.** The agent does not act on inferred consent, and confirming a
   summary card acknowledges the summary — it does not grant authority to spend.
4. **The person's files are theirs.** A trip directory lives on their disk, is readable without
   this application, and survives its uninstallation.
5. **The choice of browser backend is explicit and stable.** It is made per conversation, cannot
   change while a task runs, and never falls back silently to the other backend — an unavailable
   choice stays visible as unavailable. A false state about which browser is driving is worse than
   a stopped task.
6. **The model judges; code only enforces** where the model is itself inside the threat model.
   A rule table that reproduces a judgement the model makes better is not shipped.

## Scope

What the product adopts, and what it declines. Each row's reason is the load-bearing part — the
names alone would not settle anything.

| Adopted | Because |
| --- | --- |
| The Trip as a container above conversations (1 : N) | Without it every conversation restarts from zero and no artifact has a home |
| Trip identity — where / when / who / budget — inherited by each conversation | The constraint chips existed as per-draft scaffolding with nowhere to live |
| Mutable conversation ↔ trip membership | The product's entry shape is one sentence said before the person knows what it becomes |
| An itinerary document, written by the model | It is the task's visible result and the reason to come back |
| A map, as evidence for a spatial claim | It strengthens arbitration-with-reasons, the one capability reviewers say the category lacks |

| Declined | Because |
| --- | --- |
| Price watching, drop alerts, auto-rebooking, ticket-sniping | All need a long-lived process; this product has none by design |
| A booking or receipt ledger | The run stops at the payment page and cannot observe the outcome, so a stored "booked" state would be a guess |
| A proprietary POI or fact database | The anti-hallucination story here is different — the agent reads the real page |
| An inspiration feed, community, creators, group collaboration | Growth mechanics of a free consumer product, unrelated to this tool |
| A planning hub that is itself the product | This is a transaction product; only the planning the transaction rests on is adopted |
| A generic browser-automation or scraping tool | The browser is how this product reaches travel sites, not the product |

Ctrip is a demo scene, not the product. This is not a Ctrip or Fliggy client, and not a fork
intended to be sent back to PenguinHarness as a product.

## Where the rest lives

| Question | Home |
| --- | --- |
| How the shipped system fits together | [[arch-travel-agent]] |
| What a module owns and may depend on | that module's `SPEC.md` |
| Why a boundary is where it is, and what was given up | [`docs/decisions/`](docs/decisions/README.md) |
| Standing orders for agents working here | [`AGENTS.md`](AGENTS.md) |
| Where any piece of prose belongs | [`docs/AGENTS.md`](docs/AGENTS.md) |
