import { app } from "electron";

const isNativeHost = process.argv.includes("--travel-browser-native-host");
// Do this before any asynchronous imports or app readiness: hiding the Dock later still bounces.
if (isNativeHost && process.platform === "darwin") app.setActivationPolicy("prohibited");

async function bootEntry(): Promise<void> {
  /** Select a fixed entry before importing the application or acquiring its single-instance lock. */
  if (isNativeHost) {
    const { runNativeHost } = await import("./native-host.js");
    try {
      await runNativeHost();
      process.exit(0);
    } catch {
      process.stderr.write("Travel Browser connection helper failed\n");
      process.exit(1);
    }
  } else if (process.argv.includes("--unregister-travel-browser-host")) {
    const { DISCOVERY_BASE_DIR } = await import("penguin-browser/dist/relay/relay-discovery.js");
    const { unregisterNativeHost } = await import("./native-host-registration.js");
    unregisterNativeHost({
      executable: process.execPath,
      baseDir: DISCOVERY_BASE_DIR,
      ...(app.isPackaged ? {} : { appPath: app.getAppPath() }),
    });
    process.exit(0);
  } else {
    await import("./main.js");
  }
}
void bootEntry().catch(() => {
  process.stderr.write("Travel Agent failed to start\n");
  process.exit(1);
});
