/**
 * Finding a sign-in form on a page, and typing a saved login into it.
 *
 * **Detection and filling are one isolated-world call each, and neither passes a selector across a
 * process boundary.** The obvious design — detect, return `#username` and `#password`, then fill
 * those selectors later — has two problems this avoids. A selector is fragile against a page that
 * re-renders between the two calls, and, more seriously, a selector arriving from outside is a
 * *request to type a password into whatever it matches*. Here the fill script finds the fields
 * itself, in the same call that writes them, so there is nothing to substitute.
 *
 * The scripts run in an isolated world (see `debugger-fill-port.ts` for why): the page's own
 * JavaScript cannot see the write path, though it can of course read the DOM afterwards. That
 * residual is the same one recorded for vault fills, and it is why a saved password
 * is treated as L2 rather than as something the page can never learn.
 *
 * What is deliberately *not* here: any way for the agent to ask for this. See `login-service.ts`.
 */

/**
 * Finds a sign-in form and reports what it looks like, without touching it.
 *
 * The heuristic is the one every password manager uses, because it is the one that matches how
 * sign-in forms are actually built:
 *
 *   - a **visible** `input[type=password]` is the anchor — everything else is found relative to it;
 *   - the account field is the nearest preceding text/email/tel input **inside the same form**,
 *     which is what "username above password" means structurally;
 *   - a hidden or zero-sized password input is skipped, because sites keep decoys and
 *     already-submitted forms in the DOM and filling one types into nothing the user can see.
 *
 * A registration form matches this shape too. That is accepted rather than fought: the fill is
 * user-initiated, so the worst case is the person filling their own saved login into a page where
 * they meant to make a new account, which they can see and undo.
 */
export const DETECT_LOGIN_FORM = `
function () {
  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }
  const passwords = Array.from(document.querySelectorAll("input[type=password]")).filter(visible);
  if (passwords.length === 0) return { found: false };
  const password = passwords[0];
  const scope = password.form || document;
  const candidates = Array.from(
    scope.querySelectorAll("input[type=text], input[type=email], input[type=tel], input:not([type])")
  ).filter(visible);
  // The account field is the last candidate that appears before the password in document order.
  let username = null;
  for (const candidate of candidates) {
    const position = candidate.compareDocumentPosition(password);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) username = candidate;
  }
  return {
    found: true,
    hasUsernameField: username !== null,
    // Purely for the affordance's label; never a value, and never sent to a model.
    usernameLabel: username ? (username.getAttribute("aria-label") || username.name || "") : "",
    passwordCount: passwords.length,
  };
}`;

/**
 * Types one saved login into the form this finds.
 *
 * Takes the values, finds the fields itself, and reports what it wrote — never what the values
 * were. It deliberately does **not** submit: a fill that also pressed the button would turn one
 * click on "sign in as youhai" into an authentication attempt the person had not separately agreed
 * to, and a wrong saved password would burn a login attempt against a lockout counter.
 *
 * The native-setter dance and the two events are the same workaround `debugger-fill-port.ts`
 * documents: React ignores a bare `element.value =` assignment.
 */
export const FILL_LOGIN_FORM = `
function (username, password) {
  function visible(element) {
    if (!element) return false;
    const rect = element.getBoundingClientRect();
    if (rect.width < 2 || rect.height < 2) return false;
    const style = window.getComputedStyle(element);
    return style.visibility !== "hidden" && style.display !== "none" && style.opacity !== "0";
  }
  function write(element, value) {
    if (!element) return false;
    const proto = element instanceof HTMLTextAreaElement
      ? HTMLTextAreaElement.prototype
      : HTMLInputElement.prototype;
    const setter = Object.getOwnPropertyDescriptor(proto, "value")?.set;
    if (setter) setter.call(element, value); else element.value = value;
    element.dispatchEvent(new Event("input", { bubbles: true }));
    element.dispatchEvent(new Event("change", { bubbles: true }));
    return true;
  }
  const passwords = Array.from(document.querySelectorAll("input[type=password]")).filter(visible);
  if (passwords.length === 0) return { filled: false, reason: "no_password_field" };
  const passwordField = passwords[0];
  const scope = passwordField.form || document;
  const candidates = Array.from(
    scope.querySelectorAll("input[type=text], input[type=email], input[type=tel], input:not([type])")
  ).filter(visible);
  let usernameField = null;
  for (const candidate of candidates) {
    const position = candidate.compareDocumentPosition(passwordField);
    if (position & Node.DOCUMENT_POSITION_FOLLOWING) usernameField = candidate;
  }
  const wroteUsername = username ? write(usernameField, username) : false;
  const wrotePassword = write(passwordField, password);
  const rect = passwordField.getBoundingClientRect();
  return {
    filled: wrotePassword,
    wroteUsername: wroteUsername,
    box: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
  };
}`;

/** What detection saw. Carries no values — only shape. */
export interface LoginFormShape {
  found: boolean;
  hasUsernameField?: boolean;
  usernameLabel?: string;
  passwordCount?: number;
}

export interface LoginFillReport {
  filled: boolean;
  wroteUsername?: boolean;
  reason?: string;
  box?: { x: number; y: number; width: number; height: number };
}
