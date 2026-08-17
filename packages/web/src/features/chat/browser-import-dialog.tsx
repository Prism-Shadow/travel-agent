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
 *   - **The keychain prompt is announced before it appears.** On macOS the OS will ask for
 *     permission the moment Import is pressed; a prompt nobody predicted looks like something went
 *     wrong.
 *
 * The result is reported per kind, including partial reads. An import where 3,940 of 4,000 cookies
 * landed is a success with a footnote, and the footnote is shown.
 */
import { useEffect, useState } from "react";
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

const KIND_LABEL: Record<DesktopImportKind, string> = {
  passwords: S.chat.browserPane.import.passwords,
  cookies: S.chat.browserPane.import.cookies,
  history: S.chat.browserPane.import.history,
};

function messageOf(error: unknown, fallback: string): string {
  return error instanceof Error && error.message !== "" ? error.message : fallback;
}

/** How a source is named in the "From" row: `Google Chrome — youhai`. */
function sourceLabel(source: DesktopImportSource): string {
  return source.profileLabel === null
    ? source.browserLabel
    : `${source.browserLabel} — ${source.profileLabel}`;
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
        if (result.failure !== null) toastError(`${KIND_LABEL[result.kind]}: ${result.failure}`);
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
      footer={
        <>
          <Button onClick={onClose} disabled={busy}>
            {S.common.cancel}
          </Button>
          <Button
            variant="primary"
            disabled={!hydrated || busy || source === null || chosen.length === 0}
            onClick={() => void submit()}
          >
            {busy ? S.chat.browserPane.import.importing : S.chat.browserPane.import.submit}
          </Button>
        </>
      }
    >
      <div className="space-y-4">
        <p className="text-sm text-[var(--fg-muted)]">{S.chat.browserPane.import.subtitle}</p>

        {nothingToImport ? (
          <div className="space-y-1">
            <p className="text-sm font-medium">{S.chat.browserPane.import.noSources}</p>
            <p className="text-xs text-[var(--fg-muted)]">
              {S.chat.browserPane.import.noSourcesHint}
            </p>
          </div>
        ) : (
          <>
            <Select
              label={S.chat.browserPane.import.from}
              size="sm"
              value={sourceId}
              disabled={!hydrated || busy}
              onChange={(event) => setSourceId(event.target.value)}
            >
              {(report?.sources ?? []).map((entry) => (
                <option key={entry.id} value={entry.id}>
                  {sourceLabel(entry)}
                </option>
              ))}
            </Select>

            {/* The "close Chrome first" line. Shown only when one really is running, because a
                standing warning is one nobody reads. */}
            {hydrated && report.runningBrowsers.length > 0 && (
              <div className="rounded-md border border-[var(--warn-border,var(--border))] bg-[var(--warn-bg,transparent)] px-3 py-2">
                <p className="text-sm font-medium">
                  {S.chat.browserPane.import.closeFirst(report.runningBrowsers.join(" / "))}
                </p>
                <p className="mt-0.5 text-xs text-[var(--fg-muted)]">
                  {S.chat.browserPane.import.closeFirstWhy}
                </p>
              </div>
            )}

            <div className="space-y-3">
              {KINDS.map((kind) => {
                const blocked = blockedReason(kind);
                const count = source?.counts[kind];
                return (
                  <div key={kind} className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <div className="flex items-baseline gap-2">
                        <span className="text-sm font-medium">{KIND_LABEL[kind]}</span>
                        {/* The `65` beside "Saved passwords". Absent rather than zero when it
                            could not be counted — a wrong count is worse than none. */}
                        {blocked === null && typeof count === "number" && (
                          <span className="text-xs tabular-nums text-[var(--fg-muted)]">
                            {count}
                          </span>
                        )}
                      </div>
                      {blocked !== null && (
                        <p className="mt-0.5 text-xs text-[var(--fg-muted)]">{blocked}</p>
                      )}
                    </div>
                    <Switch
                      checked={blocked === null && selected.has(kind)}
                      disabled={!hydrated || busy || blocked !== null}
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

            <div className="space-y-1 border-t border-[var(--border)] pt-3">
              <p className="text-xs text-[var(--fg-muted)]">
                {S.chat.browserPane.import.cookiesLandIn}
              </p>
              {/* Announced before it appears: an unexplained system prompt reads as a fault. */}
              {usable.some((kind) => kind !== "history") && (
                <p className="text-xs text-[var(--fg-muted)]">
                  {S.chat.browserPane.import.keychainNotice}
                </p>
              )}
            </div>
          </>
        )}
      </div>
    </Modal>
  );
}
