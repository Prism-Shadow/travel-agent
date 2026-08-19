# The in-app browser opens with Desktop by default

Running `pnpm desktop` now enables the embedded IAB and opens its workspace immediately. Developers
no longer need to prefix the command with `PENGUIN_FLAGS=iab.enabled` or click the browser toggle
after launch.

At this checkpoint only the IAB default changed. Chrome was formally opened as a user-selectable
alternative on 2026-08-19; Vault, live secret entry and payment capabilities remain off behind
their existing gates. For diagnostics or extension-only testing, the IAB can still
be removed explicitly:

```bash
PENGUIN_FLAGS=iab.enabled=false pnpm desktop
```

The existing relay-availability check remains in place: Desktop advertises and wires the IAB only
when its relay started successfully, so a broken browser runtime is reported rather than exposed as
a toolbar control whose calls all fail.

The default-on startup path also exposed a split between the Browser CLI's two relay launchers: the
background launcher forwarded `PENGUIN_IAB_KEY`, while `penguin-browser serve` dropped it. Both now
read the key through one shared helper, so the Desktop transport authenticates successfully instead
of reconnecting forever with WebSocket code 1006.
