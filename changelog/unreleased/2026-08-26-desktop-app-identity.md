# The desktop application is Travel Agent

The shell now carries the product's identity rather than the engine's: application name, bundle
id, executables and every dialog that names the app.

Details:

- `app.setName("Travel Agent")` and the Windows AppUserModelID becomes
  `com.prismshadow.travelagent`; `electron-builder.yml` follows with `productName: Travel Agent`,
  the matching `appId`, and `linux.executableName: travel-agent`.
- The launcher's platform executable constants follow the same rename. The macOS and Windows
  names now contain a space; every interpolation of them was already inside double quotes, and
  the Windows PATH-merge fixtures now use a spaced path, so that case is exercised rather than
  assumed.
- Dialog and updater copy, the web `<title>`, and the desktop package description name the
  product. `@prismshadow/penguin-server`, `packages/core` and `packages/server` keep the engine's
  name, which is what they are.
- Published artifact names are untouched (`penguin-desktop-<platform>-<arch>`): they are
  documented as stable download links and are independent of `productName`.

**This moves `userData`.** Electron derives that directory from the application name, and it
holds the vault, the login session, localStorage (drafts, sidebar state) and the in-app browser's
tab checkpoint. Anything under the old name is left where it is and is not read again: a local
development install comes back logged out with an empty vault, and that is the intended cost —
taken deliberately because nothing has been released and no one is running this yet. Once there
are installs, a rename like this needs a migration instead.

- `mac.category` becomes `public.app-category.travel`. It was `developer-tools`, from when this
  shell was the engine's; the category is what Launchpad and the App Store file the app under.
