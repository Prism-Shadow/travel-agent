#!/usr/bin/env node

import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

const scriptDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(scriptDir, "..");
const sourcePath = path.join(repoRoot, "assets", "brand", "travel-agent-logo.svg");
const checkOnly = process.argv.includes("--check");

const FULL_COLOR = {
  navy: "#0D1B3D",
  eye: "#0D1827",
  route: "#0B5CFF",
};

const variants = {
  full: FULL_COLOR,
  idle: { navy: "#18181B", eye: "#18181B", route: "#18181B" },
  disabled: { navy: "#6B7280", eye: "#6B7280", route: "#9CA3AF" },
};

function recolor(source, colors) {
  return source
    .replaceAll(FULL_COLOR.navy, colors.navy)
    .replaceAll(FULL_COLOR.eye, colors.eye)
    .replaceAll(FULL_COLOR.route, colors.route);
}

async function renderPng(svg, size) {
  return sharp(Buffer.from(svg), { density: 288 })
    .resize(size, size, { fit: "contain" })
    .png({ compressionLevel: 9, adaptiveFiltering: false, palette: false })
    .toBuffer();
}

async function existingMatches(destination, expected) {
  try {
    return (await fs.readFile(destination)).equals(expected);
  } catch (error) {
    if (error && error.code === "ENOENT") return false;
    throw error;
  }
}

async function emit(destinationRelative, expected, stale) {
  const destination = path.join(repoRoot, destinationRelative);
  if (await existingMatches(destination, expected)) return;

  if (checkOnly) {
    stale.push(destinationRelative);
    return;
  }

  await fs.mkdir(path.dirname(destination), { recursive: true });
  await fs.writeFile(destination, expected);
  console.log(`[brand] wrote ${destinationRelative}`);
}

function validateCanonicalSvg(source) {
  const required = [
    'viewBox="0 0 256 256"',
    'data-brand-part="body"',
    'data-brand-part="route"',
    'data-brand-part="destination"',
    'data-brand-part="eye"',
  ];
  const missing = required.filter((token) => !source.includes(token));
  if (missing.length > 0) {
    throw new Error(`Canonical logo is missing required SVG tokens: ${missing.join(", ")}`);
  }
  if (/<image\b|<script\b|\son[a-z]+=/i.test(source)) {
    throw new Error("Canonical logo must contain vector geometry only and no executable content.");
  }
}

async function main() {
  const canonical = await fs.readFile(sourcePath, "utf8");
  validateCanonicalSvg(canonical);

  const svgByVariant = Object.fromEntries(
    Object.entries(variants).map(([name, colors]) => [name, recolor(canonical, colors)]),
  );
  const stale = [];

  await emit("packages/web/public/travel-agent-logo.svg", Buffer.from(canonical), stale);
  await emit(
    "packages/browser-extension/icons/travel-agent-logo.svg",
    Buffer.from(canonical),
    stale,
  );
  await emit(
    "packages/browser-extension/icons/penguin-browser-icon-gray-disabled.svg",
    Buffer.from(svgByVariant.disabled),
    stale,
  );

  const rasterJobs = [
    ["packages/desktop/build/icon.png", "full", 1024],
    ["packages/desktop/build/icons/128x128.png", "full", 128],
    ["packages/desktop/build/icons/256x256.png", "full", 256],
    ["packages/desktop/build/icons/512x512.png", "full", 512],
    ["packages/browser-extension/icons/penguin-browser-icon-black.png", "idle", 128],
    ["packages/browser-extension/icons/penguin-browser-icon-gray-disabled.png", "disabled", 128],
  ];

  for (const size of [16, 32, 48, 128]) {
    rasterJobs.push(
      [`packages/browser-extension/icons/penguin-browser-${size}.png`, "full", size],
      [`packages/browser-extension/icons/icon-green-${size}.png`, "full", size],
      [`packages/browser-extension/icons/icon-black-${size}.png`, "idle", size],
      [`packages/browser-extension/icons/icon-gray-${size}.png`, "disabled", size],
    );
  }

  for (const [destination, variant, size] of rasterJobs) {
    await emit(destination, await renderPng(svgByVariant[variant], size), stale);
  }

  if (stale.length > 0) {
    const sourceHash = crypto.createHash("sha256").update(canonical).digest("hex").slice(0, 12);
    throw new Error(
      [
        `Brand assets are stale for canonical SVG ${sourceHash}:`,
        ...stale.map((file) => `  ${file}`),
        "Run `pnpm brand:generate` and commit the generated assets.",
      ].join("\n"),
    );
  }

  if (checkOnly) console.log("[brand] generated assets match the canonical SVG");
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : error);
  process.exit(1);
});
