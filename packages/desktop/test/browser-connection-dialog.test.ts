import fs from "node:fs";
import { afterEach, describe, expect, it, vi } from "vitest";
import { dialog } from "electron";
import type { BrowserWindow } from "electron";
import { revealBrowserExtensionStatus } from "../src/browser-relay.js";

vi.mock("electron", () => ({
  app: { isPackaged: false },
  dialog: { showMessageBox: vi.fn(async () => ({ response: 1 })) },
  shell: { openPath: vi.fn() },
  utilityProcess: {},
}));

afterEach(() => {
  vi.restoreAllMocks();
  vi.clearAllMocks();
});

function windowStub() {
  return { isDestroyed: () => false, webContents: { send: vi.fn() } };
}

function status(connected: boolean) {
  return new Response(JSON.stringify({ extensions: connected ? [{ browserKey: "chrome" }] : [] }));
}

describe("Chrome connection confirmation", () => {
  it("sends verified readiness to the renderer instead of showing a native message", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(status(true));
    const win = windowStub();
    await revealBrowserExtensionStatus(win as unknown as BrowserWindow, 45123);
    expect(win.webContents.send).toHaveBeenCalledExactlyOnceWith("iab:extension-ready");
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });

  it("retains the setup path when no Chrome extension is connected", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(status(false));
    vi.spyOn(fs, "existsSync").mockReturnValue(true);
    const win = windowStub();
    await revealBrowserExtensionStatus(win as unknown as BrowserWindow, 45123);
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).toHaveBeenCalledWith(
      win,
      expect.objectContaining({
        title: "Load the Travel Browser extension",
      }),
    );
  });

  it.each([true, false])(
    "ignores a delayed check after the selection changes (connected=%s)",
    async (connected) => {
      let finish!: (response: Response) => void;
      vi.spyOn(globalThis, "fetch").mockImplementation(
        () =>
          new Promise((resolve) => {
            finish = resolve;
          }),
      );
      const win = windowStub();
      let current = true;
      const pending = revealBrowserExtensionStatus(
        win as unknown as BrowserWindow,
        45123,
        () => current,
      );
      current = false;
      finish(status(connected));
      await pending;
      expect(win.webContents.send).not.toHaveBeenCalled();
      expect(dialog.showMessageBox).not.toHaveBeenCalled();
    },
  );

  it("ignores readiness after its window closes", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(status(true));
    const win = { ...windowStub(), isDestroyed: () => true };
    await revealBrowserExtensionStatus(win as unknown as BrowserWindow, 45123);
    expect(win.webContents.send).not.toHaveBeenCalled();
    expect(dialog.showMessageBox).not.toHaveBeenCalled();
  });
});
