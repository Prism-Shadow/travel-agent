/**
 * The draft screen's Where / When / Who / Budget chips: four pill triggers above the composer,
 * each opening a centred dialog — the same four constraints Mindtrip asks for, at the fidelity
 * this product can honestly deliver.
 *
 * A dialog rather than a popover attached to the pill. These are forms, not menus: a range
 * calendar and four stepper rows need room and a focal point, and a 288px popover hanging off a
 * chip gave them neither. `Modal` also brings the Escape layering and the in-app-browser
 * occlusion handling that a bare Dropdown does not.
 *
 * The footer button says Done, not Update. Mindtrip's dialogs re-run a search when you confirm,
 * so Update names a real action there; here nothing executes until the message is sent, and the
 * state is committed on every keystroke. Calling it Update would promise work that does not
 * happen. It closes the dialog, which is the only thing left for it to do.
 *
 * Where stays free text: `SPEC.md` declines a proprietary POI layer, and autocomplete without one
 * would be a fake. A filled chip shows its short summary and grows an × that clears just that
 * chip; everything clears together after a successful send.
 */
import { useState } from "react";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import { S } from "../../lib/strings";
import { Modal } from "../../components/ui/modal";
import { RangeCalendar } from "./range-calendar";
import { pillClass } from "./workspace-select";
import { BUDGET_TIERS, whenIsSet } from "./trip-constraints";
import type { TripConstraints, TripWhen, TripWho } from "./trip-constraints";

/** Who defaults when the traveller popover is first touched (Mindtrip's own default: 1 adult). */
const DEFAULT_WHO: TripWho = { adults: 1, children: 0, infants: 0, pets: 0 };

type ChipId = "where" | "when" | "who" | "budget";

export function TripConstraintChips({
  value,
  onChange,
}: {
  value: TripConstraints;
  onChange: (next: TripConstraints) => void;
}) {
  // At most one popover open (opening another closes the first, like Mindtrip's dialogs).
  const [open, setOpen] = useState<ChipId | null>(null);
  const T = S.chat.tripChips;

  const whereSet = value.where.trim() !== "";
  const whenSet = whenIsSet(value.when);
  // People only: the summary reads "3 travellers", and a dog is not one of them. A pet still
  // marks the chip as answered, which is what `whoSet` below is for.
  const whoTotal = value.who ? value.who.adults + value.who.children + value.who.infants : 0;
  const petCount = value.who?.pets ?? 0;
  const whoSet = value.who !== null && whoTotal + petCount > 0;
  const budgetSet = value.budget !== null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
      <Chip
        id="where"
        title={T.where}
        icon={MapPinIcon}
        label={T.where}
        summary={whereSet ? value.where.trim() : null}
        open={open}
        setOpen={setOpen}
        onClear={() => onChange({ ...value, where: "" })}
      >
        <div className="p-3">
          <input
            type="text"
            value={value.where}
            onChange={(e) => onChange({ ...value, where: e.target.value })}
            placeholder={T.wherePlaceholder}
            autoFocus
            className={inputClass}
          />
          <p className="mt-1.5 text-[11px] text-gray-400 dark:text-gray-500">{T.whereHint}</p>
        </div>
      </Chip>

      <Chip
        id="when"
        title={T.when}
        icon={CalendarBlankIcon}
        label={T.when}
        summary={whenSet ? whenSummary(value.when!) : null}
        open={open}
        setOpen={setOpen}
        onClear={() => onChange({ ...value, when: null })}
      >
        <WhenPanel when={value.when} onChange={(when) => onChange({ ...value, when })} />
      </Chip>

      <Chip
        id="who"
        title={T.who}
        icon={UsersIcon}
        label={T.who}
        summary={whoSet ? T.whoSummary(whoTotal, petCount) : null}
        open={open}
        setOpen={setOpen}
        onClear={() => onChange({ ...value, who: null })}
      >
        <WhoPanel who={value.who ?? DEFAULT_WHO} onChange={(who) => onChange({ ...value, who })} />
      </Chip>

      <Chip
        id="budget"
        title={T.budget}
        icon={WalletIcon}
        label={T.budget}
        summary={budgetSet ? T.tierShort[value.budget!] : null}
        open={open}
        setOpen={setOpen}
        onClear={() => onChange({ ...value, budget: null })}
      >
        <div className="p-2" role="radiogroup" aria-label={T.budgetTitle}>
          <p className="px-1.5 pb-1 text-[11px] text-gray-400 dark:text-gray-500">
            {T.budgetTitle}
          </p>
          {BUDGET_TIERS.map((tier) => {
            const active = value.budget === tier;
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => {
                  onChange({ ...value, budget: tier });
                  setOpen(null);
                }}
                className="flex w-full items-center gap-2.5 rounded-lg px-2 py-1.5 text-left text-sm text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span
                  className={`h-3.5 w-3.5 shrink-0 rounded-full border ${
                    active
                      ? "border-[4.5px] border-gray-900 dark:border-gray-100"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
                <span className="min-w-0 flex-1 truncate">{T.tiers[tier]}</span>
              </button>
            );
          })}
        </div>
      </Chip>
    </div>
  );
}

const inputClass =
  "w-full rounded-lg border border-gray-300 bg-white px-2.5 py-1.5 text-sm text-gray-900 " +
  "placeholder:text-gray-400 focus:border-gray-500 focus:outline-none " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500";

/** Filled chip's terse summary for the "when" modes (the full sentence goes into the message). */
function whenSummary(when: TripWhen): string {
  const T = S.chat.tripChips;
  if (when.kind === "dates") {
    const start = when.start.trim();
    const end = when.end.trim();
    if (start !== "" && end !== "") return `${start} – ${end}`;
    return start !== "" ? `${start} →` : `→ ${end}`;
  }
  // Two months read fine in a pill; more than that becomes a wall, so it says how many.
  const month =
    when.months.length === 0
      ? ""
      : when.months.length <= 2
        ? when.months.map(monthLabel).join(" / ")
        : T.monthCount(when.months.length);
  const parts =
    month !== ""
      ? [month, when.days > 0 ? T.daysCount(when.days) : null]
      : [T.daysCount(when.days), T.flexibleTag];
  return parts.filter((p): p is string => p !== null).join(" · ");
}

/**
 * One chip: pill trigger + popover. A filled chip shows its summary in stronger ink and an
 * × as a SIBLING button inside the pill-shaped group (never nested — the trigger and the
 * clear are separate buttons sharing the pill border).
 */
function Chip({
  id,
  icon: ChipIcon,
  label,
  summary,
  open,
  setOpen,
  onClear,
  title,
  children,
}: {
  id: ChipId;
  icon: Icon;
  label: string;
  summary: string | null;
  open: ChipId | null;
  setOpen: (id: ChipId | null) => void;
  onClear: () => void;
  /** Dialog heading — the chip's own word, so the dialog says what it is answering. */
  title: string;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  const filled = summary !== null;
  const T = S.chat.tripChips;
  return (
    <>
      <span className={`${pillClass} ${filled ? "text-gray-900! dark:text-gray-100!" : ""} p-0!`}>
        <button
          type="button"
          onClick={() => setOpen(isOpen ? null : id)}
          className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1"
          aria-expanded={isOpen}
          aria-haspopup="dialog"
        >
          <ChipIcon size={13} weight="regular" aria-hidden className="shrink-0" />
          <span className="max-w-40 min-w-0 truncate">{filled ? summary : label}</span>
        </button>
        {filled ? (
          <button
            type="button"
            onClick={onClear}
            title={T.clear}
            aria-label={`${T.clear} ${label}`}
            className="flex shrink-0 items-center self-stretch rounded-r-full pl-0.5 pr-1.5 text-gray-400 transition-colors duration-150 hover:text-gray-900 dark:hover:text-gray-100"
          >
            <XIcon size={11} weight="bold" aria-hidden />
          </button>
        ) : (
          <span className="pr-1.5" />
        )}
      </span>
      <Modal
        open={isOpen}
        title={title}
        onClose={() => setOpen(null)}
        widthClass="sm:max-w-lg"
        footer={
          <button
            type="button"
            onClick={() => setOpen(null)}
            className="rounded-full bg-gray-900 px-5 py-2 text-sm font-medium text-white transition-colors duration-150 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300"
          >
            {T.dialogDone}
          </button>
        }
      >
        {children}
      </Modal>
    </>
  );
}

/**
 * "When": exact dates on a two-month range calendar, or a flexible span of N days across any
 * number of months. Switching modes starts that mode blank rather than trying to translate one
 * answer into the other — "5 days in October" and "the 3rd to the 8th" are different statements,
 * and guessing between them would put words in the traveller's mouth.
 */
function WhenPanel({
  when,
  onChange,
}: {
  when: TripWhen | null;
  onChange: (when: TripWhen | null) => void;
}) {
  const T = S.chat.tripChips;
  const mode = when?.kind ?? "dates";
  const dates = when?.kind === "dates" ? when : { kind: "dates" as const, start: "", end: "" };
  const flex =
    when?.kind === "flexible" ? when : { kind: "flexible" as const, days: 0, months: [] };
  return (
    <div className="p-4">
      <div className="mx-auto mb-4 flex max-w-xs rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
        {(["dates", "flexible"] as const).map((m) => (
          <button
            key={m}
            type="button"
            aria-pressed={mode === m}
            onClick={() => {
              if (m === mode) return; // re-clicking the active mode must not wipe its fields
              onChange(
                m === "dates"
                  ? { kind: "dates", start: "", end: "" }
                  : { kind: "flexible", days: 0, months: [] },
              );
            }}
            className={`flex-1 rounded-full px-3 py-1.5 text-sm transition-colors duration-150 ${
              mode === m
                ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-900 dark:text-gray-100"
                : "text-gray-500 hover:text-gray-800 dark:text-gray-400 dark:hover:text-gray-200"
            }`}
          >
            {m === "dates" ? T.datesMode : T.flexibleMode}
          </button>
        ))}
      </div>
      {mode === "dates" ? (
        <RangeCalendar
          start={dates.start}
          end={dates.end}
          onChange={({ start, end }) => onChange({ kind: "dates", start, end })}
        />
      ) : (
        <FlexiblePanel value={flex} onChange={onChange} />
      )}
    </div>
  );
}

/** `YYYY-MM` rendered in the UI language ("October 2026" / "2026年10月"). */
function monthLabel(value: string): string {
  const m = /^(\d{4})-(\d{2})$/.exec(value);
  if (!m) return value;
  const d = new Date(Date.UTC(Number(m[1]), Number(m[2]) - 1, 1, 12));
  return new Intl.DateTimeFormat(S.chat.tripChips.intlLocale, {
    year: "numeric",
    month: "short",
    timeZone: "UTC",
  }).format(d);
}

/** The next twelve months from this one — the horizon a trip is actually planned within. */
function nextTwelveMonths(): string[] {
  const now = new Date();
  return Array.from({ length: 12 }, (_, i) => {
    const d = new Date(Date.UTC(now.getFullYear(), now.getMonth() + i, 1, 12));
    return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, "0")}`;
  });
}

function FlexiblePanel({
  value,
  onChange,
}: {
  value: { kind: "flexible"; days: number; months: string[] };
  onChange: (when: TripWhen) => void;
}) {
  const T = S.chat.tripChips;
  const months = nextTwelveMonths();
  const toggle = (m: string) => {
    const next = value.months.includes(m)
      ? value.months.filter((x) => x !== m)
      : [...value.months, m].sort();
    onChange({ ...value, months: next });
  };
  return (
    <div>
      <div className="mb-4 flex items-center justify-between">
        <span className="text-sm font-medium text-gray-900 dark:text-gray-100">{T.daysLabel}</span>
        <span className="flex items-center gap-2">
          <StepButton
            sign="-"
            disabled={value.days <= 0}
            onClick={() => onChange({ ...value, days: Math.max(0, value.days - 1) })}
          />
          <span className="w-8 text-center text-sm tabular-nums text-gray-900 dark:text-gray-100">
            {value.days}
          </span>
          <StepButton sign="+" onClick={() => onChange({ ...value, days: value.days + 1 })} />
        </span>
      </div>
      <p className="mb-2 text-sm font-medium text-gray-900 dark:text-gray-100">{T.monthsLabel}</p>
      {/* No month selected means any month, which is the useful default rather than an error --
          "a week, sometime" is a real answer. Saying so beats an empty grid that reads as unset. */}
      <p className="mb-2 text-xs text-gray-400 dark:text-gray-500">{T.monthsHint}</p>
      <div className="grid grid-cols-3 gap-1.5">
        {months.map((m) => {
          const active = value.months.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(m)}
              className={`rounded-lg border px-2 py-1.5 text-xs transition-colors duration-150 ${
                active
                  ? "border-gray-900 bg-gray-900 font-medium text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                  : "border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500"
              }`}
            >
              {monthLabel(m)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Who" popover: three stepper rows (adults / children / infants with their age brackets). */
function WhoPanel({ who, onChange }: { who: TripWho; onChange: (who: TripWho) => void }) {
  const T = S.chat.tripChips;
  const rows = [
    { key: "adults" as const, label: T.adultsLabel, hint: T.adultsHint },
    { key: "children" as const, label: T.childrenLabel, hint: T.childrenHint },
    { key: "infants" as const, label: T.infantsLabel, hint: T.infantsHint },
    { key: "pets" as const, label: T.petsLabel, hint: T.petsHint },
  ];
  return (
    <div className="p-3">
      {rows.map(({ key, label, hint }, i) => (
        <div
          key={key}
          className={`flex items-center justify-between gap-3 py-2 ${
            i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-sm text-gray-900 dark:text-gray-100">{label}</span>
            <span className="block text-[11px] text-gray-400 dark:text-gray-500">{hint}</span>
          </span>
          <span className="flex shrink-0 items-center gap-1.5">
            <StepButton
              sign="-"
              disabled={who[key] <= 0}
              onClick={() => onChange({ ...who, [key]: Math.max(0, who[key] - 1) })}
            />
            <span className="w-6 text-center text-sm tabular-nums text-gray-900 dark:text-gray-100">
              {who[key]}
            </span>
            <StepButton sign="+" onClick={() => onChange({ ...who, [key]: who[key] + 1 })} />
          </span>
        </div>
      ))}
    </div>
  );
}

/** Round −/+ stepper button (Mindtrip's traveller dialog grammar). */
function StepButton({
  sign,
  onClick,
  disabled,
}: {
  sign: "-" | "+";
  onClick: () => void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-label={sign}
      className="flex h-6 w-6 items-center justify-center rounded-full border border-gray-300 text-sm text-gray-600 transition-colors duration-150 hover:border-gray-500 hover:text-gray-900 disabled:cursor-default disabled:opacity-40 disabled:hover:border-gray-300 dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-400 dark:hover:text-gray-100"
    >
      {sign}
    </button>
  );
}
