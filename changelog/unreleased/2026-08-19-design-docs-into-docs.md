# Docs: the numbered design records archived under docs/design/

The repo-root `design/` folder (001-architecture through 006-generated-travel-cover-library)
moved to `docs/design/`, so all contributor documentation now lives under one root.

Updated to match: the README / README.zh / CONTRIBUTING links, the
`docs/architecture/iab-in-app-browser.md` reference, the directory tree (which also gains the
previously missing 005/006 entries), and the `../docs/…` relative links inside 004/005 (now
`../…` since the records live inside `docs/` themselves).

Left as written: prose citations of the form `design/00X §Y` in source comments and in dated
verification/changelog records. The number scheme still identifies the document uniquely, and
the new path `docs/design/00X-…` contains `design/00X` as a substring, so existing searches
keep resolving.
