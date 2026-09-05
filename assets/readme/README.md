# README visuals

## Desktop browser

`desktop-browser.png` is a user-supplied 2986 × 1798 screenshot of Travel Agent Desktop in Chinese,
including its embedded browser. Both root READMEs use this image.

The conversation asks for the cheapest Beijing-to-Shanghai flight on Ctrip without extra service
packages. The browser displays Ctrip's flight results alongside the agent's task progress.
The visible stage is flight search within a booking task.

Third-party website content and airline logos retain their respective rights; the repository's
Apache license does not relicense them.

Capture the entire app window, including the native browser view. Electron's renderer-only
capture omits that view and leaves the webpage area blank.

## Reference Trip captures

`new-trip.png` and `my-trips.png` are reference captures, not the active README demos. They show the shared product UI with three synthetic trips in an
isolated server data root. They contain no personal conversations or account credentials.
The new-trip message is typed but not sent.

- `new-trip.png`: the new-trip composer and upcoming journeys.
- `my-trips.png`: the Trips overview with sample destinations and dates.

Capture these screens at 1440 × 960 CSS pixels, in English and light mode. Keep external browser
chrome and developer overlays out of the image. Refresh all captures when the visible UI changes.
Local layout previews belong under `artifacts/readme-polish/`.

## Travel Browser extension

`travel-browser-en.png` and `travel-browser-zh.png` are the supplied English and Chinese captures
of the extension welcome page. Each root README uses the matching language. They show the setup
guide and existing-tab authorization instructions; the browser and chat in the hero are
illustrations, not live connection status or a completed agent task.


## Travel task videos

The root READMEs link language-matched covers to two silent H.264 MP4 files hosted as GitHub
attachments on [PR #14](https://github.com/Prism-Shadow/travel-agent/pull/14#issuecomment-5550067681).
The exports stay under the git-ignored `demos/` beside their covers; neither they nor the original,
user-supplied recordings enter the repository history. Both links were verified to resolve
anonymously after the repository went public on 2026-09-05.

- `xiaohongshu-amap.mp4` (38 seconds, 6.8 MB):
  <https://github.com/user-attachments/assets/ca3aa959-d8ee-4ae0-ad20-740afac84a32>
  Reads Xiaohongshu travel posts, creates a two-day Beijing itinerary and opens an Amap route. The
  edit removes six seconds of blank browser startup and adds task-stage captions and a final hold.
  Encoded at CRF 24 to stay under the 10 MB attachment limit of the organization's free plan;
  SSIM 0.996 against the CRF 21 review export.
- `ctrip-hotel.mp4` (76 seconds, 6.3 MB):
  <https://github.com/user-attachments/assets/25550205-88a4-4e31-8fff-03fea801fe69>
  Filters Ctrip hotels, compares room choices, reviews the booking form and reaches the payment page. Its three-second opening uses a current Travel Agent UI
  capture with an unsent sample request. The subsequent task is a historical recording, not a
  newly executed acceptance test. App branding and browser chrome are editorial overlays.

The videos are silent and omit source container metadata. Opaque masks cover visible personal
contact details, repeated details in the conversation, account avatars, website account identity,
URL parameters and saved-payment identity. Public destination and hotel details remain visible.
Read the visible UI composition and historical-footage note together when describing the demo.

`route-cover-en.png`, `route-cover-zh.png`, `hotel-cover-en.png` and `hotel-cover-zh.png` use frames
from the processed videos with the canonical mark and localized editorial copy. They link to the
hosted MP4s rather than relying on inline HTML video support in a Markdown renderer.

To replace a video: render and review it under `artifacts/readme-video/`, copy the export to
`demos/`, upload with `gh pr comment <n> --attach demos/<file>.mp4` (or `gh issue comment`), then
update the URL here and in both root READMEs.

Raw frames, OCR output, edit scripts and review files remain in the ignored
`artifacts/readme-video/` directory. Review any replacement export before adding it here.
Third-party travel posts, maps, website content and logos retain their respective rights.
