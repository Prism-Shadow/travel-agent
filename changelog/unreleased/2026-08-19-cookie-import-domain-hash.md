# Importing cookies from your own browser actually works now

Every cookie import was failing, and the report said so in a way that hid the cause: *"Imported 29;
3342 could not be read"*. Nothing was wrong with the key, the keychain prompt, or the AES.

Chromium's cookie database reached **version 24**, and with it the plaintext of `encrypted_value`
stopped being the value. It is now `SHA-256(host_key) ‖ value` — the domain is bound into the
ciphertext so a row cannot be moved between hosts inside the file. A reader that does not know this
gets no error at all: decryption succeeds, and every value simply arrives 32 bytes too long.
Chromium's own cookie parser then rejects almost all of them for the control characters a hash
contains, which is where "could not be read" came from.

The 29 that appeared to succeed were the ones whose 32-byte hash happened to contain no byte the
parser forbids — about 0.8% of rows, which is what 29 out of 3371 is. They were imported **wrong**,
carrying 32 bytes of hash in front of the value. So the feature was not 99% broken; it was entirely
broken, and the successful-looking count was noise.

`stripCookieDomainHash` now removes the prefix, and only when it verifies as that row's own host
hash — so a profile holding rows written by an older Chromium (no prefix) imports both kinds
correctly out of the same file. Saved logins and history are untouched: the binding is the cookie
store's, not `os_crypt`'s.

## A test that was counting a shared directory

The new crypto tests shifted the timing of the import suite enough to expose a latent race:
`does not leave a copy of the cookie jar in the temp directory` counted `penguin-import-*` entries
in the global `os.tmpdir()`, while the import-service test file ran in a parallel worker creating
and removing entries under that same prefix. It now points `TMPDIR` at a directory only it writes
to and asserts that directory is empty, which is the property it was always trying to state.
