# Imported passwords and history become usable

The import shipped a day earlier put saved logins into an encrypted store and browsing history into
a new database, and then nothing read either one. Both are now wired to the thing they were imported
for.

## The address bar completes

Typing in the in-app browser's address bar now suggests pages from history — both what was imported
and what has been visited here since, because ordinary browsing now records visits too (on
`did-navigate` only, so a single-page app rewriting its own URL on every click does not fill the
history with one visit repeated thirty times).

Ranked by visit count then recency, which is what makes a site visited daily beat one visited once
last night. Arrow keys move through the list, Enter opens the highlighted row, Escape closes the list
before it leaves the address bar.

Two details are load-bearing and easy to get wrong:

- **Nothing is selected by default.** With the first row pre-highlighted, typing a complete address
  and pressing Enter would navigate to a *suggestion* instead of what was typed. The selection starts
  at "the text in the box" and only a deliberate arrow key moves onto the list.
- **A late answer for an earlier query is dropped.** Each keystroke is a round trip, and they do not
  come back in order — `ct`, `ctr`, `ctri` can answer `ct` last. Every request carries a sequence
  number so a stale reply cannot overwrite the list the user is looking at.

## Saved logins fill sign-in forms

When a page has a sign-in form *and* a login is stored for its origin, a small bar offers it:
**Fill youhai@example.com**. Pressing it types the account and password into the form.

**The agent cannot do this.** There is no tool, no relay command, and no CDP route that triggers a
login fill — the only entry points are two IPC channels reachable from the application window, which
the user drives. This is a deliberate non-feature rather than an omission: an agent that could say
"sign in to ctrip.com" would be an agent that can use the person's credentials whenever it likes, and
the credential store was built specifically so that no model-visible path to a password exists. An
agent that hits a sign-in wall stops and the person signs in, which is the handover the design
already expects.

Three more refusals, each guarding a way a password could go somewhere it should not:

- **The origin comes from the tab, never from the caller.** Both channels take a tab id; main asks
  the pane what URL that tab is on. A renderer that supplied an origin could ask for one site's
  password while the user sat on another.
- **The credential is re-checked against the live origin at the moment of the fill.** The renderer
  picks by id, and the fill refuses if that credential is not for the origin the tab is on *now*.
  Without it, a page that navigated between the offer being drawn and the button being pressed would
  receive a password chosen for somewhere else — and on a sign-in page a navigation is not a rare
  event, it is what happens when one succeeds.
- **It fills but does not submit.** One click that also pressed sign-in would turn a single gesture
  into an authentication attempt nobody separately agreed to, and a stale saved password would burn
  an attempt against a lockout counter.

The write happens in an isolated world, like every other secret this application types (design/003
§6.1), and the fill script finds the fields itself rather than accepting a selector — a selector
arriving from outside is a request to type a password into whatever it matches.

## Note

`CredentialStore` gained `useForFillAsync`. The synchronous `useForFill` wipes its buffers in a
`finally`, which for an async callback runs when the callback *returns the promise* — the key would
be wiped while the write was still in flight. Typing into a page is exactly such a caller, so the
async shape is spelled out rather than inferred.
