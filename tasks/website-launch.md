# Travel Agent product website

## Scope

Implement the approved blue-and-white landing-page concept as an independent website in
`website/`. The consumer desktop UI and pinned engine remain outside this change. Reuse the
canonical brand and documented demonstration assets. Chinese and English are product content.

## Delivery plan

1. Scaffold the independent site and implement the recognizable hero and product demonstration.
2. Open the first working local preview, then complete task videos, trip organization, browser
   setup guidance, downloads, language switching and responsive navigation.
3. Add metadata and a branded social preview. Keep download links grounded in available release
   assets and preserve the historical-footage context for the hotel demonstration.
4. Validate the site build, types, content/link contracts and changed-file formatting. Keep the
   root spec graph and website documentation aligned with the new surface. Run the independent
   website checks in CI without publishing or deploying it.
   Include system-aware language and appearance menus, saved preferences, locale negotiation
   and first-paint theme checks in the website validation.
5. Keep development and previews local. Remove the hosted copy while retaining local source.

## Boundaries

- The website does not run browser tasks, accept model credentials, or process bookings.
- Download visitors are told that the application needs their own model API key.
- Payment remains a user action. No invented testimonials, adoption statistics or task results.
- No hosted deployment, including a private preview, without a new explicit user request.

## Verification

Implementation and source documentation are complete. Website typecheck, lint, eight content
and preference tests, production build, and local HTTP checks pass. HTTP checks cover both
routes, language negotiation, saved overrides, theme attributes before first paint, inline
players, metadata and public assets.

The root pre-push gate passes: desktop debug-switch check, build, formatting, typecheck, unit
tests, 64 web browser tests, desktop browser tests, and the live-model connectivity test.

Browser visual QA remains unverified because the available runtime had no connected browser.
Verification logs are local evidence under `artifacts/website-concept-20260907/pr-verification/`.

## Hosted-copy removal

The user requests removal of the hosted site and local-only work. The current Sites tool catalog
has no delete or unpublish operation, and browser discovery returns no connected browser. Removal
is not complete. A read-back confirms the existing site remains active and owner-only, with one
allowed account and no external viewers.

Cleanup target: `appgprj_6a9e27cec11481918ecdd7733645c3b9`
(`https://travel-agent.red12158.chatgpt.site`). Preserve `.openai/hosting.json` until removal can be
verified. Complete removal through an available Sites management UI or a supported delete tool;
do not create a replacement site or deploy another version as a substitute for deletion.
