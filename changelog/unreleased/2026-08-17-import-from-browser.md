# Import cookies, saved logins and history from your own browser

The in-app browser starts empty: a separate profile from the user's Chrome, which is what keeps a
booking site's code away from their everyday browsing, and also what makes them sign in to every
travel site again before the agent can do anything useful. **Browser → Import from browser** brings
the three things that matter over from a Chromium-family profile they already have.

It finds Chrome, Edge, Brave, Chromium and Vivaldi, lists each profile under the name its owner gave
it (*"Google Chrome — youhai"*, read from `Local State`), and offers three checkboxes with the row
counts beside them. Nothing is read until Import is pressed.

## What lands where

- **Cookies** go into the in-app browser's own session (`persist:travel-iab`). Session cookies are
  kept, because they are the ones carrying a live sign-in. The user's own Chrome is not touched.
- **Saved logins** go into a **new encrypted store**, not into the Vault. The Vault is a fixed table
  of known personal fields with declared tiers and model projection; website logins are an open-ended
  `(origin, username)` set that no model should ever see. The new store reuses the Vault's crypto —
  per-credential data keys, AES-256-GCM with the record name as additional authenticated data, the
  master key wrapped by the OS keychain — and deliberately has **no path that reveals a password to a
  model**. The only way one leaves is a callback that receives it and wipes it afterwards.
- **Browsing history** goes into a new SQLite history store, which the in-app browser did not have
  at all before. It also gives the address bar something to complete against. It is not encrypted,
  and the file header says why: the threat it would be encrypted against is another process running
  as the same user, which 003 §4.3 already states the vault does not defend against either.

## What it refuses to do

- **Passwords are not imported at all on a machine with no encrypted storage.** The checkbox is
  disabled and says so. Writing them to a file this app cannot protect, while the UI claims they are
  saved, is the invisible broken promise that 003 §4.4 exists to prevent.
- **Chrome 127+ App-Bound Encryption on Windows is reported, not worked around.** Those cookies are
  bound to the Chrome executable specifically so other applications cannot read them. The import says
  so instead of importing the handful of older rows and reporting success.
- **A source is named, never pathed.** The IPC channel takes an id this app itself listed
  (`chrome:Default`), matched against a grammar that cannot express `..` or an absolute path. Without
  that, "import" would be a primitive that reads any SQLite file on the disk and hands it back
  decrypted.
- **Nothing is decrypted to draw the dialog.** Counts come from `COUNT(*)`, so opening the dialog
  never provokes the macOS keychain prompt — that happens on Import, once, for the kinds that were
  ticked. History needs no key at all, so ticking only history prompts for nothing.

## Notes

Reads are taken from a **copy** of each database, including its `-wal` sidecar. Chrome holds these
files open, and the WAL is where the most recent sign-ins live — copying only the main file imports
yesterday's state and looks exactly like a success. The dialog still asks for the browser to be
closed when it detects one running, because a checkpoint mid-import is the remaining gap.

A partial import is reported as partial. Sixty unreadable rows out of four thousand is a success with
a footnote; the footnote is shown rather than rounded away.

Importing the same profile twice is idempotent: logins replace by `(origin, username)` and history
takes the larger visit count rather than summing, so a second Import does not double every ranking.
