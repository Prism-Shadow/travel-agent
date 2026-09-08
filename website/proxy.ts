import { NextResponse, type NextRequest } from "next/server";
import { LANGUAGE_COOKIE, languagePreference, localePath, requestLocale } from "./lib/preferences";

export function proxy(request: NextRequest) {
  const locale = requestLocale(
    languagePreference(request.cookies.get(LANGUAGE_COOKIE)?.value),
    request.headers.get("accept-language") || "",
  );
  const path = localePath(locale);
  if (request.nextUrl.pathname !== path) {
    const destination = request.nextUrl.clone();
    destination.pathname = path;
    const response = NextResponse.redirect(destination);
    response.headers.set("Cache-Control", "private, no-store");
    response.headers.set("Vary", "Accept-Language, Cookie");
    return response;
  }
  const headers = new Headers(request.headers);
  // Derive the document language from our routes, overriding any visitor-supplied value.
  headers.set("x-travel-agent-locale", request.nextUrl.pathname === "/en" ? "en" : "zh-CN");
  const response = NextResponse.next({ request: { headers } });
  response.headers.set("Cache-Control", "private, no-store");
  response.headers.set("Vary", "Accept-Language, Cookie");
  return response;
}

export const config = { matcher: ["/", "/en"] };
