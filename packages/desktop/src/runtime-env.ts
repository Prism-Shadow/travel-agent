import path from "node:path";
import { fileURLToPath } from "node:url";

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
