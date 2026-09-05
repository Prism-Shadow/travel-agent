/** Flat welcome illustration built around the canonical Route Penguin, with no new silhouette. */
export function WelcomePenguin() {
  return (
    <svg
      viewBox="0 0 288 256"
      aria-hidden="true"
      focusable="false"
      data-testid="welcome-penguin"
      className="pointer-events-none mb-2 h-32 w-36 shrink-0 select-none sm:h-36 sm:w-40"
    >
      <circle cx="144" cy="118" r="85" className="fill-[#edf3ff] dark:fill-[#637da4]" />
      <path
        d="M57 150C34 114 56 56 104 42"
        fill="none"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeDasharray="2 7"
        className="stroke-[#b5c9ef] dark:stroke-[#526c9b]"
      />
      <circle cx="105" cy="42" r="3" className="fill-[#acc5f6] dark:fill-[#688ad0]" />
      <path
        d="M226 63v12m-6-6h12M52 172v8m-4-4h8"
        fill="none"
        strokeWidth="2"
        strokeLinecap="round"
        className="stroke-[#80a6f0] dark:stroke-[#87aaf1]"
      />
      <circle cx="238" cy="157" r="2.5" className="fill-[#b5c9ef] dark:fill-[#688ad0]" />
      <image href="/travel-agent-penguin.svg" x="16" y="-4" width="256" height="256" />
    </svg>
  );
}
