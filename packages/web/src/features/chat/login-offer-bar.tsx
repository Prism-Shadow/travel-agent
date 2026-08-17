/**
 * "Sign in as youhai@example.com" — the one control that uses an imported password.
 *
 * It is a **button the person presses**, and that is the entire security model of the feature. The
 * agent has no equivalent: no tool, no relay command, nothing in `login-service.ts` that a model can
 * reach. A saved password is used when the user says so, on the page they are looking at, or not at
 * all. An agent that hits a sign-in wall stops and hands over, which is what design/002 already
 * expects of it.
 *
 * The bar draws only when the page actually has a sign-in form *and* something is stored for its
 * origin. Both halves matter: a permanent "passwords" affordance would be noise on every page, and
 * one that appeared without a form would be an offer that cannot be honoured.
 *
 * Filling does not submit. A single click that both filled and signed in would turn one gesture
 * into an authentication attempt the person had not separately agreed to — and a stale saved
 * password would burn an attempt against a lockout counter without anyone choosing to.
 */
import { useEffect, useState } from "react";
import type { DesktopLoginOffer, DesktopTabState } from "../../lib/desktop-bridge";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import { S } from "../../lib/strings";
import { toastError, toastSuccess } from "../../components/ui/toast";

export function LoginOfferBar({ tab }: { tab: DesktopTabState | null }): React.ReactElement | null {
  const [offers, setOffers] = useState<DesktopLoginOffer[]>([]);
  const [busy, setBusy] = useState(false);
  /** Dismissed for this page, so the bar can be got rid of without signing in. */
  const [dismissedFor, setDismissedFor] = useState<string | null>(null);

  const tabId = tab?.id ?? null;
  const url = tab?.url ?? "";
  const loading = tab?.loading ?? false;

  useEffect(() => {
    // Asked once the page has settled: a form detected mid-load is one that may not be the final
    // DOM, and re-asking on every progress event would run the detector dozens of times a page.
    if (tabId === null || url === "" || loading) {
      setOffers([]);
      return;
    }
    let cancelled = false;
    void desktopBrowserBridge()
      ?.loginOffers(tabId)
      .then((answer) => {
        if (cancelled) return;
        setOffers(answer.formPresent ? answer.offers : []);
      })
      .catch(() => {
        // No offer is the ordinary case on almost every page; a failure to look is not worth
        // interrupting somebody's browsing for.
        if (!cancelled) setOffers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [tabId, url, loading]);

  // Dismissal is per page, not per tab: navigating on is a new decision.
  useEffect(() => setDismissedFor(null), [url]);

  if (tabId === null || offers.length === 0 || dismissedFor === url) return null;

  const fill = async (offer: DesktopLoginOffer): Promise<void> => {
    setBusy(true);
    try {
      const result = await desktopBrowserBridge()?.loginFill({
        tabId,
        credentialId: offer.id,
      });
      if (result === undefined) return;
      if (result.ok) {
        setDismissedFor(url);
        toastSuccess(S.chat.browserPane.logins.filled(result.username));
      } else {
        toastError(result.reason);
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      data-testid="iab-login-offer"
      className="flex flex-wrap items-center gap-2 border-b border-gray-200 bg-blue-50/60 px-2 py-1 dark:border-gray-800 dark:bg-gray-800/60"
    >
      <span className="text-[11px] text-gray-600 dark:text-gray-300">
        {S.chat.browserPane.logins.prompt}
      </span>
      {offers.map((offer) => (
        <button
          key={offer.id}
          type="button"
          disabled={busy}
          data-testid="iab-login-fill"
          onClick={() => void fill(offer)}
          className="rounded border border-blue-300 bg-white px-2 py-0.5 text-[11px] text-blue-700 hover:bg-blue-100 disabled:opacity-50 dark:border-blue-500 dark:bg-gray-900 dark:text-blue-300 dark:hover:bg-gray-800"
        >
          {offer.username === ""
            ? S.chat.browserPane.logins.fillNoUsername
            : S.chat.browserPane.logins.fillAs(offer.username)}
        </button>
      ))}
      <button
        type="button"
        className="ml-auto rounded px-1.5 py-0.5 text-[11px] text-gray-500 hover:bg-gray-200 dark:text-gray-400 dark:hover:bg-gray-700"
        aria-label={S.chat.browserPane.logins.dismiss}
        onClick={() => setDismissedFor(url)}
      >
        ✕
      </button>
      {/* Says what pressing the button does *not* do, next to the button that does it. */}
      <span className="w-full text-[10px] text-gray-500 dark:text-gray-400">
        {S.chat.browserPane.logins.noSubmit}
      </span>
    </div>
  );
}
