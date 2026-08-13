import { fileURLToPath } from 'node:url'
import { readFileSync } from 'node:fs'
import { dirname, resolve } from 'node:path'
import { defineConfig } from 'vite'
import { viteStaticCopy } from 'vite-plugin-static-copy'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Bundle the penguin-browser package version into the extension so it can report
// which penguin-browser version it was built against. CLI/MCP use this to warn
// when the extension is outdated.
const penguinBrowserPkg = JSON.parse(readFileSync(resolve(__dirname, '../browser-cli/package.json'), 'utf-8'))

const defineEnv: Record<string, string> = {
  'process.env.PENGUIN_BROWSER_PORT': JSON.stringify(process.env.PENGUIN_BROWSER_PORT || '19989'),
  __PENGUIN_BROWSER_VERSION__: JSON.stringify(penguinBrowserPkg.version),
  __PENGUIN_BROWSER_OPEN_WELCOME_PAGE__: JSON.stringify(process.env.PENGUIN_BROWSER_OPEN_WELCOME_PAGE !== '0'),
}
if (process.env.TESTING) {
  defineEnv['import.meta.env.TESTING'] = 'true'
}

// Allow tests to build per-port extension outputs to avoid parallel run conflicts.
const outDir = process.env.PENGUIN_BROWSER_EXTENSION_DIST || 'dist'

export default defineConfig({
  plugins: [
    viteStaticCopy({
      targets: [
        {
          // Copy the directory, not `icons/*`: path.resolve() + a glob dies on Windows
          // (`D:\...\icons\*` is not a match for vite-plugin-static-copy).
          src: 'icons',
          dest: '.',
        },

        {
          src: resolve(__dirname, 'manifest.json'),
          dest: '.',
          transform: (content) => {
            const manifest = JSON.parse(content)

            // Only include tabs permission during testing
            if (process.env.TESTING) {
              if (!manifest.permissions.includes('tabs')) {
                manifest.permissions.push('tabs')
              }
            }

            // Keep the stable Penguin Browser public key from manifest.json in
            // development and test builds so the runtime ID matches the relay allowlist.
            return JSON.stringify(manifest, null, 2)
          },
        },
      ],
    }),
  ],

  build: {
    outDir,
    emptyOutDir: false,
    minify: false,
    rollupOptions: {
      input: {
        background: resolve(__dirname, 'src/background.ts'),
        offscreen: resolve(__dirname, 'src/offscreen.html'),
        welcome: resolve(__dirname, 'src/welcome.html'),
      },
      output: {
        entryFileNames: '[name].js',
        format: 'es',
      },
    },
  },
  define: defineEnv,
})
