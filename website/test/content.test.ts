import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import test from "node:test";
import { content, demos, downloads, links } from "../lib/content.ts";

const root = fileURLToPath(new URL("../", import.meta.url));

test("both language catalogs provide the same content structure and nonempty strings", () => {
  function check(a: unknown, b: unknown, path: string) {
    if (typeof a === "string") {
      assert.equal(typeof b, "string", path);
      assert.ok(a.trim());
      assert.ok((b as string).trim());
      return;
    }
    assert.deepEqual(Object.keys(a as object), Object.keys(b as object), path);
    for (const key of Object.keys(a as object))
      check(
        (a as Record<string, unknown>)[key],
        (b as Record<string, unknown>)[key],
        `${path}.${key}`,
      );
  }
  check(content.zh, content.en, "content");
});

test("download links cover each published installer without silently selecting an architecture", () => {
  const variants = downloads.flatMap((system) => [...system.variants]);
  assert.equal(new Set(variants.map((v) => v.file)).size, 5);
  for (const variant of variants) {
    const url = new URL(links.downloadBase + variant.file);
    assert.equal(url.hostname, "github.com");
    assert.ok(url.pathname.startsWith("/Prism-Shadow/travel-agent/releases/latest/download/"));
    assert.match(variant.file, /^travel-agent-(?:darwin|win32|linux)-[a-zA-Z0-9._-]+$/);
  }
  assert.deepEqual(
    downloads[0].variants.map((v) => v.file),
    ["travel-agent-darwin-arm64.dmg", "travel-agent-darwin-x64.dmg"],
  );
});

test("every demonstration has localized covers and valid full-length text tracks", () => {
  for (const [id, demo] of Object.entries(demos)) {
    assert.equal(new URL(demo.source).origin, "https://github.com");
    assert.ok(new URL(demo.source).pathname.startsWith("/user-attachments/assets/"));
    for (const locale of ["zh", "en"]) {
      assert.ok(existsSync(`${root}public/media/${id}-${locale}.png`));
      const track = readFileSync(`${root}public/media/${id}-${locale}.vtt`, "utf8");
      assert.ok(track.startsWith("WEBVTT\n"));
      assert.match(track, /00:00:00\.000 --> 00:0[01]:[0-5][0-9]\.000/);
    }
  }
});

test("each locale preserves the model-key, desktop-extension and payment boundaries", () => {
  assert.match(content.zh.key, /API Key/);
  assert.match(content.en.key, /API key/);
  assert.match(content.zh.browserDetails[1], /桌面应用运行/);
  assert.match(content.en.browserDetails[1], /Desktop open/);
  assert.match(content.zh.historical, /历史任务录屏/);
  assert.match(content.en.historical, /historical task footage/);
  assert.match(content.zh.faqs[2].a, /不会/);
  assert.match(content.en.faqs[2].a, /^No\./);
});
