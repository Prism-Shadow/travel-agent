/**
 * Application menu. Electron's default menu cannot be extended, only replaced, so the
 * standard structure is rebuilt here. The custom entries are native-only shell actions:
 * installing the bundled `penguin` command and checking for desktop updates.
 */
import { app, Menu, shell } from "electron";
import type { MenuItemConstructorOptions } from "electron";
import { checkForUpdatesManually, updatesAvailableInThisForm } from "./updater.js";

export const INSTALL_CLI_MENU_LABEL = "Install CLI Commands…";

const CHECK_FOR_UPDATES_MENU_LABEL = "Check for Updates…";
const REPO_URL = "https://github.com/Youhai020616/travel-agent";

export const LOAD_EXTENSION_MENU_LABEL = "Load Penguin Browser Extension…";

export function installAppMenu(opts: {
  includeCliInstall: boolean;
  onInstallCli: () => void;
  onLoadExtension: () => void;
}): void {
  const isMac = process.platform === "darwin";
  const cliItems: MenuItemConstructorOptions[] = [
    { label: LOAD_EXTENSION_MENU_LABEL, click: opts.onLoadExtension },
    ...(opts.includeCliInstall
      ? [
          {
            label: INSTALL_CLI_MENU_LABEL,
            click: opts.onInstallCli,
          } satisfies MenuItemConstructorOptions,
        ]
      : []),
  ];
  const checkForUpdates: MenuItemConstructorOptions = {
    label: CHECK_FOR_UPDATES_MENU_LABEL,
    enabled: updatesAvailableInThisForm(),
    click: () => void checkForUpdatesManually(),
  };
  const projectOnGitHub: MenuItemConstructorOptions = {
    label: "Project on GitHub",
    click: () => void shell.openExternal(REPO_URL),
  };

  const template: MenuItemConstructorOptions[] = [];
  if (isMac) {
    template.push({
      label: app.name,
      submenu: [
        { role: "about" },
        { type: "separator" },
        ...cliItems,
        ...(cliItems.length > 0 ? ([{ type: "separator" }] as MenuItemConstructorOptions[]) : []),
        checkForUpdates,
        { type: "separator" },
        { role: "services" },
        { type: "separator" },
        { role: "hide" },
        { role: "hideOthers" },
        { role: "unhide" },
        { type: "separator" },
        { role: "quit" },
      ],
    });
  } else {
    template.push({
      label: "File",
      submenu: [
        ...cliItems,
        ...(cliItems.length > 0 ? ([{ type: "separator" }] as MenuItemConstructorOptions[]) : []),
        { role: "quit" },
      ],
    });
  }
  template.push(
    { role: "editMenu" },
    { role: "viewMenu" },
    { role: "windowMenu" },
    {
      role: "help",
      submenu: [
        ...(isMac ? [] : [checkForUpdates, { type: "separator" } as MenuItemConstructorOptions]),
        projectOnGitHub,
      ],
    },
  );
  Menu.setApplicationMenu(Menu.buildFromTemplate(template));
}
