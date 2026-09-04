/**
 * Travel Agent brand mark. The public SVG is generated from
 * assets/brand/travel-agent-logo.svg and also serves as the favicon and
 * notification icon. Purely decorative, so screen readers use the nearby
 * product name instead.
 */
export function TravelAgentLogo({ className }: { className?: string }) {
  return (
    <img
      src="/travel-agent-logo.svg"
      alt=""
      aria-hidden
      draggable={false}
      className={`select-none ${className ?? "h-9 w-9 rounded-lg"}`}
    />
  );
}
