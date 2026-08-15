import { defineConfig } from "tsup";

export default defineConfig({
  // launcher.ts is a second entry on purpose: scripts/stage.mjs imports dist/launcher.js
  // at stage time (plain node, no Electron) to generate the CLI launcher scripts.
  // preload-browser.ts is a third: Electron loads it by path into the app window, so it has to
  // exist as its own file rather than be inlined into main.
  entry: ["src/main.ts", "src/launcher.ts", "src/preload-browser.ts"],
  format: ["cjs", "esm"],
  target: "node22",
  platform: "node",
  clean: true,
  sourcemap: true,
  // `electron` is a runtime builtin inside the Electron main process; the workspace
  // packages stay external so the server entry keeps its own file identity (the shell
  // forks it as a child by path) and lock.js resolves from node_modules.
  external: ["electron", "@prismshadow/penguin-server", "@prismshadow/penguin-core"],
});
