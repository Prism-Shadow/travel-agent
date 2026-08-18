/**
 * iOS-style toggle switch: a `button` with `role="switch"` + `aria-checked` (a native
 * button is keyboard-operable out of the box — Space/Enter activate it — and is labelable
 * content, so clicking an enclosing `<label>`'s text toggles it too). Sliding knob with an
 * ease-out color/transform transition; the on-state follows the theme accent variable (same
 * source as Button primary), the off-state is gray.
 *
 * Geometry (all integer pixels): a 16px knob in the 36x20px track, inset 2px on every side
 * in both states (travel 2px -> 18px), and at either end concentric with the track's
 * end-cap circle (center 10px in from the edge), so the gap along the arcs matches the
 * straight runs. The track draws a 1px inset hairline; the knob's hairline is a *border* —
 * inside its own 16px — not an outer ring: an outer ring would fill the gap on the near arc
 * and stack on the track hairline as one heavier line, reading as unequal spacing. Net
 * clearance between knob edge and outline is thus a uniform 1px all around. No offset
 * shadow (it reads as vertical asymmetry at this size); the hairlines keep the edges
 * defined on any surface (the dark neutral accent is near-white, where the white knob would
 * otherwise vanish); dark-mode aware; disabled dims and blocks. The focus ring is
 * accent-tinted and `focus-visible`-only, so keyboard focus shows it but a mouse click
 * doesn't leave a lingering halo. Sized for compact (sm) form rows, matching the dialogs'
 * controls.
 */
import type { ButtonHTMLAttributes } from "react";

export interface SwitchProps extends Omit<
  ButtonHTMLAttributes<HTMLButtonElement>,
  "onChange" | "type" | "role"
> {
  checked: boolean;
  onChange: (checked: boolean) => void;
  /** Compact form rows use the 32px track from the import-dialog design. */
  size?: "base" | "compact";
}

export function Switch({
  checked,
  onChange,
  disabled,
  size = "base",
  className,
  ...rest
}: SwitchProps) {
  const compact = size === "compact";
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={
        `relative inline-flex h-5 ${compact ? "w-8" : "w-9"} shrink-0 items-center rounded-full ` +
        "inset-ring inset-ring-black/10 dark:inset-ring-white/10 " +
        "transition-colors duration-200 ease-out " +
        "focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--accent-bg)]/40 " +
        "disabled:cursor-not-allowed disabled:opacity-60 " +
        (checked ? "bg-[var(--accent-bg)]" : "bg-gray-200 dark:bg-gray-700") +
        ` ${className ?? ""}`
      }
      {...rest}
    >
      <span
        aria-hidden
        className={`inline-block size-4 rounded-full border border-black/10 bg-white transition-transform duration-200 ease-out ${
          checked ? (compact ? "translate-x-3.5" : "translate-x-[18px]") : "translate-x-0.5"
        }`}
      />
    </button>
  );
}
