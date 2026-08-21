# Issue 0009 opened: deleting a conversation leaks its browser strip

An IAB audit after the pane-follows-conversation change found that sidebar deletion never
reaches the pane — no bridge channel exists for it — so a deleted conversation's live
`WebContentsView`s, relay target claims, dormant checkpoint entries, and per-scope
requested/backend state all outlive it until app restart. Hidden starts make
deleted-with-tabs an ordinary state, raising the exposure. Recorded with a `dropScope` fix
direction; the audit also re-ran every suite green (desktop 869, browser-cli 594+1 skipped,
web 822, skills 21, real-Electron e2e).
