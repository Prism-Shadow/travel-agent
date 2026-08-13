# CI: ignore penguin-browser formatting, copy extension icons on Windows

Ubuntu CI died on Prettier across the imported `browser-cli` / `browser-extension` trees (215 files). Those packages keep the formatting they arrived with; they are now in `.prettierignore`.

Windows CI died building the extension: `vite-plugin-static-copy` was given `path.resolve(..., 'icons/*')`, which is not a valid glob on Windows. The target is now the `icons` directory itself.
