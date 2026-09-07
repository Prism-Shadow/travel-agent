# Travel Agent website

The independent bilingual product website based on the approved Route Penguin visual concept.
It presents the desktop application, two travel-task videos, trip organization, browser choices,
setup guidance, FAQs and platform-specific downloads. It does not run agent tasks.

## Run

Node 24+ and pnpm 11 are recommended. This directory has its own workspace and lockfile.

```bash
cd website
pnpm install
pnpm dev --host 127.0.0.1 --port 4180
```

The Chinese homepage is `/`; English is `/en`. The site selects the saved language or the browser's
preferred supported language, with English as the fallback. Language and theme menus each include
Follow system; light and dark themes follow system changes until explicitly overridden. Host-only
cookies retain these two preferences across visits; no account or analytics service is involved.
The local preview contains no real account,
credentials or trip connection. Development and previews stay local under the user's current
instruction; see [AGENTS.md](AGENTS.md). The existing hosted copy is pending removal.

```bash
pnpm typecheck
pnpm lint
pnpm test
pnpm build
```

`SPEC.md` owns the website's behavior. This package is outside the desktop runtime workspace;
its checks run from this directory. The root repository's checks do not replace these checks.
The `Product website` CI job runs the independent build, type, lint, content, preference and local HTTP
checks. It does not save hosted versions or deploy the website.

## Content and interactions

- `lib/content.ts` contains the English and Chinese catalogs, documented video URLs and release
  asset names. The latest release names were verified against GitHub's release API.
- `components/home.tsx` owns navigation, inline video playback, accessible browser-mode
  tabs, FAQ disclosures and explicit platform downloads.
- `components/preferences.tsx` owns the language and appearance controls. `lib/preferences.ts`
  defines validated preference values and locale negotiation; middleware selects the route and
  the root layout applies the saved theme before rendering. Both preferences default to system.
- `lib/site.ts` contains the trusted Site origin returned by provisioning. Metadata never derives
  its public origin from untrusted request headers.
- `lib/metadata.ts` produces locale-specific titles, descriptions, canonical URLs and social cards.
- `app/globals.css` contains the responsive flat-color design and reduced-motion support.

The video links are the existing README recordings; they are not fresh acceptance evidence.
The hotel demonstration includes historical footage and updated branding. The website retains
that context. The text tracks describe the task rather than transcribing speech.
The two demonstrations alternate video and description columns on desktop and stack on narrow
screens. A cover click starts its player in place; starting the other video pauses the first
without resetting its progress. Native controls provide seeking, volume, captions and fullscreen.

## Asset provenance

- `public/media/logo.svg` and `penguin.svg`: canonical assets from `assets/brand` and
  `packages/web/public`, respectively. The favicon uses the same canonical logo.
- `public/media/world-dots.svg`: the desktop login's existing map from `packages/web/public/maps`.
  `lib/world-map-geometry.ts` preserves its projection helpers from the web package;
  `components/hero-map.tsx` adapts the login route overlay for a decorative, label-free background.
  These local copies keep the website independent of application runtime imports.
- Product screenshots and video covers: `assets/readme`, documented in
  `../assets/readme/README.md`. Screenshots are preserved, including the example trip labels.
- Videos: the two existing, redacted GitHub attachment URLs documented in the root READMEs.
- `public/og.png`: an original ImageGen social card. Its exact prompt and original output are
  retained in `artifacts/website-concept-20260907/social/` in the parent checkout. The generated
  source bytes are preserved; it is an illustration, not a product screenshot.
- The small download icon reuses the existing `DownloadIcon` path from the application.
- GitHub, Apple, Windows and Linux marks in `public/media/brands` are unmodified SVGs from
  [Simple Icons 11.15.0](https://github.com/simple-icons/simple-icons/tree/11.15.0/icons), used
  as single-color CSS masks beside their text labels. The project's CC0 license is retained in
  `public/media/brands/LICENSE.md`; brand trademarks remain with their respective owners.
- Language and theme control icons come from [Lucide 0.468.0](https://github.com/lucide-icons/lucide/tree/0.468.0/icons).
  Their SVGs and license are preserved in `public/media/controls`.

Third-party website content, travel photos and airline marks retain their respective rights.
The repository's Apache license does not relicense that material.

Navigation styling references the rounded highlights of
[Animated Tabs by SmoothUI](https://21st.dev/@educalvolpz/components/animated-tabs).
The site implements its own CSS treatment and retains ordinary navigation links; no third-party
component source or animation dependency is bundled for these references.

## Verification scope

The site has build/type/lint, content-contract and preference-negotiation checks. With a local
preview running, `node scripts/check-preview.mjs` also verifies both routes, document languages,
saved language overrides, theme attributes in server HTML, metadata and public assets over HTTP.
Set `WEBSITE_PREVIEW_URL` to use another preview origin.

These checks passed during implementation. Visual browser QA requires a connected browser and
is separate from those checks; the available browser runtime reported no connected browsers.
