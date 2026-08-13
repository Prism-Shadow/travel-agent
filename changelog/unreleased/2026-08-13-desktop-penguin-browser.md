# Desktop installers ship penguin-browser and the Chrome extension

A packaged desktop app now includes the `penguin-browser` CLI, starts its relay on launch, puts `bin/` on the embedded server's PATH so the agent can exec the command, and copies the unpacked extension to `resources/penguin-browser-extension`. Chrome still requires the user to load that folder once (menu: Load Penguin Browser Extension). Install CLI Commands also links `penguin-browser` next to `penguin`.
