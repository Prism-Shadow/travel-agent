# Docs move to English, starting with the ones an agent reads first

`CONTRIBUTING.md` has always said English is the repository's working language, with Chinese allowed
only where it *is* the content. Several documents under `docs/` predate that being enforced. They are
being translated, highest-traffic first.

This batch:

- **`docs/architecture/iab-in-app-browser.md`** — fully translated, including the Mermaid node labels,
  the Codex comparison table and the "honest boundaries" section. It is the document `AGENTS.md`
  points at for how the in-app browser works, so it was the one worth doing first.
- **`docs/verification/`** — the descriptive Chinese in phase-00, phase-01, phase-06 and
  `isolation.md` (table labels, "非目标", "分档 / A档", "auto-update 升/降") is now English.

`AGENTS.md` states the rule explicitly, with a table of the three cases where Chinese is still
correct, and notes that a partially translated `docs/` is a known intermediate state: do not add
Chinese to those files, and translate the one you are editing if the change is substantial.

## What deliberately stayed Chinese

The rule is that Chinese is allowed where it **is** the content, never where it *describes* the
content. Under `docs/verification/` that leaves:

- Captured page evidence — Ctrip page titles, accessible names (`选择日期`, `酒店 按回车键打开菜单`),
  the date labels `pickDate` matched. Translating captured evidence would falsify it.
- The utterances and button labels under test in phase-03 — `可以`, `就它吧`, `立即支付`,
  `确认支付`. These are the literals the confirmation matcher is asserted against.

## Still to do

`docs/design/001`–`005` (~37k characters), `docs/research/` (~7.7k), and `docs/manual-testing/`
(~5.6k). The manual-testing set has to move as one batch: `_template.md` defines the case fields
(`状态`, `严重度`, `实测`, …) that all six phase files use, so translating the template alone would
desynchronize it from every case written against it.
