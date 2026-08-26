# The app says its own name, and stops offering a choice of one

Two pieces of engine vocabulary left at the top of the consumer sidebar are cleared: the product
called itself after its engine, and a tenancy control sat where the product's name belongs.

Details:

- `S.appName` is **Travel Agent**. It was "PenguinHarness" — the agent engine this application is
  built on — which is what the document title, the mobile drawer and the draft screen have been
  announcing.
- The Project switcher renders only when more than one Project exists. With one, the slot is the
  application's name: a dropdown offering a single choice is furniture, and a badge announcing
  that you own the only thing that exists says nothing. The switcher returns as soon as a second
  Project does, because hiding one that exists would strand it.
- Creating a Project and opening Project settings move into the developer console at the bottom,
  beside Agents / Models / Usage / Traces / Benchmark. They stay reachable on purpose: Project
  settings still holds the default model and the new-chat defaults.

Deliberately **not** changed here: the desktop application's own identity —
`app.setName("PenguinHarness")`, `productName`, and the Windows AppUserModelID. Electron derives
`userData` from the application name, and that directory holds the vault, the login session,
localStorage (drafts, sidebar state) and the in-app browser's tab checkpoint. Renaming it
relocates all of that, so an existing install would silently come back logged out with an empty
vault. That is a release-boundary decision with a migration attached, not a rename.
