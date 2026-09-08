import assert from "node:assert/strict";
import { siteOrigin as expectedOrigin } from "../lib/site.ts";
import { demos } from "../lib/content.ts";

const localOrigin = process.env.WEBSITE_PREVIEW_URL || "http://localhost:4180";
const cases = [
  { path: "/", language: "zh-CN", title: "Travel Agent — 会操作浏览器的开源 AI 旅行助手" },
  {
    path: "/en",
    language: "en",
    title: "Travel Agent — Open-source AI travel assistant that operates your browser",
  },
];
function attributes(tag) {
  return Object.fromEntries(
    [...tag.matchAll(/([\w:-]+)="([^"]*)"/g)].map((match) => [
      match[1],
      match[2].replaceAll("&amp;", "&"),
    ]),
  );
}
for (const entry of cases) {
  const response = await fetch(new URL(entry.path, localOrigin), {
    headers: { "Accept-Language": entry.language },
  });
  assert.equal(response.status, 200, entry.path);
  const html = await response.text();
  const title = html.match(/<title>([^<]+)<\/title>/)?.[1];
  assert.equal(title, entry.title, `${entry.path}: page title`);
  const tags = [...html.matchAll(/<meta\s[^>]+>/g)].map((match) => attributes(match[0]));
  const meta = (key) => tags.find((tag) => tag.property === key || tag.name === key)?.content;
  assert.equal(meta("og:title"), entry.title);
  assert.equal(meta("twitter:title"), entry.title);
  assert.equal(meta("og:image"), `${expectedOrigin}/og.png`);
  assert.equal(meta("twitter:image"), `${expectedOrigin}/og.png`);
  assert.ok(meta("description")?.length > 35);
  assert.equal(meta("og:description"), meta("description"));
  assert.equal(html.match(/<html[^>]*lang="([^"]+)"/)?.[1], entry.language);
  assert.equal(html.match(/<html[^>]*data-theme="([^"]+)"/)?.[1], "system");
  const canonical = [...html.matchAll(/<link\s[^>]+>/g)]
    .map((match) => attributes(match[0]))
    .find((tag) => tag.rel === "canonical");
  assert.equal(new URL(canonical?.href).href, new URL(entry.path, expectedOrigin).href);
  const videos = [...html.matchAll(/<video\b[^>]*>/g)].map((match) => match[0]);
  assert.equal(videos.length, 2, `${entry.path}: both demo players render in place`);
  for (const [index, id] of ["route", "hotel"].entries()) {
    const tag = videos[index];
    const video = attributes(tag);
    assert.equal(video.id, `demo-video-${id}`);
    assert.equal(video.src, demos[id].source);
    assert.equal(video.preload, "none", `${id}: no download before a play request`);
    assert.doesNotMatch(tag, /\bautoplay(?:\s|=|>)/i, `${id}: playback needs user action`);
    assert.match(tag, /\bplaysinline(?:\s|=|>)/i, `${id}: mobile playback stays inline`);
    assert.equal(video["aria-labelledby"], `demo-title-${id}`);
    assert.ok(html.includes(`aria-controls="demo-video-${id}"`), `${id}: labeled play control`);
    assert.ok(html.includes(`id="demo-title-${id}"`), `${id}: adjacent video description`);
  }
  assert.doesNotMatch(html, /<dialog\b/, `${entry.path}: no demo modal`);
  console.log(
    `PASS ${entry.path}: response, locale, metadata and inline demo players without autoplay`,
  );
}
for (const [path, accept, cookie, expectedPath] of [
  ["/", "en-US", "", "/en"],
  ["/en", "zh-CN", "", "/"],
  ["/", "zh-CN", "travel-site-language=en", "/en"],
  ["/en", "en-US", "travel-site-language=zh", "/"],
  ["/", "fr-FR", "travel-site-language=system", "/en"],
]) {
  const response = await fetch(new URL(path, localOrigin), {
    headers: { "Accept-Language": accept, Cookie: cookie },
    redirect: "manual",
  });
  assert.equal(response.status, 307);
  assert.equal(new URL(response.headers.get("location"), localOrigin).pathname, expectedPath);
  assert.match(response.headers.get("cache-control") || "", /no-store/);
}
for (const theme of ["light", "dark", "system"]) {
  const response = await fetch(new URL("/", localOrigin), {
    headers: { Cookie: `travel-site-language=zh; travel-site-theme=${theme}` },
  });
  assert.equal(response.status, 200);
  const html = await response.text();
  assert.equal(html.match(/<html[^>]*data-theme="([^"]+)"/)?.[1], theme);
  assert.equal(html.match(/<html[^>]*lang="([^"]+)"/)?.[1], "zh-CN");
}
console.log("PASS language detection, saved overrides and theme before first paint");
for (const path of [
  "/favicon.svg",
  "/og.png",
  "/media/desktop-browser.png",
  "/media/route-zh.vtt",
  "/media/hotel-en.vtt",
  "/media/brands/github.svg",
  "/media/brands/apple.svg",
  "/media/brands/windows.svg",
  "/media/brands/linux.svg",
  "/media/controls/globe.svg",
  "/media/controls/sun.svg",
  "/media/controls/moon.svg",
  "/media/controls/monitor.svg",
]) {
  const response = await fetch(new URL(path, localOrigin), { method: "HEAD" });
  assert.equal(response.status, 200, path);
  console.log(`PASS ${path}: asset available`);
}
