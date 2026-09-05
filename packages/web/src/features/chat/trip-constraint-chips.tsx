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
 * Where remains free text, but a debounced Photon/OpenStreetMap lookup can normalize a city or
 * region without introducing the proprietary POI database `SPEC.md` declines. Provider failure
 * never blocks Done. A filled chip shows its short summary and grows an × that clears just that
 * chip; everything clears together after a successful send.
 */
import { useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { CalendarBlankIcon } from "@phosphor-icons/react/dist/csr/CalendarBlank";
import { MapPinIcon } from "@phosphor-icons/react/dist/csr/MapPin";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { WalletIcon } from "@phosphor-icons/react/dist/csr/Wallet";
import { XIcon } from "@phosphor-icons/react/dist/csr/X";
import type { Icon } from "@phosphor-icons/react";
import type { LocationSuggestion } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { currencyGlyph, formatTripAmount } from "../../lib/currency";
import { useTheme } from "../../state/theme";
import { CloseButton } from "../../components/ui/icons";
import { Modal } from "../../components/ui/modal";
import { RangeCalendar } from "./range-calendar";
import { BudgetCurrencySelect } from "./budget-currency-select";
import { pillClass } from "./workspace-select";
import { BUDGET_TIERS, whenIsSet } from "./trip-constraints";
import type { TripConstraints, TripCurrency, TripWhen, TripWho } from "./trip-constraints";

/** Who defaults when the traveller dialog is first touched (Mindtrip's own default: 1 adult). */
const DEFAULT_WHO: TripWho = { adults: 1, children: 0, infants: 0, pets: 0 };

type ChipId = "where" | "when" | "who" | "budget";

export function TripConstraintChips({
  value,
  onChange,
  children,
}: {
  children?: ReactNode;
  value: TripConstraints;
  onChange: (next: TripConstraints) => void;
}) {
  // At most one dialog open (opening another closes the first, like Mindtrip's dialogs).
  const [open, setOpen] = useState<ChipId | null>(null);
  const T = S.chat.tripChips;

  const whereSet = value.where.trim() !== "";
  const whenSet = whenIsSet(value.when);
  // People only: the summary reads "3 travellers", and a dog is not one of them. A pet still
  // marks the chip as answered, which is what `whoSet` below is for.
  const whoTotal = value.who ? value.who.adults + value.who.children + value.who.infants : 0;
  const petCount = value.who?.pets ?? 0;
  const whoSet = value.who !== null && whoTotal + petCount > 0;
  const displayedWho = value.who ?? DEFAULT_WHO;
  const displayedWhoTotal = displayedWho.adults + displayedWho.children + displayedWho.infants;
  const budgetSet = value.budget !== null || value.budgetAmount !== null;
  // The glyphs a tier is drawn with count in the stated currency, else the person's home one.
  const { currency: homeCurrency } = useTheme();
  const budgetCurrency = value.budgetCurrency ?? homeCurrency;
  const glyph = currencyGlyph(budgetCurrency, T.intlLocale);
  // The stated number is the sharper fact, so it is the pill's summary when present.
  const budgetSummary =
    value.budgetAmount !== null
      ? formatTripAmount(value.budgetAmount, budgetCurrency, T.intlLocale)
      : value.budget !== null
        ? T.tierShort(glyph)[value.budget]
        : null;

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
        <WherePanel where={value.where} onChange={(where) => onChange({ ...value, where })} />
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
        dialogSubtitle={T.whoSummary(displayedWhoTotal, displayedWho.pets)}
        open={open}
        setOpen={setOpen}
        onOpen={() => {
          if (value.who === null) onChange({ ...value, who: DEFAULT_WHO });
        }}
        onClear={() => onChange({ ...value, who: null })}
      >
        <WhoPanel who={displayedWho} onChange={(who) => onChange({ ...value, who })} />
      </Chip>

      <Chip
        id="budget"
        title={T.budget}
        icon={WalletIcon}
        label={T.budget}
        summary={budgetSummary}
        dialogSubtitle={T.budgetTitle}
        open={open}
        setOpen={setOpen}
        onClear={() =>
          onChange({ ...value, budget: null, budgetAmount: null, budgetCurrency: null })
        }
      >
        <div className="px-5 py-2 sm:px-6" role="radiogroup" aria-label={T.budget}>
          {BUDGET_TIERS.map((tier) => {
            const active = value.budget === tier;
            return (
              <button
                key={tier}
                type="button"
                role="radio"
                aria-checked={active}
                onClick={() => onChange({ ...value, budget: tier })}
                className="flex min-h-12 w-full items-center gap-3 rounded-xl px-2 text-left text-base text-gray-700 transition-colors duration-150 hover:bg-gray-100 dark:text-gray-300 dark:hover:bg-gray-800"
              >
                <span
                  className={`h-5 w-5 shrink-0 rounded-full border ${
                    active
                      ? "border-[6px] border-gray-900 dark:border-gray-100"
                      : "border-gray-300 dark:border-gray-600"
                  }`}
                />
                <span className="min-w-0 flex-1">{T.tiers(glyph)[tier]}</span>
              </button>
            );
          })}
          <BudgetAmountField
            amount={value.budgetAmount}
            currency={budgetCurrency}
            onChange={(budgetAmount, currency) =>
              onChange({ ...value, budgetAmount, budgetCurrency: currency })
            }
          />
        </div>
      </Chip>
      {children}
    </div>
  );
}

const inputClass =
  "h-12 w-full rounded-full border border-gray-300 bg-white px-5 text-base text-gray-900 " +
  "placeholder:text-gray-400 focus:border-gray-500 focus:outline-none focus:ring-2 focus:ring-gray-900/10 " +
  "dark:border-gray-700 dark:bg-gray-900 dark:text-gray-100 dark:focus:border-gray-500";

const dialogWidthClass: Record<ChipId, string> = {
  where: "sm:max-w-md",
  when: "sm:max-w-2xl",
  who: "sm:max-w-sm",
  budget: "sm:max-w-sm",
};

type WhereSearchStatus = "idle" | "loading" | "ready" | "unavailable";
const WHERE_LISTBOX_ID = "trip-where-suggestions";

/** The comma-separated tail is the live query, so "Tokyo, Osa" can still suggest Osaka. */
function activeWhereQuery(value: string): string {
  const separator = Math.max(value.lastIndexOf(","), value.lastIndexOf("，"));
  return value.slice(separator + 1).trim();
}

function replaceActiveWhereQuery(value: string, label: string): string {
  const separator = Math.max(value.lastIndexOf(","), value.lastIndexOf("，"));
  if (separator === -1) return label;
  return `${value.slice(0, separator + 1).trimEnd()} ${label}`;
}

/** Search-as-you-type destination input with a free-text fallback. */
function WherePanel({ where, onChange }: { where: string; onChange: (where: string) => void }) {
  const T = S.chat.tripChips;
  const query = activeWhereQuery(where);
  const selectedValue = useRef("");
  const [focused, setFocused] = useState(false);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [status, setStatus] = useState<WhereSearchStatus>("idle");
  const [activeIndex, setActiveIndex] = useState(-1);

  useEffect(() => {
    if (query.length < 2 || (selectedValue.current !== "" && where === selectedValue.current)) {
      setSuggestions([]);
      setStatus("idle");
      setActiveIndex(-1);
      return;
    }

    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setStatus("loading");
      void api
        .searchLocations(query, T.intlLocale, controller.signal)
        .then((result) => {
          if (controller.signal.aborted) return;
          setSuggestions(result.suggestions);
          setStatus(result.error === undefined ? "ready" : "unavailable");
          setActiveIndex(-1);
        })
        .catch(() => {
          if (controller.signal.aborted) return;
          setSuggestions([]);
          setStatus("unavailable");
          setActiveIndex(-1);
        });
    }, 250);

    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [query, T.intlLocale, where]);

  const choose = (suggestion: LocationSuggestion) => {
    const next = replaceActiveWhereQuery(where, suggestion.label);
    selectedValue.current = next;
    onChange(next);
    setSuggestions([]);
    setStatus("idle");
    setActiveIndex(-1);
  };

  const popupVisible =
    focused && query.length >= 2 && where !== selectedValue.current && status !== "idle";

  return (
    <div className="px-6 py-5 sm:px-7">
      <div className="relative">
        <input
          type="text"
          role="combobox"
          value={where}
          onChange={(event) => {
            selectedValue.current = "";
            setSuggestions([]);
            setStatus("idle");
            setActiveIndex(-1);
            onChange(event.target.value);
          }}
          onFocus={() => setFocused(true)}
          onBlur={() => setFocused(false)}
          onKeyDown={(event) => {
            if (!popupVisible || suggestions.length === 0) return;
            if (event.key === "ArrowDown") {
              event.preventDefault();
              setActiveIndex((index) => (index + 1) % suggestions.length);
            } else if (event.key === "ArrowUp") {
              event.preventDefault();
              setActiveIndex((index) => (index <= 0 ? suggestions.length - 1 : index - 1));
            } else if (event.key === "Enter" && activeIndex >= 0) {
              event.preventDefault();
              choose(suggestions[activeIndex]!);
            } else if (event.key === "Escape") {
              event.preventDefault();
              event.stopPropagation();
              setSuggestions([]);
              setStatus("idle");
              setActiveIndex(-1);
            }
          }}
          placeholder={T.wherePlaceholder}
          autoFocus
          autoComplete="off"
          aria-autocomplete="list"
          aria-expanded={popupVisible}
          aria-controls={popupVisible ? WHERE_LISTBOX_ID : undefined}
          aria-activedescendant={
            activeIndex >= 0 ? `${WHERE_LISTBOX_ID}-option-${activeIndex}` : undefined
          }
          aria-busy={status === "loading"}
          className={`${inputClass} ${where !== "" ? "pr-12" : ""}`}
        />
        {where !== "" && (
          <button
            type="button"
            onMouseDown={(event) => event.preventDefault()}
            onClick={() => {
              selectedValue.current = "";
              onChange("");
              setSuggestions([]);
              setStatus("idle");
              setActiveIndex(-1);
            }}
            aria-label={`${T.clear} ${T.where}`}
            className="absolute right-3 top-1/2 flex h-8 w-8 -translate-y-1/2 items-center justify-center rounded-full bg-gray-200 text-gray-500 transition-colors hover:bg-gray-300 hover:text-gray-800 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600 dark:hover:text-white"
          >
            <XIcon size={15} weight="bold" aria-hidden />
          </button>
        )}

        {popupVisible && (
          <div
            id={WHERE_LISTBOX_ID}
            role="listbox"
            aria-label={T.whereListLabel}
            className="z-20 mt-2 max-h-80 overflow-y-auto rounded-2xl border border-gray-200 bg-white p-2 shadow-xl sm:absolute sm:left-0 sm:right-0 sm:top-full dark:border-gray-700 dark:bg-gray-900"
          >
            {status === "loading" ? (
              <p role="status" className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                {T.whereSearching}
              </p>
            ) : status === "unavailable" ? (
              <p role="status" className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                {T.whereUnavailable}
              </p>
            ) : suggestions.length === 0 ? (
              <p role="status" className="px-4 py-5 text-sm text-gray-500 dark:text-gray-400">
                {T.whereNoResults}
              </p>
            ) : (
              suggestions.map((suggestion, index) => (
                <button
                  id={`${WHERE_LISTBOX_ID}-option-${index}`}
                  key={suggestion.id}
                  type="button"
                  role="option"
                  aria-selected={activeIndex === index}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  onClick={() => choose(suggestion)}
                  className={`flex min-h-14 w-full items-center gap-3 rounded-xl px-3 py-2 text-left transition-colors ${
                    activeIndex === index
                      ? "bg-gray-100 dark:bg-gray-800"
                      : "hover:bg-gray-50 dark:hover:bg-gray-800/70"
                  }`}
                >
                  <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300">
                    <MapPinIcon size={18} weight="regular" aria-hidden />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-base font-medium text-gray-950 dark:text-white">
                      {suggestion.name}
                    </span>
                    {suggestion.detail !== "" && (
                      <span className="block truncate text-sm text-gray-500 dark:text-gray-400">
                        {suggestion.detail}
                      </span>
                    )}
                  </span>
                </button>
              ))
            )}
          </div>
        )}
      </div>

      <p className="mt-2.5 px-1 text-sm text-gray-400 dark:text-gray-500">{T.whereHint}</p>
    </div>
  );
}

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
 * One chip: pill trigger + dialog. A filled chip shows its summary in stronger ink and an
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
  onOpen,
  onClear,
  title,
  dialogSubtitle,
  children,
}: {
  id: ChipId;
  icon: Icon;
  label: string;
  summary: string | null;
  open: ChipId | null;
  setOpen: (id: ChipId | null) => void;
  /** Called only when a closed chip opens; Who uses it to commit its visible one-adult default. */
  onOpen?: () => void;
  onClear: () => void;
  /** Dialog heading — the chip's own word, so the dialog says what it is answering. */
  title: string;
  /** Optional live context beneath the heading (for example, "1 traveler"). */
  dialogSubtitle?: string;
  children: React.ReactNode;
}) {
  const isOpen = open === id;
  const filled = summary !== null;
  const T = S.chat.tripChips;
  return (
    <>
      <span
        className={`${pillClass} trip-constraint-chip ${
          filled ? "text-gray-900! dark:text-gray-100!" : ""
        } p-0!`}
      >
        <button
          type="button"
          onClick={() => {
            if (isOpen) {
              setOpen(null);
              return;
            }
            onOpen?.();
            setOpen(id);
          }}
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
        headerless
        widthClass={dialogWidthClass[id]}
        panelClassName={id === "where" ? "overflow-visible!" : undefined}
        contentClassName={`${id === "where" ? "max-h-none! overflow-visible!" : "max-h-[min(88vh,54rem)]! overflow-y-auto!"} p-0!`}
      >
        <section data-trip-constraint-dialog={id}>
          <header className="relative flex min-h-16 items-center justify-center border-b border-gray-100 px-14 py-3 text-center dark:border-gray-800">
            <CloseButton
              onClose={() => setOpen(null)}
              className="absolute left-4 top-1/2 -translate-y-1/2 rounded-full! p-2! text-gray-600 hover:text-gray-900 dark:text-gray-300 dark:hover:text-white [&_svg]:h-4 [&_svg]:w-4"
            />
            <div>
              <h2 className="text-xl font-semibold tracking-[-0.01em] text-gray-950 dark:text-white">
                {title}
              </h2>
              {dialogSubtitle && (
                <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{dialogSubtitle}</p>
              )}
            </div>
          </header>
          {children}
          <footer className="border-t border-gray-100 px-5 py-4 sm:px-6 dark:border-gray-800">
            <button
              type="button"
              onClick={() => setOpen(null)}
              className={`flex items-center justify-center rounded-full bg-gray-950 px-8 text-base font-medium text-white transition-colors duration-150 hover:bg-gray-700 dark:bg-gray-100 dark:text-gray-900 dark:hover:bg-gray-300 ${
                id === "where" ? "ml-auto min-h-10 w-full sm:w-40" : "min-h-10"
              } ${
                id === "who" || id === "budget"
                  ? "w-full"
                  : id === "when"
                    ? "ml-auto w-full sm:w-40"
                    : ""
              }`}
            >
              {T.dialogDone}
            </button>
          </footer>
        </section>
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
    <div className="px-5 pb-3 pt-4 sm:px-6">
      <div className="mx-auto mb-4 flex max-w-56 rounded-full bg-gray-100 p-1 dark:bg-gray-800">
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
            className={`flex-1 rounded-full px-3 py-2 text-sm transition-colors duration-150 ${
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
      <div className="pb-4 pt-1 text-center">
        <p className="text-sm font-medium text-gray-600 dark:text-gray-300">{T.daysLabel}</p>
        <span className="mt-2 flex items-center justify-center gap-3">
          <StepButton
            sign="-"
            disabled={value.days <= 0}
            onClick={() => onChange({ ...value, days: Math.max(0, value.days - 1) })}
          />
          <span className="w-10 text-center text-xl font-medium tabular-nums text-gray-950 dark:text-white">
            {value.days}
          </span>
          <StepButton sign="+" onClick={() => onChange({ ...value, days: value.days + 1 })} />
        </span>
      </div>
      <div className="mb-3 flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <p className="text-sm font-medium text-gray-900 dark:text-gray-100">{T.monthsLabel}</p>
        {/* No month selected means any month, which is the useful default rather than an error --
            "a week, sometime" is a real answer. Saying so beats an empty grid that reads as unset. */}
        <p className="text-xs text-gray-400 dark:text-gray-500">{T.monthsHint}</p>
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {months.map((m) => {
          const active = value.months.includes(m);
          return (
            <button
              key={m}
              type="button"
              aria-pressed={active}
              onClick={() => toggle(m)}
              className={`flex min-h-14 flex-col items-center justify-center gap-1 rounded-xl border px-2 py-2 text-sm transition-colors duration-150 ${
                active
                  ? "border-gray-900 bg-gray-900 font-medium text-white dark:border-gray-100 dark:bg-gray-100 dark:text-gray-900"
                  : "border-gray-200 text-gray-600 hover:border-gray-400 dark:border-gray-700 dark:text-gray-300 dark:hover:border-gray-500"
              }`}
            >
              <CalendarBlankIcon size={18} weight="regular" aria-hidden />
              {monthLabel(m)}
            </button>
          );
        })}
      </div>
    </div>
  );
}

/** "Who" dialog: traveller stepper rows with their age brackets. */
function WhoPanel({ who, onChange }: { who: TripWho; onChange: (who: TripWho) => void }) {
  const T = S.chat.tripChips;
  const rows = [
    { key: "adults" as const, label: T.adultsLabel, hint: T.adultsHint },
    { key: "children" as const, label: T.childrenLabel, hint: T.childrenHint },
    { key: "infants" as const, label: T.infantsLabel, hint: T.infantsHint },
    { key: "pets" as const, label: T.petsLabel, hint: T.petsHint },
  ];
  return (
    <div className="px-5 sm:px-6">
      {rows.map(({ key, label, hint }, i) => (
        <div
          key={key}
          className={`flex min-h-16 items-center justify-between gap-4 py-3 ${
            i > 0 ? "border-t border-gray-100 dark:border-gray-800" : ""
          }`}
        >
          <span className="min-w-0">
            <span className="block text-base font-medium text-gray-900 dark:text-gray-100">
              {label}
            </span>
            <span className="mt-0.5 block text-sm text-gray-400 dark:text-gray-500">{hint}</span>
          </span>
          <span className="flex shrink-0 items-center gap-2">
            <StepButton
              sign="-"
              disabled={who[key] <= 0}
              onClick={() => onChange({ ...who, [key]: Math.max(0, who[key] - 1) })}
            />
            <span className="w-8 text-center text-base tabular-nums text-gray-900 dark:text-gray-100">
              {who[key]}
            </span>
            <StepButton sign="+" onClick={() => onChange({ ...who, [key]: who[key] + 1 })} />
          </span>
        </div>
      ))}
    </div>
  );
}

/**
 * Optional exact total under the budget tiers. A tier is the zero-thought path; the number is
 * for the person who already knows — "这趟两万以内" is how a budget is actually said, and it is
 * the form the model can do arithmetic with. Digits only; the formatted string ("¥20,000")
 * belongs to summaries, where nobody has to edit around commas. The unit sits where the ¥ sign
 * used to: a picker defaulting to the person's home currency, so the common case is still
 * "type a number", and the traveller budgeting a Tokyo trip in yen changes one thing.
 */
function BudgetAmountField({
  amount,
  currency,
  onChange,
}: {
  amount: number | null;
  /** The unit shown — the stated one, else the home currency the parent resolved. */
  currency: TripCurrency;
  onChange: (amount: number | null, currency: TripCurrency) => void;
}) {
  const T = S.chat.tripChips;
  return (
    <div className="mx-2 mb-2 mt-1 border-t border-gray-100 pt-3 dark:border-gray-800">
      <label htmlFor="trip-budget-amount" className="flex items-baseline gap-2 px-1">
        <span className="text-sm font-semibold text-gray-900 dark:text-gray-100">
          {T.budgetAmountLabel}
        </span>
        <span className="text-xs text-gray-400 dark:text-gray-500">{T.budgetAmountHint}</span>
      </label>
      <div className="mt-2 flex h-11 items-center gap-2.5 rounded-2xl border border-gray-300 pl-1 pr-3.5 focus-within:border-gray-500 dark:border-gray-700 dark:focus-within:border-gray-500">
        <BudgetCurrencySelect value={currency} onChange={(next) => onChange(amount, next)} />
        <span aria-hidden className="h-5 w-px shrink-0 bg-gray-200 dark:bg-gray-700" />
        <input
          id="trip-budget-amount"
          type="text"
          inputMode="numeric"
          value={amount === null ? "" : String(amount)}
          onChange={(event) => {
            const digits = event.target.value.replace(/\D/g, "").slice(0, 8);
            onChange(digits === "" ? null : Number(digits), currency);
          }}
          placeholder={T.budgetAmountPlaceholder}
          className="min-w-0 flex-1 bg-transparent text-base text-gray-900 placeholder:text-gray-400 focus:outline-none dark:text-gray-100"
        />
        {amount !== null && (
          <button
            type="button"
            onClick={() => onChange(null, currency)}
            aria-label={`${T.clear} ${T.budgetAmountLabel}`}
            className="flex h-6 w-6 items-center justify-center rounded-full bg-gray-200 text-gray-500 transition-colors hover:bg-gray-300 hover:text-gray-800 dark:bg-gray-700 dark:text-gray-300 dark:hover:bg-gray-600"
          >
            <XIcon size={12} weight="bold" aria-hidden />
          </button>
        )}
      </div>
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
      className="flex h-9 w-9 items-center justify-center rounded-full border border-gray-300 text-lg font-light text-gray-600 transition-colors duration-150 hover:border-gray-500 hover:bg-gray-50 hover:text-gray-900 disabled:cursor-default disabled:opacity-35 disabled:hover:border-gray-300 disabled:hover:bg-transparent dark:border-gray-600 dark:text-gray-300 dark:hover:border-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"
    >
      {sign}
    </button>
  );
}
