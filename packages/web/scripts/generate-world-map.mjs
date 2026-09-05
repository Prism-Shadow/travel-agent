/** Run from the repository root: pnpm --filter @prismshadow/penguin-web map:generate. */
import { mkdir, writeFile } from "node:fs/promises";
import DottedMap from "dotted-map";
import { MAP_REGION } from "../src/lib/world-map-geometry.ts";

const map = new DottedMap({
  height: 72,
  grid: "diagonal",
  region: MAP_REGION,
  projection: { name: "equirectangular" },
});
// Fixed precision and one inherited fill keep the reusable local asset small.
const dots = map
  .getPoints()
  .map(({ x, y }) => `<circle cx="${Number(x.toFixed(2))}" cy="${Number(y.toFixed(2))}" r=".24"/>`)
  .join("");
const svg = `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${map.image.width} ${map.image.height}" fill="#8295b1">${dots}</svg>\n`;
await mkdir(new URL("../public/maps/", import.meta.url), { recursive: true });
await writeFile(new URL("../public/maps/world-dots.svg", import.meta.url), svg);
console.log(
  `Generated world-dots.svg: ${map.getPoints().length} dots, ${Buffer.byteLength(svg)} bytes.`,
);
