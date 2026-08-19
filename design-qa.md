**Comparison Target**

- Source visual truth: `/var/folders/q6/q4z2w3mx3dd_jslz9x8jkw8c0000gn/T/codex-clipboard-jKDs4l.png` (`756 × 114`), showing the first implementation with an oversized text button to the right of the Session title.
- Requested target state: move the return control to the left of the Session title, show only the left-arrow icon, and retain its navigation to the New task welcome screen without deleting the Session.
- Post-fix implementation screenshot: unavailable — the Codex Desktop in-app Browser has no connected instance.
- Intended viewport: desktop app window, light theme, an existing Session opened from `Jump back in`; screenshot CSS dimensions and device scale factors were not reported.
- Density normalization: not applied because no post-fix capture is available. The source is a focused toolbar crop and its CSS size/device scale factor was not reported.

**Findings**

- [P0] Post-fix rendered and interaction evidence is unavailable.
  Location: Session header, directly left of the conversation title.
  Evidence: the source crop shows the first version as a wide `Back home` text button to the title's right. The implementation now renders only a square left-arrow button before the title, but the revised desktop window cannot be captured because no in-app Browser instance is connected.
  Impact: final title truncation, toolbar fit, focus-ring appearance, and the click-through back to the welcome screen cannot be certified visually.
  Fix: run the desktop app, open a Session from `Jump back in`, capture the toolbar at the same state, click the left-arrow button, and capture the returned welcome screen.

**Fidelity Surfaces**

- Fonts and typography: the return control has no visible text; the Session title remains `15px` semibold and truncatable. Rendered optical balance is unverified.
- Spacing and layout rhythm: the control is a fixed `28 × 28px` square placed before the title with an `8px` gap. It shrinks neither the button nor toolbar actions; the title remains the flexible truncated region. Desktop and narrow-width fit remain visually unverified.
- Colors and visual tokens: the control uses the existing neutral gray toolbar palette, hover darkening, dark-theme tokens, and a visible focus ring. Final compositing is unverified.
- Image quality and asset fidelity: no raster assets changed. The arrow is the existing Phosphor icon package rather than custom SVG/CSS artwork.
- Copy and content: no return copy is visibly rendered; localized `返回主页` / `Back home` remains available to the tooltip and accessible name. Existing Session title, actions, stats, messages, and composer copy are unchanged.
- Interaction and accessibility: the full `28 × 28px` button is clickable and always preserves its icon, tooltip, and accessible name. It navigates directly to the existing welcome draft, so neither the current Session nor an unsent home-screen draft is deleted, archived, parked, or cleared.

**Open Questions**

- None at the product-flow level; post-fix desktop rendering is the only missing evidence.

**Full-view and Focused Evidence**

- Full-view comparison: not needed for this focused toolbar correction; navigation behavior and the surrounding screen remain unchanged. Post-fix capture is still blocked by the unavailable in-app Browser.
- Focused comparison: the user crop was opened and clearly shows the incorrect right-side text button. The revised left-side icon-only region cannot be captured, so spacing and toolbar fit cannot be compared.

**Comparison History**

- Pass 1: the user-supplied flow showed a Session opened from `Jump back in` with no visible way to return to the welcome screen.
- Fix 1: added a persistent Phosphor left-arrow plus `Back home` text button after the Session title and routed it directly to the existing welcome draft.
- Pass 2: the user's focused screenshot showed that the control belonged before the title and should not display text.
- Fix 2: moved the button before the title, removed visible copy, reduced it to a fixed `28 × 28px` icon control, and retained tooltip/accessibility text and navigation behavior.
- Pass 3: code checks pass, but post-fix visual and click-through comparison remains blocked because the in-app Browser is unavailable.

**Implementation Checklist**

- [x] Place an icon-only return control immediately before the Session title.
- [x] Navigate to the existing New task welcome route without mutating the Session.
- [x] Preserve responsive title truncation and toolbar actions.
- [x] Provide hover, focus-visible, dark-theme, tooltip, and accessible-name states.
- [x] Add Chinese and English copy.
- [x] Pass all 813 Web tests, Web type checking, production build, formatting, and diff checks.
- [ ] Capture the desktop toolbar, test the click, and capture the returned welcome screen.

**Follow-up Polish**

- After capture, adjust only if the added control causes a P3 optical-spacing issue at a specific desktop width.

final result: blocked
