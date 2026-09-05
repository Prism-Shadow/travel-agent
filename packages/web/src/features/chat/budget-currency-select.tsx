import { useEffect, useId, useRef, useState } from "react";
import type { KeyboardEvent } from "react";
import { Dropdown } from "../../components/ui/dropdown";
import { CheckIcon, ChevronDown } from "../../components/ui/icons";
import { S } from "../../lib/strings";
import { BUDGET_CURRENCIES } from "./trip-constraints";
import type { TripCurrency } from "./trip-constraints";

/** A compact currency picker; highlighting an option never changes the stated budget. */
export function BudgetCurrencySelect({
  value,
  onChange,
}: {
  value: TripCurrency;
  onChange: (currency: TripCurrency) => void;
}) {
  const [open, setOpen] = useState(false);
  const [active, setActive] = useState(0);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listId = useId();
  const T = S.chat.tripChips;
  const names = new Intl.DisplayNames([T.intlLocale], { type: "currency" });

  const toggle = (next: boolean) => {
    if (next) setActive(BUDGET_CURRENCIES.indexOf(value));
    setOpen(next);
  };
  const pick = (currency: TripCurrency) => {
    setOpen(false);
    onChange(currency);
    triggerRef.current?.focus();
  };

  useEffect(() => {
    if (open) {
      listRef.current?.children[active]?.scrollIntoView({ block: "nearest" });
    }
  }, [active, open]);

  const onKeyDown = (event: KeyboardEvent<HTMLButtonElement>) => {
    if (event.key === "Tab") {
      setOpen(false);
      return;
    }
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      if (!open) toggle(true);
      else {
        const direction = event.key === "ArrowDown" ? 1 : -1;
        setActive(
          (index) => (index + direction + BUDGET_CURRENCIES.length) % BUDGET_CURRENCIES.length,
        );
      }
    } else if (open && (event.key === "Home" || event.key === "End")) {
      event.preventDefault();
      setActive(event.key === "Home" ? 0 : BUDGET_CURRENCIES.length - 1);
    } else if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      const currency = BUDGET_CURRENCIES[active];
      if (open && currency) pick(currency);
      else toggle(true);
    } else if (!event.ctrlKey && !event.metaKey && !event.altKey && /^[a-z]$/i.test(event.key)) {
      const next = BUDGET_CURRENCIES.findIndex((code) => code.startsWith(event.key.toUpperCase()));
      if (next >= 0) {
        event.preventDefault();
        setOpen(true);
        setActive(next);
      }
    }
  };

  return (
    <Dropdown
      open={open}
      setOpen={toggle}
      className="shrink-0"
      portal={{ direction: "down", align: "left" }}
      menuClass="w-64 rounded-2xl! p-1.5!"
      menuStyle={{ height: "17rem" }}
      button={
        <button
          ref={triggerRef}
          type="button"
          role="combobox"
          aria-label={T.budgetCurrencyLabel}
          aria-haspopup="listbox"
          aria-expanded={open}
          aria-controls={open ? listId : undefined}
          aria-activedescendant={open ? `${listId}-${active}` : undefined}
          onClick={() => toggle(!open)}
          onKeyDown={onKeyDown}
          className={`flex h-9 items-center gap-2 rounded-xl px-2.5 text-sm font-semibold text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800 ${open ? "bg-gray-100 dark:bg-gray-800" : ""}`}
        >
          {value}
          <ChevronDown
            className={`text-gray-400 transition-transform ${open ? "rotate-180" : ""}`}
          />
        </button>
      }
    >
      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label={T.budgetCurrencyLabel}
        className="h-full overflow-y-auto overscroll-contain"
      >
        {BUDGET_CURRENCIES.map((code, index) => (
          <div
            key={code}
            id={`${listId}-${index}`}
            role="option"
            aria-selected={code === value}
            onMouseDown={(event) => event.preventDefault()}
            onPointerMove={() => setActive(index)}
            onClick={() => pick(code)}
            className={`flex min-h-11 cursor-pointer items-center gap-3 rounded-xl px-3 py-2 text-sm transition-colors ${
              index === active
                ? "bg-gray-100 text-gray-900 dark:bg-gray-800 dark:text-gray-100"
                : "text-gray-600 dark:text-gray-300"
            }`}
          >
            <span className="w-9 shrink-0 font-semibold text-gray-900 dark:text-gray-100">
              {code}
            </span>
            <span className="min-w-0 flex-1 truncate">{names.of(code)}</span>
            <span className="flex w-4 shrink-0 justify-center">
              {code === value && <CheckIcon size={15} />}
            </span>
          </div>
        ))}
      </div>
    </Dropdown>
  );
}
