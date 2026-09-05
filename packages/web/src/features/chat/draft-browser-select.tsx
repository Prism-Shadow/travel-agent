import { useRef, useState } from "react";
import { BrowserIcon } from "@phosphor-icons/react/dist/csr/Browser";
import { GoogleChromeLogoIcon } from "@phosphor-icons/react/dist/csr/GoogleChromeLogo";
import { CaretDownIcon } from "@phosphor-icons/react/dist/csr/CaretDown";
import { CheckIcon } from "@phosphor-icons/react/dist/csr/Check";
import { WarningCircleIcon } from "@phosphor-icons/react/dist/csr/WarningCircle";
import { Dropdown } from "../../components/ui/dropdown";
import { toastError } from "../../components/ui/toast";
import { S } from "../../lib/strings";
import type { DesktopBackend } from "../../lib/desktop-bridge";
import type { BrowserPaneState } from "./use-browser-pane";
import { pillClass } from "./workspace-select";

/** The draft selects a browser without opening the native pane or creating a conversation. */
export function DraftBrowserSelect({
  state,
  disabled,
}: {
  state: BrowserPaneState;
  disabled: boolean;
}) {
  const [open, setOpen] = useState(false);
  const trigger = useRef<HTMLButtonElement>(null);
  const menu = useRef<HTMLDivElement>(null);
  const T = S.chat.browserPane;
  const pending = state.backendChanging || !state.scopeSettled;
  const locked = disabled || pending || state.backendLocked;
  const unavailable = state.backend === "extension" && !state.extensionBackendAvailable;
  const Icon = state.backend === "extension" ? GoogleChromeLogoIcon : BrowserIcon;
  const label = !state.scopeSettled
    ? T.loading
    : state.backend === "extension"
      ? T.choiceChrome
      : T.backendIab;

  const close = () => {
    setOpen(false);
    requestAnimationFrame(() => trigger.current?.focus());
  };
  const choose = async (backend: DesktopBackend) => {
    close();
    try {
      await state.actions.setBackend(backend);
    } catch (error) {
      const raw = error instanceof Error ? error.message : "";
      const detail = raw
        .replace(/^Error invoking remote method '[^']*':\s*/, "")
        .replace(/^Error:\s*/, "");
      toastError(detail || T.backendFailed);
    }
  };
  const focusOption = (last = false) => {
    requestAnimationFrame(() => {
      const options = menu.current?.querySelectorAll<HTMLButtonElement>(
        '[role="menuitemradio"]:not(:disabled)',
      );
      if (options?.length) options[last ? options.length - 1 : 0]?.focus();
    });
  };

  return (
    <Dropdown
      open={open}
      setOpen={setOpen}
      onEscape={close}
      portal={{ direction: "down", align: "left" }}
      menuClass="w-80 rounded-2xl p-1.5"
      button={
        <button
          ref={trigger}
          type="button"
          aria-label={T.chooseBrowser}
          aria-haspopup="menu"
          aria-expanded={open}
          aria-busy={state.backendChanging}
          data-testid="draft-browser-select"
          disabled={locked}
          title={
            state.backendLocked
              ? T.backendLocked
              : state.backendChanging
                ? T.choiceSaving
                : T.chooseBrowser
          }
          onClick={() => setOpen(!open)}
          onKeyDown={(event) => {
            if (event.key === "ArrowDown" || event.key === "ArrowUp") {
              event.preventDefault();
              setOpen(true);
              focusOption(event.key === "ArrowUp");
            }
          }}
          className={`${pillClass} pl-2.5 pr-2.5 disabled:cursor-wait disabled:opacity-60 ${unavailable ? "border-amber-300 text-amber-700 dark:border-amber-700 dark:text-amber-400" : ""}`}
        >
          <Icon size={15} aria-hidden />
          <span className="truncate">{label}</span>
          {unavailable && <WarningCircleIcon size={14} aria-label={T.choiceUnavailable} />}
          <CaretDownIcon size={12} aria-hidden />
        </button>
      }
    >
      <div
        ref={menu}
        role="menu"
        aria-label={T.chooseBrowser}
        onKeyDown={(event) => {
          if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
          event.preventDefault();
          const options = [
            ...event.currentTarget.querySelectorAll<HTMLButtonElement>(
              '[role="menuitemradio"]:not(:disabled)',
            ),
          ];
          if (!options.length) return;
          const current = options.indexOf(document.activeElement as HTMLButtonElement);
          const next =
            event.key === "Home"
              ? 0
              : event.key === "End"
                ? options.length - 1
                : (current + (event.key === "ArrowUp" ? -1 : 1) + options.length) % options.length;
          options[next]?.focus();
        }}
      >
        <p className="px-3 pb-2 pt-1.5 text-xs font-medium text-gray-500">{T.choiceTitle}</p>
        {(["iab", "extension"] as const).map((backend) => {
          const selected = state.scopeSettled && state.backend === backend;
          const unavailableOption = backend === "extension" && !state.extensionBackendAvailable;
          const OptionIcon = backend === "iab" ? BrowserIcon : GoogleChromeLogoIcon;
          return (
            <button
              key={backend}
              type="button"
              role="menuitemradio"
              aria-checked={selected}
              disabled={locked || unavailableOption}
              onClick={() => void choose(backend)}
              className={`flex w-full items-start gap-3 rounded-xl px-3 py-3 text-left transition-colors hover:bg-gray-100 disabled:cursor-not-allowed disabled:opacity-60 dark:hover:bg-gray-800 ${selected ? "bg-gray-100 dark:bg-gray-800" : ""}`}
            >
              <OptionIcon
                size={20}
                className="mt-0.5 shrink-0 text-gray-600 dark:text-gray-300"
                aria-hidden
              />
              <span className="min-w-0 flex-1">
                <span className="block text-sm font-medium text-gray-900 dark:text-gray-100">
                  {backend === "iab" ? T.backendIab : T.choiceChrome}
                  {unavailableOption && (
                    <span className="ml-2 text-xs font-normal text-amber-700 dark:text-amber-400">
                      {T.choiceUnavailable}
                    </span>
                  )}
                </span>
                <span className="mt-1 block text-xs leading-5 text-gray-500 dark:text-gray-400">
                  {unavailableOption
                    ? T.choiceUnavailableHint
                    : backend === "iab"
                      ? T.choiceIabHint
                      : T.choiceChromeHint}
                </span>
              </span>
              {selected && <CheckIcon size={16} className="mt-0.5 shrink-0" aria-hidden />}
            </button>
          );
        })}
        <p className="px-3 pb-2 pt-2.5 text-xs leading-5 text-gray-500 dark:text-gray-400">
          {T.choiceHint}
        </p>
      </div>
    </Dropdown>
  );
}
