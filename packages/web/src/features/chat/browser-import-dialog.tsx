/**
 * "Import from your browser" — bringing cookies, saved logins and history into the in-app browser.
 *
 * A form, not a live surface: nothing happens until Import. What the dialog is careful about is
 * saying true things before the user commits, because every one of them is a thing they cannot see
 * for themselves:
 *
 *   - **The counts come from main, and cost nothing sensitive.** Opening this dialog reads row
 *     counts out of the other browser's databases; it does not decrypt, so it never triggers the
 *     macOS keychain prompt. A dialog that decrypted the password database in order to *label a
 *     checkbox* would be doing the sensitive act before obtaining consent.
 *   - **A kind the profile does not have is shown disabled, with the reason** — not hidden. A
 *     missing checkbox reads as a missing feature; a disabled one with "this profile has none of
 *     this" reads as the fact it is.
 *   - **Passwords are refused outright on a machine with no encrypted storage**, and the checkbox
 *     says so. The alternative — importing them into a file this app cannot protect — is the
 *     failure mode 003 §4.4 exists to prevent.
 *   - **The keychain prompt stays associated with Import.** The compact design keeps the notice out
 *     of the visual layout, while assistive technology and the button tooltip still explain the
 *     macOS permission prompt before the sensitive action.
 *
 * The result is reported per kind, including partial reads. An import where 3,940 of 4,000 cookies
 * landed is a success with a follow-up toast.
 */
import { useEffect, useState } from "react";
import chromeLogo from "@browser-logos/chrome/chrome_24x24.png";
import { BrowsersIcon } from "@phosphor-icons/react/dist/csr/Browsers";
import { ClockCounterClockwiseIcon } from "@phosphor-icons/react/dist/csr/ClockCounterClockwise";
import { CookieIcon } from "@phosphor-icons/react/dist/csr/Cookie";
import { KeyIcon } from "@phosphor-icons/react/dist/csr/Key";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type {
  DesktopImportKind,
  DesktopImportSource,
  DesktopImportSources,
} from "../../lib/desktop-bridge";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import { S } from "../../lib/strings";
import { Button } from "../../components/ui/button";
import { Modal } from "../../components/ui/modal";
import { Select } from "../../components/ui/select";
import { Switch } from "../../components/ui/switch";
import { toastError, toastInfo, toastSuccess } from "../../components/ui/toast";

/** Listed in the order the dialog shows them. */
const KINDS: DesktopImportKind[] = ["passwords", "cookies", "history"];

/** Reads the live locale binding; a module-level object would freeze the default Chinese labels. */
export function browserImportKindLabel(kind: DesktopImportKind): string {
  return {
    passwords: S.chat.browserPane.import.passwords,
    cookies: S.chat.browserPane.import.cookies,
    history: S.chat.browserPane.import.history,
  }[kind];
}

const KIND_ICON = {
  passwords: KeyIcon,
  cookies: CookieIcon,
  history: ClockCounterClockwiseIcon,
} satisfies Record<DesktopImportKind, typeof KeyIcon>;

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** Real Chrome brand mark in the selected source; other supported Chromium browsers stay generic. */
function SourceIcon({ browserLabel }: { browserLabel: string }) {
  if (browserLabel === "Google Chrome") {
    return <img src={chromeLogo} alt="" aria-hidden className="size-4 shrink-0" />;
  }
  return <BrowsersIcon size={16} weight="regular" aria-hidden className="shrink-0 text-gray-500" />;
}

/** The compact two-tone source label used in both the control and its menu. */
function SourceLabel({ source }: { source: DesktopImportSource }) {
  return (
    <span className="flex min-w-0 items-center gap-2">
      <SourceIcon browserLabel={source.browserLabel} />
      <span className="truncate font-medium text-gray-900 dark:text-gray-100">
        {source.browserLabel}
      </span>
      {source.profileLabel !== null && (
        <span className="truncate text-gray-400 dark:text-gray-500">{source.profileLabel}</span>
      )}
    </span>
  );
}

export function BrowserImportDialog({ open, onClose }: { open: boolean; onClose: () => void }) {
  /** What main found. Null until it answers; the whole form stays disabled until then. */
  const [report, setReport] = useState<DesktopImportSources | null>(null);
  const [sourceId, setSourceId] = useState("");
  /** Which kinds are ticked. Cookies default on: it is the one that carries a sign-in. */
  const [selected, setSelected] = useState<Set<DesktopImportKind>>(new Set(["cookies"]));
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    let cancelled = false;
    setReport(null);
    setBusy(false);
    setSelected(new Set(["cookies"]));
    void desktopBrowserBridge()
      ?.importSources()
      .then((found) => {
        if (cancelled) return;
        setReport(found);
        setSourceId(found.sources[0]?.id ?? "");
      })
      .catch((error: unknown) => {
        // The form stays disabled; closing and reopening retries.
        if (!cancelled) toastError(messageOf(error, S.chat.browserPane.import.failed));
      });
    return () => {
      cancelled = true;
    };
  }, [open]);

  const source = report?.sources.find((entry) => entry.id === sourceId) ?? null;

  /** Why a kind cannot be ticked for this profile, or null when it can. */
  const blockedReason = (kind: DesktopImportKind): string | null => {
    if (source === null) return null;
    if (!source.available.includes(kind)) return S.chat.browserPane.import.kindMissing;
    if (kind === "passwords" && report?.credentialsAvailable === false) {
      return S.chat.browserPane.import.passwordsUnavailable;
    }
    return null;
  };

  const usable = KINDS.filter((kind) => blockedReason(kind) === null);
  const chosen = KINDS.filter((kind) => selected.has(kind) && blockedReason(kind) === null);
  const importNotice = [
    selected.has("cookies") ? S.chat.browserPane.import.cookiesLandIn : null,
    chosen.some((kind) => kind !== "history") ? S.chat.browserPane.import.keychainNotice : null,
  ]
    .filter((notice): notice is string => notice !== null)
    .join("\n");

  const submit = async (): Promise<void> => {
    if (source === null || chosen.length === 0) return;
    setBusy(true);
    try {
      const outcome = await desktopBrowserBridge()?.importFromBrowser({
        sourceId: source.id,
        kinds: chosen,
      });
      if (outcome === undefined) throw new Error(S.chat.browserPane.import.failed);

      // Every failed kind gets its own line: they fail for genuinely different reasons (a refused
      // keychain, an unreadable scheme, no encrypted storage) and one merged message would say
      // none of them.
      for (const result of outcome.results) {
        if (result.failure !== null) {
          toastError(`${browserImportKindLabel(result.kind)}: ${result.failure}`);
        }
      }
      const imported = outcome.results.reduce((total, result) => total + result.imported, 0);
      const skipped = outcome.results.reduce((total, result) => total + result.skipped, 0);

      if (!outcome.anythingImported) {
        if (outcome.results.every((result) => result.failure === null)) {
          toastInfo(S.chat.browserPane.import.doneNothing);
        }
        setBusy(false);
        return;
      }
      if (skipped > 0) toastInfo(S.chat.browserPane.import.partial(imported, skipped));
      else toastSuccess(S.chat.browserPane.import.done(imported));
      onClose();
    } catch (error) {
      toastError(messageOf(error, S.chat.browserPane.import.failed));
    } finally {
      setBusy(false);
    }
  };

  const hydrated = report !== null;
  const nothingToImport = hydrated && report.sources.length === 0;

  return (
    <Modal
      open={open}
      title={S.chat.browserPane.import.title}
      onClose={onClose}
      headerless
      widthClass="max-w-[380px]"
      overlayClassName="!items-center !p-4"
      panelClassName="!rounded-[18px] border-gray-200! !pb-0 shadow-2xl dark:!border-gray-800"
      contentClassName="!max-h-[calc(100vh-2rem)] !px-5 !py-6"
    >
      <div className="relative">
        <button
          type="button"
          aria-label={S.common.close}
          onClick={onClose}
          disabled={busy}
          className="absolute -right-1.5 -top-2 rounded-lg p-1.5 text-gray-600 transition-colors hover:bg-gray-100 hover:text-gray-900 disabled:opacity-50 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
        >
          <XIcon size={18} weight="regular" aria-hidden />
        </button>

        <h2 className="pr-8 text-xl leading-7 font-semibold tracking-[-0.02em] text-gray-950 dark:text-gray-50">
          {S.chat.browserPane.import.title}
        </h2>
        <p className="mt-1 text-sm leading-5 text-gray-400 dark:text-gray-500">
          {S.chat.browserPane.import.subtitle}
        </p>

        {nothingToImport ? (
          <div className="mt-5 rounded-[14px] border border-gray-200 px-4 py-5 dark:border-gray-800">
            <p className="text-sm font-medium text-gray-900 dark:text-gray-100">
              {S.chat.browserPane.import.noSources}
            </p>
            <p className="mt-1 text-xs leading-5 text-gray-500 dark:text-gray-400">
              {S.chat.browserPane.import.noSourcesHint}
            </p>
          </div>
        ) : (
          <>
            <div className="mt-3.5 flex items-center gap-3">
              <span
                id="browser-import-source-label"
                className="shrink-0 text-sm leading-7 text-gray-400 dark:text-gray-500"
              >
                {S.chat.browserPane.import.from}
              </span>
              <Select
                aria-labelledby="browser-import-source-label"
                size="sm"
                value={sourceId}
                disabled={!hydrated || busy}
                className="min-h-7! rounded-[10px]! border-gray-200! px-3! py-1! text-sm! leading-5! shadow-sm hover:border-gray-300! dark:border-gray-700!"
                onChange={(event) => setSourceId(event.target.value)}
              >
                {(report?.sources ?? []).map((entry) => (
                  <option key={entry.id} value={entry.id}>
                    <SourceLabel source={entry} />
                  </option>
                ))}
              </Select>
            </div>

            {/* The "close Chrome first" line. Shown only when one really is running, because a
                standing warning is one nobody reads. */}
            {hydrated && report.runningBrowsers.length > 0 && (
              <div className="mt-3.5">
                <p className="text-sm leading-5 text-gray-400 dark:text-gray-500">
                  {S.chat.browserPane.import.closeFirst(report.runningBrowsers.join(" / "))}
                </p>
                <p className="sr-only">{S.chat.browserPane.import.closeFirstWhy}</p>
              </div>
            )}

            <div
              className={`${hydrated && report.runningBrowsers.length > 0 ? "mt-1" : "mt-3.5"} overflow-hidden rounded-[14px] border border-gray-200 px-4 dark:border-gray-800`}
            >
              {KINDS.map((kind) => {
                const blocked = blockedReason(kind);
                const KindIcon = KIND_ICON[kind];
                return (
                  <div
                    key={kind}
                    className="flex min-h-11 items-center gap-3 border-b border-gray-100 py-2 last:border-b-0 dark:border-gray-800"
                  >
                    <KindIcon
                      size={20}
                      weight="regular"
                      aria-hidden
                      className="shrink-0 text-gray-500 dark:text-gray-400"
                    />
                    <div className="min-w-0 flex-1">
                      <span className="block text-sm leading-5 font-medium text-gray-900 dark:text-gray-100">
                        {browserImportKindLabel(kind)}
                      </span>
                      {blocked !== null && (
                        <p className="truncate text-[10px] leading-3.5 text-gray-400 dark:text-gray-500">
                          {blocked}
                        </p>
                      )}
                    </div>
                    <Switch
                      size="compact"
                      checked={blocked === null && selected.has(kind)}
                      disabled={!hydrated || busy || blocked !== null}
                      aria-label={browserImportKindLabel(kind)}
                      className="aria-checked:bg-[#3098f7]!"
                      onChange={(next) =>
                        setSelected((current) => {
                          const updated = new Set(current);
                          if (next) updated.add(kind);
                          else updated.delete(kind);
                          return updated;
                        })
                      }
                    />
                  </div>
                );
              })}
            </div>

            {/* The compact visual target omits the explanatory footnotes. They remain explicitly
                associated with Import for assistive technology and appear in its hover tooltip. */}
            <p id="browser-import-cookie-notice" className="sr-only">
              {S.chat.browserPane.import.cookiesLandIn}
            </p>
            {usable.some((kind) => kind !== "history") && (
              <p id="browser-import-keychain-notice" className="sr-only">
                {S.chat.browserPane.import.keychainNotice}
              </p>
            )}
          </>
        )}

        <div className="mt-3 flex justify-end gap-3">
          <Button
            onClick={onClose}
            disabled={busy}
            className="min-w-20! rounded-[10px]! border-transparent! bg-gray-100! px-4! py-1.5! text-sm! leading-5! font-normal! text-gray-900 hover:bg-gray-200! dark:bg-gray-800! dark:text-gray-100 dark:hover:bg-gray-700!"
          >
            {S.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!hydrated || busy || source === null || chosen.length === 0}
            onClick={() => void submit()}
            aria-describedby={
              importNotice === ""
                ? undefined
                : [
                    selected.has("cookies") ? "browser-import-cookie-notice" : null,
                    chosen.some((kind) => kind !== "history")
                      ? "browser-import-keychain-notice"
                      : null,
                  ]
                    .filter((id): id is string => id !== null)
                    .join(" ")
            }
            title={importNotice === "" ? undefined : importNotice}
            className="min-w-19.25! rounded-[10px]! border-gray-950! bg-gray-950! px-4! py-1.5! text-sm! leading-5! font-normal! text-white hover:opacity-90! dark:border-gray-100! dark:bg-gray-100! dark:text-gray-950!"
          >
            {busy ? S.chat.browserPane.import.importing : S.chat.browserPane.import.submit}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
