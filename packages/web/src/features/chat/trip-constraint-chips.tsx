/**
 * The draft screen's Where / When / Who / Budget chips (design/005 P0): four pill triggers
 * above the composer, each opening a small form popover (Dropdown), mirroring Mindtrip's
 * four constraint dialogs at the fidelity this product can honestly deliver — free-text
 * destination (no POI autocomplete to fake), native date/month inputs (no custom calendar),
 * traveller steppers, and price TIERS for budget (never a number; see trip-constraints.ts
 * header for why that is a design decision, not a shortcut).
 *
 * State is owned by the draft view and committed on every change — there is no Save button:
 * unlike Mindtrip's dialogs (which re-run a search on update), nothing executes until the
 * user sends, so the chips are just a visible draft of the constraint block the send will
 * prepend. A filled chip shows its short summary and grows an × that clears just that chip;
 * everything clears together after a successful send.
 */
import { useState } from "react";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import { S } from "../../lib/strings";
import { Dropdown } from "../../components/ui/dropdown";
import { pillClass } from "./workspace-select";
import { BUDGET_TIERS, whenIsSet } from "./trip-constraints";
import type { TripConstraints, TripWhen, TripWho } from "./trip-constraints";

/** Who defaults when the traveller popover is first touched (Mindtrip's own default: 1 adult). */
const DEFAULT_WHO: TripWho = { adults: 1, children: 0, infants: 0 };

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
  const whoTotal = value.who ? value.who.adults + value.who.children + value.who.infants : 0;
  const whoSet = value.who !== null && whoTotal > 0;
  const budgetSet = value.budget !== null;

  return (
    <div className="mb-2 flex flex-wrap items-center gap-2 px-1">
      <Chip
        id="where"
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
        icon={UsersIcon}
        label={T.who}
        summary={whoSet ? T.travellers(whoTotal) : null}
        open={open}
        setOpen={setOpen}
        onClear={() => onChange({ ...value, who: null })}
      >
        <WhoPanel who={value.who ?? DEFAULT_WHO} onChange={(who) => onChange({ ...value, who })} />
      </Chip>

      <Chip
        id="budget"
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
  const month = when.month.trim();
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
  children,
}: {
  id: ChipId;
  icon: Icon;
  label: string;
  summary: string | null;
  open: ChipId | null;
  setOpen: (id: ChipId | null) => void;
  onClear: () => void;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  const filled = summary !== null;
  return (
    <Dropdown
      open={isOpen}
      setOpen={(v) => setOpen(v ? id : null)}
      menuClass="left-0 top-full mt-1 w-72 max-w-[calc(100vw-2rem)] origin-top-left"
      button={
        <span className={`${pillClass} ${filled ? "text-gray-900! dark:text-gray-100!" : ""} p-0!`}>
          <button
            type="button"
            onClick={() => setOpen(isOpen ? null : id)}
            className="flex min-w-0 items-center gap-1.5 py-1 pl-2 pr-1"
            aria-expanded={isOpen}
          >
            <ChipIcon size={13} weight="regular" aria-hidden className="shrink-0" />
            <span className="max-w-40 min-w-0 truncate">{filled ? summary : label}</span>
          </button>
          {filled ? (
            <button
              type="button"
              onClick={onClear}
              title={S.chat.tripChips.clear}
              aria-label={`${S.chat.tripChips.clear} ${label}`}
              className="flex shrink-0 items-center self-stretch rounded-r-full pl-0.5 pr-1.5 text-gray-400 transition-colors duration-150 hover:text-gray-900 dark:hover:text-gray-100"
            >
              <XIcon size={11} weight="bold" aria-hidden />
            </button>
          ) : (
            <span className="pr-1.5" />
          )}
        </span>
      }
    >
      {children}
    </Dropdown>
  );
}

/** "When" popover: Dates | Flexible segmented modes (switching starts that mode blank). */
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
  const flex = when?.kind === "flexible" ? when : { kind: "flexible" as const, days: 0, month: "" };
  return (
    <div className="p-3">
      <div className="mb-3 flex rounded-full bg-gray-100 p-0.5 dark:bg-gray-800">
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
                  : { kind: "flexible", days: 0, month: "" },
              );
            }}
            className={`flex-1 rounded-full px-2 py-1 text-xs transition-colors duration-150 ${
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
        <div className="flex items-center gap-2">
          <label className="min-w-0 flex-1 text-[11px] text-gray-400 dark:text-gray-500">
            {T.startDate}
            <input
              type="date"
              value={dates.start}
              onChange={(e) => onChange({ ...dates, start: e.target.value })}
              className={`${inputClass} mt-0.5`}
            />
          </label>
          <label className="min-w-0 flex-1 text-[11px] text-gray-400 dark:text-gray-500">
            {T.endDate}
            <input
              type="date"
              value={dates.end}
              min={dates.start || undefined}
              onChange={(e) => onChange({ ...dates, end: e.target.value })}
              className={`${inputClass} mt-0.5`}
            />
          </label>
        </div>
      ) : (
        <div className="flex items-center gap-2">
          <label className="min-w-0 flex-1 text-[11px] text-gray-400 dark:text-gray-500">
            {T.daysLabel}
            <span className="mt-0.5 flex items-center gap-1">
              <StepButton
                sign="-"
                disabled={flex.days <= 0}
                onClick={() => onChange({ ...flex, days: Math.max(0, flex.days - 1) })}
              />
              <span className="w-8 text-center text-sm tabular-nums text-gray-900 dark:text-gray-100">
                {flex.days}
              </span>
              <StepButton sign="+" onClick={() => onChange({ ...flex, days: flex.days + 1 })} />
            </span>
          </label>
          <label className="min-w-0 flex-1 text-[11px] text-gray-400 dark:text-gray-500">
            {T.monthLabel}
            <input
              type="month"
              value={flex.month}
              onChange={(e) => onChange({ ...flex, month: e.target.value })}
              className={`${inputClass} mt-0.5`}
            />
          </label>
        </div>
      )}
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
