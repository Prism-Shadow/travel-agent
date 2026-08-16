/**
 * electron-builder `afterPack` hook: flip the security fuses into the packaged binary.
 *
 * Fuses (design/002 §11.2) are bits baked into the Electron binary that it reads at startup and
 * that no command-line switch can override. Flipping `RunAsNode` and the inspector fuses off is
 * what stops a packaged app from being relaunched as a bare Node process or reopened with
 * `--inspect` — the same session-theft threat as a leaked `--remote-debugging-port`, by a route the
 * source scanner cannot see. This runs once per packaged arch, right after electron-builder lays
 * the app out and before it is signed.
 *
 * The desired state is {@link EXPECTED_FUSES}; this maps it onto `@electron/fuses` and applies it.
 * `resetAdHocDarwinSignature` is set so the macOS binary is re-signed after the bytes change —
 * without it the later notarization step would reject an app whose signature no longer matches.
 */
import path from "node:path";
import { flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";

import { EXPECTED_FUSES } from "./security-guards.mjs";

/** EXPECTED_FUSES key → the `@electron/fuses` option enum member. */
const OPTION_FOR = {
  runAsNode: FuseV1Options.RunAsNode,
  enableCookieEncryption: FuseV1Options.EnableCookieEncryption,
  enableNodeOptionsEnvironmentVariable: FuseV1Options.EnableNodeOptionsEnvironmentVariable,
  enableNodeCliInspectArguments: FuseV1Options.EnableNodeCliInspectArguments,
  enableEmbeddedAsarIntegrityValidation: FuseV1Options.EnableEmbeddedAsarIntegrityValidation,
  onlyLoadAppFromAsar: FuseV1Options.OnlyLoadAppFromAsar,
};

/** The path to the actual Electron binary inside the packed output, per platform. */
function electronBinaryPath(context) {
  const productName = context.packager.appInfo.productFilename;
  switch (context.electronPlatformName) {
    case "darwin":
      return path.join(context.appOutDir, `${productName}.app`);
    case "win32":
      return path.join(context.appOutDir, `${productName}.exe`);
    default:
      return path.join(context.appOutDir, productName);
  }
}

export default async function afterPack(context) {
  const binary = electronBinaryPath(context);
  const config = {
    version: FuseVersion.V1,
    resetAdHocDarwinSignature: context.electronPlatformName === "darwin",
  };
  for (const [name, value] of Object.entries(EXPECTED_FUSES)) {
    const option = OPTION_FOR[name];
    if (option === undefined) continue;
    config[option] = value;
  }
  await flipFuses(binary, config);
  process.stdout.write(
    `[fuses] applied to ${path.basename(binary)} (${context.electronPlatformName})\n`,
  );
}
