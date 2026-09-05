/**
 * Server runtime config (ServerConfig) — parsed from environment variables.
 *
 * The data root directory is shared with the SDK / CLI (`resolveRoot()`:
 * PENGUIN_HOME or ~/.penguin/data); the SQLite index database defaults to
 * `<root>/web.db` (overridable via PENGUIN_WEB_DB, tests use ":memory:").
 * In production, the SPA is served statically once the frontend build output
 * directory (PENGUIN_WEB_DIST, the bundled web-dist/, or ../web/dist) is
 * detected to exist.
 * Docs: /docs/configuration § "Environment variables".
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { DEFAULT_SERVER_PORT, resolveRoot } from "@prismshadow/penguin-core";

export interface ServerConfig {
  /** Local data root directory (shared with the SDK/CLI). */
  root: string;
  /** HTTP listen address and port (defaults to 127.0.0.1:7364, deliberately avoiding common ports like 3000/8080). */
  host: string;
  /**
   * Listen port. `0` asks the OS for an ephemeral port (the desktop shell always does),
   * in which case the value is only a request: index.ts writes the ACTUAL bound port back
   * here once listening, because preview URLs are built from the server's own port rather
   * than the browser's (dev serves the SPA on a different port; see resolvePreviewTarget).
   */
  port: number;
  /**
   * Root directory Trip folders are created under (PENGUIN_TRIPS_DIR).
   *
   * Defaults to `<root>/trips` so that every entry point which redirects the data root —
   * `pnpm dev` pointing at `~/.penguin/dev-data`, and tests — keeps its Trips with it and
   * can never write into a real person's folders. The packaged desktop app sets this
   * explicitly to a user-visible location: a trip is a folder its owner can find, back up
   * and keep, which is the point of building this in the open.
   */
  tripsDir: string;
  /** SQLite database path; ":memory:" for test injection. */
  dbPath: string;
  /** Frontend static assets directory; whether it's enabled is decided by checking existence when the app is assembled. */
  webDist: string;
  /**
   * Origin that serves Workspace HTML previews (PENGUIN_PREVIEW_ORIGIN), e.g.
   * `https://preview.example.com`. It must differ from the App origin by **hostname** —
   * cookies ignore ports, so a second port would still share the session cookie. Unset
   * is the norm locally: the loopback counterpart (`127.0.0.1` <-> `localhost`) is
   * derived per request instead.
   */
  previewOrigin: string | null;
  /**
   * Override for the seeded built-in admin's password (PENGUIN_SEED_ADMIN_PASSWORD), for
   * tests, e2e and deployments that must not start on the public default; null (the norm)
   * seeds INITIAL_ADMIN_CREDENTIALS.password in every mode, desktop included — the shell
   * signs its window in by token and never needs the value, but a data root later opened
   * with `penguin web` must still answer to the documented credentials.
   */
  seedAdminPassword: string | null;
  /** Login session validity period (7 days). */
  authSessionTtlMs: number;
  /** Sliding renewal threshold: if the remaining validity is below this value when validation succeeds, it's renewed to the full TTL (renews under 6 days). */
  authSessionRenewMs: number;
  /**
   * Desktop mode (PENGUIN_DESKTOP_TOKEN): the per-launch token minted by the desktop
   * shell. Non-null enables the one-shot desktop-login and Bearer-token shutdown
   * endpoints and requires a loopback HOST — desktop mode passes the token through a
   * URL, which must never leave the machine.
   */
  desktopToken: string | null;
  /**
   * Port announcement file (PENGUIN_PORT_FILE): after the listener is up, the actual
   * bound port is written here — the supervising process's way to learn the port when
   * it starts the server with PORT=0.
   */
  portFile: string | null;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Default frontend build output directory, first match wins:
 * - `<this package>/web-dist`: npm package layout — the release workflow copies the built
 *   web assets into the published package, so an `npm install` gets the Web UI too;
 * - `<this package>/../web/dist`: monorepo layout (resolves the same whether running
 *   from src or dist), also the fallback when neither exists.
 */
function defaultWebDist(): string {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const bundled = path.resolve(here, "..", "web-dist");
  if (fs.existsSync(bundled)) return bundled;
  return path.resolve(here, "..", "..", "web", "dist");
}

/**
 * Validates PENGUIN_PREVIEW_ORIGIN into a bare origin, or throws. An unparseable value
 * is a hard failure rather than a silent fallback: falling back would quietly serve
 * previews same-origin, which is the configuration this variable exists to avoid.
 */
function normalizePreviewOrigin(raw: string | undefined): string | null {
  if (!raw || raw.trim() === "") return null;
  let url: URL;
  try {
    url = new URL(raw.trim());
  } catch {
    throw new Error(`Invalid PENGUIN_PREVIEW_ORIGIN=${raw} (expected an absolute origin)`);
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error(`Invalid PENGUIN_PREVIEW_ORIGIN=${raw} (only http/https are supported)`);
  }
  return url.origin;
}

/** Parses server config from environment variables (PORT / HOST / PENGUIN_HOME / PENGUIN_WEB_DIST / PENGUIN_WEB_DB / PENGUIN_TRIPS_DIR / PENGUIN_PREVIEW_ORIGIN / PENGUIN_SEED_ADMIN_PASSWORD / PENGUIN_DESKTOP_TOKEN / PENGUIN_PORT_FILE). */
export function resolveServerConfig(env: NodeJS.ProcessEnv = process.env): ServerConfig {
  const root = env.PENGUIN_HOME ?? resolveRoot();
  // An empty PORT string is treated as unset (the common `.env` case of an empty
  // `PORT=`): Number("") === 0 would pass the range check and bind to a random
  // port; this matches the CLI's resolvePort convention.
  const port = Number(env.PORT || DEFAULT_SERVER_PORT);
  if (!Number.isInteger(port) || port < 0 || port > 65535) {
    throw new Error(`Invalid port configuration PORT=${env.PORT}`);
  }
  const host = env.HOST ?? "127.0.0.1";
  const desktopToken = env.PENGUIN_DESKTOP_TOKEN?.trim() || null;
  // Desktop mode redeems its token through a URL: never allow it off loopback.
  if (desktopToken !== null && host !== "127.0.0.1" && host !== "localhost") {
    throw new Error(`Desktop mode requires a loopback HOST (got HOST=${host})`);
  }
  return {
    root,
    host,
    port,
    dbPath: env.PENGUIN_WEB_DB ?? path.join(root, "web.db"),
    tripsDir: env.PENGUIN_TRIPS_DIR?.trim() || path.join(root, "trips"),
    webDist: env.PENGUIN_WEB_DIST ?? defaultWebDist(),
    previewOrigin: normalizePreviewOrigin(env.PENGUIN_PREVIEW_ORIGIN),
    // An empty/whitespace value is treated as unset (→ the fixed default at seed time).
    seedAdminPassword: env.PENGUIN_SEED_ADMIN_PASSWORD?.trim() || null,
    authSessionTtlMs: 7 * DAY_MS,
    authSessionRenewMs: 6 * DAY_MS,
    desktopToken,
    portFile: env.PENGUIN_PORT_FILE?.trim() || null,
  };
}
