/** Authenticated, fail-soft destination suggestions for the draft Where dialog. */
import { Hono } from "hono";
import type { AppEnv } from "../../auth/middleware.js";
import type { AppDeps } from "../../app.js";
import { HttpError } from "../errors.js";

const MAX_QUERY_LENGTH = 80;

export function locationsRoutes(deps: AppDeps): Hono<AppEnv> {
  const app = new Hono<AppEnv>();

  app.get("/search", async (c) => {
    const query = (c.req.query("q") ?? "").trim();
    if (query.length < 2 || query.length > MAX_QUERY_LENGTH) {
      throw new HttpError(
        400,
        "invalid_location_query",
        `Location query must contain between 2 and ${MAX_QUERY_LENGTH} characters.`,
      );
    }
    const locale = (c.req.query("lang") ?? "en").trim();
    if (!/^[a-z]{2,3}(?:-[a-z0-9]{2,8})*$/i.test(locale)) {
      throw new HttpError(400, "invalid_locale", "Location search locale is invalid.");
    }
    return c.json(await deps.locationSearch.search(query, locale));
  });

  return app;
}
