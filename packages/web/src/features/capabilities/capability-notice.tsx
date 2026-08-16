/**
 * The capability panel: what this build may do, and why the rest is off (design/004 §5).
 *
 * Rendered at the top of the Vault tab because that is where a person manages stored values — the
 * exact moment "the private profile vault cannot start on this machine" has to be visible rather
 * than inferable from an absent button. The denied state is the one this panel exists for: it
 * shows the server's own sentence, which was written for a person, and never rounds it down to a
 * disabled toggle.
 */
import { useEffect, useState } from "react";

import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import {
  capabilityRows,
  capabilitySummary,
  misconfigurationLines,
  type CapabilityReport,
} from "./capability-model";

export function CapabilityNotice(): React.ReactElement | null {
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let cancelled = false;
    api
      .getCapabilities()
      .then((fetched) => {
        if (!cancelled) setReport(fetched);
      })
      .catch(() => {
        if (!cancelled) setFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  if (failed || report === null) return null;

  const summary = capabilitySummary(report);
  const rows = capabilityRows(report);
  const misconfigured = misconfigurationLines(report);

  return (
    <section
      data-testid="capability-notice"
      className="rounded-lg border border-gray-200 p-3 text-sm dark:border-gray-800"
    >
      <h3 className="mb-1 font-medium text-gray-900 dark:text-gray-100">{S.capabilities.title}</h3>
      <p
        className={
          summary.tone === "warning"
            ? "mb-2 text-amber-700 dark:text-amber-400"
            : "mb-2 text-gray-600 dark:text-gray-400"
        }
      >
        {summary.text}
      </p>

      <ul className="space-y-1">
        {rows.map((row) => (
          <li key={row.flag} className="flex flex-col gap-0.5">
            <span className="flex items-center gap-2">
              <span
                aria-hidden
                className={
                  row.state === "on"
                    ? "h-2 w-2 rounded-full bg-emerald-500"
                    : row.state === "denied"
                      ? "h-2 w-2 rounded-full bg-amber-500"
                      : "h-2 w-2 rounded-full bg-gray-300 dark:bg-gray-700"
                }
              />
              <span className="text-gray-800 dark:text-gray-200">{row.label}</span>
              <span className="text-xs text-gray-500">
                {row.state === "on"
                  ? S.capabilities.on
                  : row.state === "denied"
                    ? S.capabilities.denied
                    : S.capabilities.off}
              </span>
            </span>
            {row.reason ? (
              <span className="pl-4 text-xs text-gray-600 dark:text-gray-400">{row.reason}</span>
            ) : null}
          </li>
        ))}
      </ul>

      {misconfigured.length > 0 ? (
        <div className="mt-2 border-t border-gray-200 pt-2 text-xs text-amber-700 dark:border-gray-800 dark:text-amber-400">
          {misconfigured.map((line) => (
            <p key={line}>{line}</p>
          ))}
        </div>
      ) : null}
    </section>
  );
}
