/**
 * Offering a saved login for the page the user is looking at, and typing it in when they ask.
 *
 * Three rules define this file, and the first is the one everything else exists to protect.
 *
 * **1. The agent cannot reach this.** There is no tool, no relay command, and no CDP path that
 * triggers a login fill. The only entry points are two IPC channels reachable from the application
 * window, which is a surface the user drives. This is a deliberate non-feature: an agent that could
 * say "sign in to ctrip.com" would be an agent that can use the person's credentials at will, and
 * the credential store was built specifically so that no model-visible path to a password exists
 * (see `credential-store.ts`). An agent that hits a login wall stops and the person signs in — which
 * is the handover the design already expects, not a gap.
 *
 * **2. The origin comes from the tab, never from the caller.** `offersFor` and `fill` both take a
 * `targetId` and ask the *pane* what URL that tab is on. A renderer that supplied an origin could
 * ask for `https://bank.example`'s password while the user sat on an attacker's page.
 *
 * **3. A credential is re-checked against the live origin at the moment of the fill.** The renderer
 * picks by id, and `fill` refuses if that credential's origin is not the origin the tab is on right
 * now. Without it, a page that navigated between the offer being drawn and the button being clicked
 * would receive a password chosen for somewhere else — and a navigation is not a rare event on a
 * sign-in page, it is what happens when one succeeds.
 */
import type { CredentialStore, CredentialSummary } from "./credential-store.js";
import { normalizeOrigin } from "./credential-store.js";
import { DETECT_LOGIN_FORM, FILL_LOGIN_FORM } from "./login-forms.js";
import type { LoginFillReport, LoginFormShape } from "./login-forms.js";

/** Runs a function declaration in a tab's isolated world. Implemented by `DebuggerFillPort`. */
export interface IsolatedWorldPort {
  evaluate<T>(input: { targetId: string; declaration: string; args: unknown[] }): Promise<T | null>;
}

/** What the pane knows about a tab. Kept narrow so this module cannot reach into the pane. */
export interface TabUrlSource {
  urlOf(targetId: string): string | null;
}

/** One saved login the user may click. Never carries the password. */
export interface LoginOffer {
  id: string;
  username: string;
  origin: string;
}

export interface LoginOffers {
  /** Whether the page actually has a sign-in form. No form, no offers, whatever is stored. */
  formPresent: boolean;
  offers: LoginOffer[];
  /** Set when nothing can be offered for a reason worth showing. */
  unavailable: string | null;
}

export type LoginFillResult =
  { ok: true; username: string; wroteUsername: boolean } | { ok: false; reason: string };

export interface LoginServiceOptions {
  credentials: () => Promise<CredentialStore | null>;
  world: IsolatedWorldPort;
  tabs: TabUrlSource;
  /** Where a refusal is recorded. Never receives a password. */
  log?: (message: string) => void;
}

export class LoginService {
  constructor(private readonly options: LoginServiceOptions) {}

  private log(message: string): void {
    this.options.log?.(message);
  }

  /**
   * What could be filled on this tab right now.
   *
   * Answers `formPresent: false` rather than an error when the page has no sign-in form: "there is
   * nothing to fill here" is the ordinary case on almost every page, and the pane draws nothing.
   */
  async offersFor(targetId: string): Promise<LoginOffers> {
    const url = this.options.tabs.urlOf(targetId);
    if (url === null) return { formPresent: false, offers: [], unavailable: null };

    const shape = await this.options.world.evaluate<LoginFormShape>({
      targetId,
      declaration: DETECT_LOGIN_FORM,
      args: [],
    });
    if (shape?.found !== true) return { formPresent: false, offers: [], unavailable: null };

    const store = await this.options.credentials();
    if (store === null) {
      return {
        formPresent: true,
        offers: [],
        unavailable: "Saved logins need encrypted storage, which this machine does not offer.",
      };
    }

    // The origin the *tab* is on. Not one the caller named.
    const origin = normalizeOrigin(url);
    let matching: CredentialSummary[];
    try {
      matching = store.forOrigin(origin);
    } catch (error) {
      this.log(`could not read saved logins: ${(error as Error).message}`);
      return { formPresent: true, offers: [], unavailable: "The saved-logins store is locked." };
    }

    return {
      formPresent: true,
      offers: matching.map((entry) => ({
        id: entry.id,
        username: entry.username,
        origin: entry.origin,
      })),
      unavailable: null,
    };
  }

  /**
   * Types one saved login into the tab's sign-in form.
   *
   * The plaintext exists inside `useForFill`'s callback and nowhere else: it is handed to the
   * isolated-world script and the store wipes the buffer as the callback returns. It is never
   * logged, never returned from this method, and never part of an error message.
   *
   * Does not submit. See `FILL_LOGIN_FORM` for why.
   */
  async fill(input: { targetId: string; credentialId: string }): Promise<LoginFillResult> {
    const url = this.options.tabs.urlOf(input.targetId);
    if (url === null) return { ok: false, reason: "That tab is no longer open." };

    const store = await this.options.credentials();
    if (store === null) return { ok: false, reason: "There are no saved logins on this machine." };

    const origin = normalizeOrigin(url);
    const candidate = store.forOrigin(origin).find((entry) => entry.id === input.credentialId);
    if (candidate === undefined) {
      // Either the id is not one we hold, or — the case this really guards — the page navigated
      // between the offer being drawn and the click, and this credential belongs somewhere else.
      this.log(`refused a login fill: no saved login for ${origin} with that id`);
      return {
        ok: false,
        reason: "That saved login is not for the page this tab is on now.",
      };
    }

    // The async variant, because the buffers must stay live until the write has actually happened;
    // the synchronous one wipes when the callback *returns the promise*.
    const outcome = await store.useForFillAsync(candidate.id, (password) =>
      this.options.world.evaluate<LoginFillReport>({
        targetId: input.targetId,
        declaration: FILL_LOGIN_FORM,
        args: [candidate.username, password],
      }),
    );

    if (outcome?.filled !== true) {
      return {
        ok: false,
        reason:
          "The sign-in form did not accept the value. Some sites use a custom control that " +
          "ignores a direct write; it can still be typed by hand.",
      };
    }
    return {
      ok: true,
      username: candidate.username,
      wroteUsername: outcome.wroteUsername === true,
    };
  }
}
