import path from "node:path";
import { fileURLToPath } from "node:url";
import { homedir } from "node:os";

/**
 * Source runs fork an injected pnpm copy of penguin-server from node_modules/.pnpm.
 * Its package-relative `../web/dist` fallback therefore cannot see this checkout's Web
 * build. Packaged apps carry server/web-dist and need no override; an explicit override
 * remains authoritative for custom development layouts.
 */
export function developmentWebDistEnv(
  packaged: boolean,
  explicit = process.env.PENGUIN_WEB_DIST,
): Record<string, string> {
  if (packaged || explicit) return {};
  return {
    PENGUIN_WEB_DIST: path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      "..",
      "..",
      "web",
      "dist",
    ),
  };
}

/**
 * Where the installed app keeps Trips: a folder in the person's home directory, not buried
 * in application data. A trip is theirs — findable, backup-able, and still readable after
 * this application is gone — which is a large part of why it is worth running an open-source
 * travel agent at all.
 *
 * Only a packaged app claims that location. A source run (`pnpm desktop`) leaves the variable
 * unset so the server's default keeps Trips beside whatever data root that run was pointed at
 * — `~/.penguin/dev-data` — and development can never write into real trips. An explicit
 * override stays authoritative either way.
 */
export function tripsDirEnv(
  packaged: boolean,
  explicit = process.env.PENGUIN_TRIPS_DIR,
  home = homedir(),
): Record<string, string> {
  if (explicit) return {};
  if (!packaged) return {};
  return { PENGUIN_TRIPS_DIR: path.join(home, "Penguin Trips") };
}
