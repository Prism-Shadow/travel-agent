# Website working instructions

This directory is a standalone Next.js site with its own workspace; run its checks from here
(`pnpm typecheck && pnpm lint && pnpm test && pnpm build`). Production deploys are made from the
Vercel project `opentravelagent` (see [README](README.md) § Deployment); do not add a second
hosting path or a deploy step to CI. Behaviour is owned by [SPEC.md](SPEC.md).
