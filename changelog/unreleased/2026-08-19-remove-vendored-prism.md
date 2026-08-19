# The vendored Prism.js leaves the extension

The welcome page's syntax highlighter is removed rather than given the version and license
bookkeeping it was missing.

- `vendor/prism/` held two minified files with no version marker and no license banner, consumed
  only by `src/welcome.html` to color the bash snippets on a page a person sees once. Keeping it
  compliant (Prism is MIT — the notice must travel with the code) would have cost more than the
  cosmetic highlighting was worth; this follows the repo's standing slim-upstream-baggage pattern.
- Removed: `vendor/`, `scripts/copy-prism.ts`, the third step of the extension `build`, and the
  two `<script>` tags in `welcome.html`. The `language-bash` classes stay — they are semantic.
- Evidence the highlighter was already optional: the test-side extension builds never ran the copy
  step, so test-built extensions have shipped the welcome page without Prism all along.
- Verified: extension `build` green with the two-step pipeline; built `welcome.html` carries no
  Prism references; the browser-backed restricted-iframe tests pass on a freshly built extension.
