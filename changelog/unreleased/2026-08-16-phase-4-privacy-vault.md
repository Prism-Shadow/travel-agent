# Phase 4: a vault the model never reads, and a payment the agent cannot make

Phase 3 made the assistant stop before a payment and ask. Phase 4 builds the machinery behind that
stop: somewhere to keep the details a booking needs, a way to type them into a page without handing
them to the model, and a payment path where the thing that spends money lives in the main process
and the agent only ever gets to *ask*.

All of it ships **off**. Turning on real personal data, a live one-time-code fill, or an
agent-triggered payment needs the agent to run in an isolated OS sandbox, and that is the next
phase's work. Until it lands, those three capabilities resolve off on every machine — not by an
oversight you could flip, but by a dependency chain the code enforces and a test pins. What you can
turn on today is the vault for your own L1 details (a name, a seat preference) and the tamper-evident
audit log; everything below that waits.

## Where your details live

The vault is one encrypted file in the app's own data directory. Each field has its own key, so
reading one detail decrypts exactly that one and deleting one rewrites nothing else. The master key
is held by the operating system's own keychain — macOS Keychain, Windows DPAPI, Linux libsecret.

That last point has a hard edge, and we chose the uncomfortable side of it. On a Linux box with no
keyring, the platform will quietly "encrypt" by storing plaintext. Rather than do that behind a
reassuring label, **the vault refuses to start**, tells you why, and points at installing a keyring.
A missing feature you can see beats a broken promise you cannot.

Three tiers decide where a detail may go. Some (a first name, a cabin preference) may be shown to the
model. Some (a document number, a phone number) may only be *typed into a form*, never read by the
model — it gets an opaque handle instead. And some (a card security code, a one-time password, a
payment password) are never stored at all, by anyone, ever. That last list is fixed: there is no
setting that moves a CVV into storage, because there shouldn't be.

## Using a detail without seeing it

When the agent needs one of your details on a site, it asks — naming the site, why, and exactly
which fields — and you decide. Approve it and the agent gets, for the fill-only details, a reference
like `pv:…:id_number` that is worth nothing on its own: only the main process can redeem it, and it
re-checks, at the moment of typing, that the page is still the site you approved. A page that has
quietly navigated somewhere else does not get filled.

The value goes into the form through a private channel that the site's own scripts can't watch, and
then it is scrubbed from everything the agent reads back — snapshots, page text — replaced with
`[REDACTED:field]`. Screenshots are the honest exception: pixels can't be pattern-matched, so a
screenshot is covered where we know a value sits and **refused outright** when we can't be sure it's
covered. A picture that might contain your card number is not a feature.

## The payment the agent cannot make

Before a payment, the confirmation you approve becomes a one-shot permission bound to that exact
purchase — the merchant's domain, the amount, the turn it belongs to, an expiry. The agent is handed
the permission's *id*, never a way to pay. When it reaches the payment page it asks the main process
to spend the permission, and five checks run there, in order: is there a valid permission for this
purchase, is it allowed at this ceiling, is the page still showing what was agreed, has this already
been paid, and only then — pay. A payment interrupted halfway (the machine sleeps, the process is
killed) leaves a mark that forces checking the order with the merchant rather than paying again.

In this build the last step is switched off, so the agent still stops at the payment page and you
complete it yourself — exactly Phase 3's behaviour, now with the whole machine standing ready behind
it.

## The parts you can check

A settings panel shows what this build may do and, for anything it may not, the reason in a sentence
— so "the vault won't start because there's no keyring" never looks the same as "there's no vault".
The audit log records every grant, fill and payment by name (never by value) and chains each entry
to the last, so a deleted or altered line shows up when you check its integrity.

## For developers

- New `EnvironmentConfig.hostTools`: a product-neutral way for a host to add tools the core runtime
  doesn't know about. The desktop shell uses it for the three vault/payment tools; the CLI and
  `penguin web` get none, because there is no vault behind them.
- A broker IPC channel (Unix socket / named pipe, 0600) carries the three privileged operations
  between the server and the main process, authenticated by a one-shot token passed only through the
  server's fork environment. Its limits are documented, not oversold: before OS isolation, that
  token is readable by the agent, so it guards against other local software, not against the agent.
- `booking.ts` gained a fifth check (capability, ahead of authority/drift/journal/submit), and the
  transaction package a `PaymentCapability` with a deterministic drift/expiry/replay matrix.
- `GET /api/capabilities` reports the resolved feature flags with their denial reasons, for the
  settings panel.
