/**
 * What has been typed into a page that must not come back out of it (design/003 §6.5).
 *
 * Once the main process fills an identity number into a form, that value exists in a DOM the agent
 * can read. §1.3 is blunt that this cannot be prevented — a page can echo a value anywhere, and an
 * agent with a CDP channel can read the page. So the defence is layered and honest about its
 * layers:
 *
 * | Output | Handled by | Strength |
 * | --- | --- | --- |
 * | DOM / HTML / Markdown / ARIA snapshot | **fingerprint match**, replacing the text | strong, exact |
 * | screenshot | **pixel mask** over registered bounding boxes | strong, but only where a box is known |
 * | the same value re-displayed somewhere else | DOM search, then OCR | **weak — no guarantee** |
 *
 * The registry holds **fingerprints, never values**. Main computes `HMAC(sessionSalt, value)` and
 * publishes the first bytes of it along with the value's length and a coarse character shape; the
 * relay can then test a candidate substring for equality without ever being told what it is looking
 * for. That is what lets redaction happen in the relay process — which is the one that renders the
 * snapshot — while the value stays in main.
 *
 * The shape and length are what make the scan affordable: a text node is only hashed at token
 * boundaries, only for windows of exactly the right length, and only where the character classes
 * line up. Without that pruning, redacting a long page would mean hashing every substring of it.
 */
import { createHmac, randomBytes } from "node:crypto";

/** Where a value sits on screen, in CSS pixels relative to the viewport. */
export interface BoundingBox {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * What the relay is told about one sensitive value.
 *
 * Everything here is safe to send over the relay's own channel and to keep in its memory: none of
 * it can be turned back into the value, and the fingerprint is salted per session so it cannot be
 * compared against a precomputed table of common values either.
 */
export interface SensitiveFingerprint {
  /** Stable id for this registration, so it can be cleared when the field is cleared. */
  id: string;
  /** The field's *name* — `id_number`. Used in the replacement text, `[REDACTED:id_number]`. */
  field: string;
  /** Truncated HMAC of the value under this session's salt. */
  fingerprint: string;
  /** Exact character length of the value, so only equal-length windows are hashed. */
  length: number;
  /**
   * Coarse character classes, one per position: `d` digit, `a` letter, `s` space, `.` other.
   * A cheap pre-filter — a window whose shape differs cannot be the value.
   */
  shape: string;
}

/** A registration, as main holds it. The value itself is never stored — only its fingerprint. */
export interface SensitiveElement extends SensitiveFingerprint {
  targetId: string;
  selector?: string;
  box?: BoundingBox;
  registeredAt: string;
  /** Set once the value is known to be gone from the page (proof of clearing, 003 §7.3). */
  clearedAt?: string;
}

export function shapeOf(value: string): string {
  let out = "";
  for (const char of value) {
    if (/\d/.test(char)) out += "d";
    else if (/\s/.test(char)) out += "s";
    else if (/[A-Za-z一-鿿]/.test(char)) out += "a";
    else out += ".";
  }
  return out;
}

/** How many hex characters of the HMAC are published. 128 bits: collisions are not a concern. */
const FINGERPRINT_CHARS = 32;

export function fingerprintOf(salt: Buffer, value: string): string {
  return createHmac("sha256", salt).update(value, "utf8").digest("hex").slice(0, FINGERPRINT_CHARS);
}

/**
 * The sensitive values of one browsing session.
 *
 * Per session because the salt is: two sessions holding the same value produce different
 * fingerprints, so nothing can be correlated between them, and a fingerprint that leaks is useless
 * anywhere else.
 */
export class SensitiveElementRegistry {
  private readonly salt = randomBytes(32);
  private readonly elements = new Map<string, SensitiveElement>();
  private counter = 0;
  private readonly now: () => Date;

  constructor(options: { now?: () => Date } = {}) {
    this.now = options.now ?? (() => new Date());
  }

  /**
   * Registers a value that has just been written into the page.
   *
   * Takes the plaintext and keeps none of it: the fingerprint, the length and the shape are all
   * that survive the call.
   */
  register(input: {
    field: string;
    value: string;
    targetId: string;
    selector?: string;
    box?: BoundingBox;
  }): SensitiveElement {
    this.counter += 1;
    const element: SensitiveElement = {
      id: `se-${this.counter}`,
      field: input.field,
      fingerprint: fingerprintOf(this.salt, input.value),
      length: [...input.value].length,
      shape: shapeOf(input.value),
      targetId: input.targetId,
      registeredAt: this.now().toISOString(),
      ...(input.selector ? { selector: input.selector } : {}),
      ...(input.box ? { box: input.box } : {}),
    };
    this.elements.set(element.id, element);
    return element;
  }

  /** Updates where a registered value is drawn, so the screenshot mask can cover it. */
  locate(id: string, box: BoundingBox): void {
    const element = this.elements.get(id);
    if (element) element.box = box;
  }

  /** Marks a value as gone from the page. Only a proof should call this (003 §7.3 exit (a)). */
  markCleared(id: string): void {
    const element = this.elements.get(id);
    if (element) element.clearedAt = this.now().toISOString();
  }

  /** Everything still believed to be on screen, for the redaction the relay applies. */
  live(targetId?: string): SensitiveElement[] {
    return [...this.elements.values()].filter(
      (element) => !element.clearedAt && (targetId === undefined || element.targetId === targetId),
    );
  }

  all(): SensitiveElement[] {
    return [...this.elements.values()];
  }

  /** What the relay is told: fingerprints, lengths and shapes. No boxes, no selectors, no values. */
  publish(targetId?: string): SensitiveFingerprint[] {
    return this.live(targetId).map(({ id, field, fingerprint, length, shape }) => ({
      id,
      field,
      fingerprint,
      length,
      shape,
    }));
  }

  /** The boxes a screenshot must cover, and whether any live value has no box to cover it. */
  maskPlan(targetId: string): { boxes: BoundingBox[]; unlocated: string[] } {
    const boxes: BoundingBox[] = [];
    const unlocated: string[] = [];
    for (const element of this.live(targetId)) {
      if (element.box) boxes.push(element.box);
      else unlocated.push(element.field);
    }
    return { boxes, unlocated };
  }

  forgetTarget(targetId: string): void {
    for (const [id, element] of this.elements) {
      if (element.targetId === targetId) this.elements.delete(id);
    }
  }

  clear(): void {
    this.elements.clear();
  }

  /** Tests a candidate string against a fingerprint. Used by the relay-side matcher's tests. */
  matches(element: SensitiveFingerprint, candidate: string): boolean {
    if ([...candidate].length !== element.length) return false;
    if (shapeOf(candidate) !== element.shape) return false;
    return fingerprintOf(this.salt, candidate) === element.fingerprint;
  }
}
