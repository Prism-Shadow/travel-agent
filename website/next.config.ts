import type { NextConfig } from "next";
import { fileURLToPath } from "node:url";
import path from "node:path";

const nextConfig: NextConfig = {
  // This package sits inside the travel-agent monorepo with its own lockfile. Without an
  // explicit root, Next infers the repository root from the outer lockfile and traces files
  // from there; naming this directory keeps the build self-contained, as its workspace is.
  turbopack: { root: path.dirname(fileURLToPath(import.meta.url)) },
};

export default nextConfig;
