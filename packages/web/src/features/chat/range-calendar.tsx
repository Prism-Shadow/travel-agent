/**
 * Two-month range calendar for the When dialog.
 *
 * Built here rather than pulled in: the whole job is a month grid, a range, and two arrows, and
 * a date-picker dependency would bring a locale layer this app already has and a styling system
 * it does not use. `Intl` supplies the month and weekday names, so both catalogues come free.
 *
 * The range is picked in the order people say it: the first click sets the departure and clears
 * whatever return was there, the second sets the return. A second click *before* the departure
 * moves the departure instead of refusing — someone who realises they meant an earlier date
 * should not have to clear the field first. Hovering previews the range that a click would
 * produce, which is what makes a two-click interaction legible.
 *
 * Dates are `YYYY-MM-DD` strings throughout, never `Date` objects: the value is a calendar day,
 * and a Date carries a time and a zone that would shift it across midnight. All arithmetic is on
 * UTC noon for the same reason.
 */
import { useMemo, useState } from "react";
import { CaretLeftIcon } from "@phosphor-icons/react/dist/csr/CaretLeft";
import { CaretRightIcon } from "@phosphor-icons/react/dist/csr/CaretRight";
import { useLocale } from "../../state/locale";

/** `YYYY-MM-DD` for a UTC-noon date — the only representation that crosses this module's edges. */
function iso(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** UTC noon of a calendar day, so adding days can never land on a DST seam. */
function dayUTC(year: number, monthIndex: number, day: number): Date {
  return new Date(Date.UTC(year, monthIndex, day, 12));
}

function parseIso(value: string): Date | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const d = dayUTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isNaN(d.getTime()) ? null : d;
}

interface MonthGrid {
  year: number;
  monthIndex: number;
  label: string;
  /** Seven per row, `null` for the leading blanks before the 1st. */
  cells: Array<{ iso: string; day: number } | null>;
}

/** One month's grid, weeks starting Monday (the reference product's convention, and the CJK one). */
function buildMonth(year: number, monthIndex: number, locale: string): MonthGrid {
  const first = dayUTC(year, monthIndex, 1);
  const label = new Intl.DateTimeFormat(locale, {
    year: "numeric",
    month: "long",
    timeZone: "UTC",
  }).format(first);
  // getUTCDay is 0=Sunday; shift so Monday is 0.
  const lead = (first.getUTCDay() + 6) % 7;
  const daysInMonth = dayUTC(year, monthIndex + 1, 0).getUTCDate();
  const cells: MonthGrid["cells"] = Array.from({ length: lead }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    const d = dayUTC(year, monthIndex, day);
    cells.push({ iso: iso(d), day });
  }
  return { year, monthIndex, label, cells };
}

export function RangeCalendar({
  start,
  end,
  onChange,
}: {
  start: string;
  end: string;
  onChange: (next: { start: string; end: string }) => void;
}) {
  const { locale } = useLocale();
  const intlLocale = locale === "zh" ? "zh-CN" : "en-US";
  const today = useMemo(() => {
    const now = new Date();
    return dayUTC(now.getFullYear(), now.getMonth(), now.getDate());
  }, []);

  // The left-hand month. Opens on the month of an existing departure so an edit starts where the
  // answer already is, rather than back at today.
  const [cursor, setCursor] = useState(() => {
    const from = parseIso(start) ?? today;
    return { year: from.getUTCFullYear(), monthIndex: from.getUTCMonth() };
  });
  const [hover, setHover] = useState<string | null>(null);

  const months = [
    buildMonth(cursor.year, cursor.monthIndex, intlLocale),
    buildMonth(cursor.year, cursor.monthIndex + 1, intlLocale),
  ];
  const weekdays = useMemo(() => {
    const fmt = new Intl.DateTimeFormat(intlLocale, { weekday: "narrow", timeZone: "UTC" });
    // 2026-01-05 is a Monday; seven consecutive days give the header in this locale's own words.
    return Array.from({ length: 7 }, (_, i) => fmt.format(dayUTC(2026, 0, 5 + i)));
  }, [intlLocale]);

  const todayIso = iso(today);
  // While only a departure is set, the hovered day stands in for the return so the range the next
  // click would produce is visible before it happens.
  const previewEnd = end || (start && hover && hover > start ? hover : "");

  const pick = (value: string) => {
    // No departure yet, both already set, or a click before the departure: this click is the
    // departure. The last case is the one worth naming — it moves the start rather than refusing,
    // because "actually, from the 3rd" is a correction, not an error.
    if (!start || (start && end) || value < start) {
      onChange({ start: value, end: "" });
      return;
    }
    onChange({ start, end: value });
  };

  const shift = (delta: number) =>
    setCursor((c) => {
      const d = dayUTC(c.year, c.monthIndex + delta, 1);
      return { year: d.getUTCFullYear(), monthIndex: d.getUTCMonth() };
    });

  return (
    <div>
      <div className="grid gap-x-8 gap-y-4 sm:grid-cols-2">
        {months.map((m, monthIndex) => (
          <div key={`${m.year}-${m.monthIndex}`}>
            <div className="mb-2 grid grid-cols-[2.25rem_1fr_2.25rem] items-center">
              {monthIndex === 0 ? (
                <NavButton onClick={() => shift(-1)} label="←">
                  <CaretLeftIcon size={18} weight="bold" aria-hidden />
                </NavButton>
              ) : (
                <span />
              )}
              <p className="text-center text-base font-semibold text-gray-900 dark:text-gray-100">
                {m.label}
              </p>
              {monthIndex === months.length - 1 ? (
                <NavButton onClick={() => shift(1)} label="→">
                  <CaretRightIcon size={18} weight="bold" aria-hidden />
                </NavButton>
              ) : (
                <span />
              )}
            </div>
            <div className="grid grid-cols-7 gap-y-1">
              {weekdays.map((w, i) => (
                <span
                  // Narrow weekday names repeat in several locales (S, S / 一 … ), so the index is
                  // the only stable key here.
                  key={i}
                  className="pb-1 text-center text-xs font-medium text-gray-400 dark:text-gray-500"
                >
                  {w}
                </span>
              ))}
              {m.cells.map((cell, i) =>
                cell === null ? (
                  <span key={`b${i}`} />
                ) : (
                  <DayCell
                    key={cell.iso}
                    iso={cell.iso}
                    day={cell.day}
                    start={start}
                    end={previewEnd}
                    isToday={cell.iso === todayIso}
                    past={cell.iso < todayIso}
                    onPick={pick}
                    onHover={setHover}
                  />
                ),
              )}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

function NavButton({
  onClick,
  label,
  children,
}: {
  onClick: () => void;
  label: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={label}
      className="flex h-9 w-9 items-center justify-center rounded-full text-gray-500 transition-colors duration-150 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      {children}
    </button>
  );
}

function DayCell({
  iso: value,
  day,
  start,
  end,
  isToday,
  past,
  onPick,
  onHover,
}: {
  iso: string;
  day: number;
  start: string;
  end: string;
  isToday: boolean;
  past: boolean;
  onPick: (iso: string) => void;
  onHover: (iso: string | null) => void;
}) {
  const isStart = value === start;
  const isEnd = value === end && end !== "";
  const inRange = start !== "" && end !== "" && value > start && value < end;
  const selected = isStart || isEnd;

  // A past day is dimmed and unclickable, but still rendered: removing it would reflow the grid
  // and make the month read as if it began on the 8th.
  const base =
    "relative mx-auto flex h-9 w-9 items-center justify-center text-sm transition-colors duration-100";
  const tone = past
    ? "cursor-not-allowed text-gray-300 dark:text-gray-700"
    : selected
      ? "rounded-full bg-gray-900 font-medium text-white dark:bg-gray-100 dark:text-gray-900"
      : inRange
        ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
        : "rounded-full text-gray-700 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800";

  return (
    <button
      type="button"
      disabled={past}
      onClick={() => onPick(value)}
      onMouseEnter={() => onHover(value)}
      onMouseLeave={() => onHover(null)}
      aria-pressed={selected}
      className={`${base} ${tone}`}
    >
      {day}
      {isToday && !selected && (
        <span className="absolute bottom-1 h-1 w-1 rounded-full bg-gray-400 dark:bg-gray-500" />
      )}
    </button>
  );
}
