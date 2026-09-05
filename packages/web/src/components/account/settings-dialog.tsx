import { useCallback, useEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { useLocation, useNavigate } from "react-router";
import { PaletteIcon } from "@phosphor-icons/react/dist/csr/Palette";
import { GlobeIcon } from "@phosphor-icons/react/dist/csr/Globe";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";
import { SlidersHorizontalIcon } from "@phosphor-icons/react/dist/csr/SlidersHorizontal";
import { InfoIcon } from "@phosphor-icons/react/dist/csr/Info";
import { CheckIcon } from "../ui/icons";
import { Modal } from "../ui/modal";
import { CloseButton } from "../ui/icons";
import { Button } from "../ui/button";
import { UserAvatar } from "../ui/user-avatar";
import { TravelAgentLogo } from "../ui/travel-agent-logo";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { ACCENT_SWATCHES, useTheme } from "../../state/theme";
import { useLocale } from "../../state/locale";
import { apiErrorText } from "../../lib/api-error";
import { formatMonthDay } from "../../lib/format";
import { forceUpdateCheck, updateCheckOutcome, useVersionInfo } from "../../lib/use-version-info";
import { toastError, toastInfo, toastSuccess } from "../ui/toast";
import { ChangePasswordDialog } from "./change-password-dialog";
import { ProxySettingsDialog } from "./proxy-settings-dialog";
import { UpdateDialog } from "./update-dialog";
import { DRAFT_FLUSH_EVENT } from "../../features/chat/draft-sessions";

const SECTIONS = ["appearance", "regional", "security", "advanced", "about"] as const;
type Section = (typeof SECTIONS)[number];

/** The query keeps the panel open across locale remounts without replacing the underlying draft. */
export function SettingsDialog() {
  const location = useLocation();
  const navigate = useNavigate();
  const requested = new URLSearchParams(location.search).get("settings");
  const section = SECTIONS.find((value) => value === requested) ?? null;
  const open = section !== null;
  const { user, desktopMode } = useAuth();
  const { mode, setMode, fontScale, setFontScale, accent, setAccent, currency, setCurrency } =
    useTheme();
  const { lang, locale, setLang } = useLocale();
  const { version, update } = useVersionInfo(open);
  const newVersion = update?.updateAvailable ? (update.latestVersion ?? null) : null;
  const [passwordOpen, setPasswordOpen] = useState(false);
  const [proxyOpen, setProxyOpen] = useState(false);
  const [updateOpen, setUpdateOpen] = useState(false);
  const [checking, setChecking] = useState(false);
  const panelRef = useRef<HTMLDivElement>(null);
  const nestedTriggerRef = useRef<HTMLButtonElement>(null);
  const T = S.settings;

  const changeSection = useCallback(
    (next: Section | null) => {
      const search = new URLSearchParams(location.search);
      if (next) search.set("settings", next);
      else search.delete("settings");
      navigate(
        { pathname: location.pathname, search: search.toString(), hash: location.hash },
        {
          replace: true,
          state: {
            ...location.state,
            settingsEntryKey: location.state?.settingsEntryKey ?? location.key,
          },
        },
      );
    },
    [location, navigate],
  );
  const close = useCallback(() => changeSection(null), [changeSection]);

  useEffect(() => {
    if (!open) {
      setPasswordOpen(false);
      setProxyOpen(false);
      setUpdateOpen(false);
      return;
    }
    panelRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
    return () => {
      const trigger = Array.from(
        document.querySelectorAll<HTMLButtonElement>(
          "[data-account-menu-trigger], [data-sidebar-trigger]",
        ),
      ).find((button) => button.getClientRects().length > 0);
      trigger?.focus();
    };
  }, [open]);

  const checkForUpdates = async () => {
    if (checking) return;
    setChecking(true);
    try {
      const outcome = updateCheckOutcome(await forceUpdateCheck());
      if (outcome.kind === "disabled") toastInfo(S.update.checkDisabled);
      else if (outcome.kind === "failed") toastError(S.update.checkFailed);
      else if (outcome.kind === "found") toastSuccess(S.update.foundNew(outcome.latestVersion));
      else toastSuccess(S.update.upToDate);
    } catch (error) {
      toastError(apiErrorText(error));
    } finally {
      setChecking(false);
    }
  };

  const sections = [
    { id: "appearance" as const, label: T.appearance, hint: T.appearanceHint, icon: PaletteIcon },
    { id: "regional" as const, label: T.regional, hint: T.regionalHint, icon: GlobeIcon },
    { id: "security" as const, label: T.security, hint: T.securityHint, icon: ShieldCheckIcon },
    ...(user?.isAdmin
      ? [
          {
            id: "advanced" as const,
            label: T.advanced,
            hint: T.advancedHint,
            icon: SlidersHorizontalIcon,
          },
        ]
      : []),
    { id: "about" as const, label: T.about, hint: T.aboutHint, icon: InfoIcon },
  ];
  const current = sections.find((entry) => entry.id === section);

  return (
    <>
      <Modal
        open={open}
        title={S.nav.settings}
        onClose={close}
        headerless
        widthClass="sm:max-w-[48rem]"
        overlayClassName="items-stretch! sm:items-center!"
        panelClassName="h-full rounded-none! border-0! sm:h-auto sm:rounded-dialog! sm:border!"
        contentClassName="h-full max-h-none! overflow-hidden! p-0!"
      >
        <div
          ref={panelRef}
          className="flex h-full flex-col sm:h-[min(36rem,85dvh)]"
          onKeyDown={(event) => {
            if (event.key !== "Tab") return;
            const controls = Array.from(
              event.currentTarget.querySelectorAll<HTMLElement>(
                "button:not(:disabled), a[href], input:not(:disabled), [tabindex='0']",
              ),
            ).filter((element) => element.getClientRects().length > 0);
            const first = controls[0];
            const last = controls.at(-1);
            if (event.shiftKey && document.activeElement === first) {
              event.preventDefault();
              last?.focus();
            } else if (!event.shiftKey && document.activeElement === last) {
              event.preventDefault();
              first?.focus();
            }
          }}
        >
          <header className="flex shrink-0 items-center justify-between border-b border-gray-100 px-5 py-4 sm:px-6 dark:border-gray-800">
            <h1 className="text-lg font-semibold">{S.nav.settings}</h1>
            <CloseButton onClose={close} />
          </header>
          <div className="flex min-h-0 flex-1 flex-col sm:flex-row">
            <nav
              aria-label={S.nav.settings}
              className="flex shrink-0 gap-1 overflow-x-auto border-b border-gray-100 bg-gray-50/70 p-2 sm:w-44 sm:flex-col sm:overflow-y-auto sm:border-b-0 sm:border-r sm:p-3 dark:border-gray-800 dark:bg-gray-950/50"
            >
              {sections.map(({ id, label, icon: Icon }) => (
                <button
                  key={id}
                  type="button"
                  aria-pressed={section === id}
                  onClick={() => changeSection(id)}
                  className={`flex min-h-10 shrink-0 items-center gap-2 rounded-xl px-3 py-2 text-left text-sm transition-colors ${section === id ? "bg-gray-200/70 font-medium text-gray-900 dark:bg-gray-800 dark:text-gray-100" : "text-gray-500 hover:bg-gray-100 hover:text-gray-900 dark:text-gray-400 dark:hover:bg-gray-800 dark:hover:text-gray-100"}`}
                >
                  <Icon size={18} className="shrink-0" aria-hidden />
                  <span className="whitespace-nowrap sm:whitespace-normal">{label}</span>
                  {id === "about" && newVersion && (
                    <span
                      aria-hidden
                      className="h-1.5 w-1.5 shrink-0 rounded-full bg-(--accent-bg)"
                    />
                  )}
                </button>
              ))}
            </nav>
            <section
              className="min-h-0 min-w-0 flex-1 overflow-y-auto px-5 py-6 sm:px-7"
              aria-labelledby="account-settings-section"
            >
              <h2 id="account-settings-section" className="text-xl font-semibold">
                {current?.label ?? T.advanced}
              </h2>
              <p className="mt-2 text-sm leading-6 text-gray-500 dark:text-gray-400">
                {current?.hint ?? T.adminOnly}
              </p>
              <div className="mt-6 space-y-6">
                {section === "appearance" && (
                  <>
                    <SettingsField label={T.theme}>
                      <div className="grid grid-cols-3 gap-2.5">
                        {(
                          [
                            { value: "light", label: T.themeLight },
                            { value: "dark", label: T.themeDark },
                            { value: "system", label: T.followSystem },
                          ] as const
                        ).map((option) => (
                          <button
                            key={option.value}
                            type="button"
                            aria-pressed={mode === option.value}
                            onClick={() => setMode(option.value)}
                            className={`min-w-0 rounded-xl border p-2 text-left transition-colors ${mode === option.value ? "border-gray-700 ring-1 ring-gray-700 dark:border-gray-300 dark:ring-gray-300" : "border-gray-200 hover:border-gray-400 dark:border-gray-700"}`}
                          >
                            <span
                              aria-hidden
                              className="relative mb-2 flex h-16 overflow-hidden rounded-lg border border-gray-200 dark:border-gray-700"
                              style={{
                                background:
                                  option.value === "dark"
                                    ? "#181b24"
                                    : option.value === "system"
                                      ? "linear-gradient(90deg, #ffffff 50%, #181b24 50%)"
                                      : "#ffffff",
                              }}
                            >
                              <span className="h-full w-1/4 border-r border-gray-400/20 bg-gray-400/15" />
                              <span className="m-2.5 flex-1 space-y-1.5">
                                <span className="block h-2 w-2/3 rounded bg-gray-400/35" />
                                <span className="block h-2 w-full rounded bg-gray-400/20" />
                                <span className="block h-2 w-4/5 rounded bg-gray-400/20" />
                              </span>
                            </span>
                            <span className="flex items-center justify-between gap-1 px-0.5 text-xs font-medium">
                              <span className="truncate">{option.label}</span>
                              {mode === option.value && <CheckIcon size={13} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </SettingsField>
                    <SettingsField label={T.fontSize}>
                      <Choices
                        label={T.fontSize}
                        value={fontScale}
                        onChange={setFontScale}
                        options={[
                          { value: "sm", label: T.fontSmallLabel },
                          { value: "md", label: T.fontMediumLabel },
                          { value: "lg", label: T.fontLargeLabel },
                        ]}
                      />
                    </SettingsField>
                    <SettingsField label={T.accent}>
                      <div className="flex flex-wrap gap-2">
                        {ACCENT_SWATCHES.map((swatch) => (
                          <button
                            key={swatch.value}
                            type="button"
                            title={T.accentNames[swatch.value]}
                            aria-label={T.accentNames[swatch.value]}
                            aria-pressed={accent === swatch.value}
                            onClick={() => setAccent(swatch.value)}
                            className={`flex h-10 w-10 items-center justify-center rounded-full border transition-colors ${accent === swatch.value ? "border-gray-400 dark:border-gray-500" : "border-transparent hover:border-gray-200 dark:hover:border-gray-600"}`}
                          >
                            <span
                              className="flex h-7 w-7 items-center justify-center rounded-full text-white"
                              style={{ backgroundColor: swatch.color }}
                            >
                              {accent === swatch.value && <CheckIcon size={14} />}
                            </span>
                          </button>
                        ))}
                      </div>
                    </SettingsField>
                  </>
                )}
                {section === "regional" && (
                  <>
                    <SettingsField label={T.language} hint={T.languageHint}>
                      <Choices
                        label={T.language}
                        value={lang}
                        onChange={(next) => {
                          window.dispatchEvent(new Event(DRAFT_FLUSH_EVENT));
                          setLang(next);
                        }}
                        options={[
                          { value: "en", label: T.langEn },
                          { value: "zh", label: T.langZh },
                          { value: "system", label: T.followSystem },
                        ]}
                      />
                    </SettingsField>
                    <SettingsField label={S.models.currency} hint={T.currencyHint}>
                      <Choices
                        label={S.models.currency}
                        value={currency}
                        onChange={setCurrency}
                        options={[
                          { value: "USD", label: S.models.currencyUsd },
                          { value: "CNY", label: S.models.currencyCny },
                        ]}
                      />
                    </SettingsField>
                  </>
                )}
                {section === "security" && (
                  <>
                    <div className="flex items-center gap-3 rounded-2xl border border-gray-200 p-4 dark:border-gray-800">
                      <UserAvatar size={44} />
                      <div className="min-w-0">
                        <p className="truncate font-semibold">{user?.userId}</p>
                        {user?.isAdmin && (
                          <p className="mt-1 text-xs text-gray-500">{S.auth.admin}</p>
                        )}
                      </div>
                    </div>
                    <SettingsField label={S.account.changePassword}>
                      <Button
                        onClick={(event) => {
                          nestedTriggerRef.current = event.currentTarget;
                          setPasswordOpen(true);
                        }}
                      >
                        {S.account.changePassword}
                      </Button>
                    </SettingsField>
                    <SettingsField label={S.privateProfile.menu} hint={T.profileUnavailable}>
                      <Button onClick={() => navigate("/settings/private-profile")}>
                        {T.viewProfileStatus}
                      </Button>
                    </SettingsField>
                  </>
                )}
                {section === "advanced" && user?.isAdmin && (
                  <SettingsField label={S.settings.proxyDialogTitle} hint={T.proxyHint}>
                    <Button
                      onClick={(event) => {
                        nestedTriggerRef.current = event.currentTarget;
                        setProxyOpen(true);
                      }}
                    >
                      {S.settings.proxyMenu}
                    </Button>
                  </SettingsField>
                )}
                {section === "about" && (
                  <>
                    <div className="flex items-center gap-3">
                      <TravelAgentLogo className="h-12 w-12 shrink-0" />
                      <div>
                        <p className="font-semibold">{S.appName}</p>
                        <p className="mt-1 text-sm text-gray-500">
                          {version ? `v${version.version}` : "—"}
                        </p>
                      </div>
                    </div>
                    {version?.buildDate && (
                      <p className="text-sm text-gray-500">
                        {S.update.lastUpdated(formatMonthDay(version.buildDate, locale))}
                      </p>
                    )}
                    {desktopMode ? (
                      <p className="text-sm text-gray-500">{T.desktopUpdates}</p>
                    ) : (
                      <Button
                        disabled={checking}
                        onClick={(event) => {
                          nestedTriggerRef.current = event.currentTarget;
                          if (newVersion) setUpdateOpen(true);
                          else void checkForUpdates();
                        }}
                      >
                        {checking
                          ? S.update.checking
                          : newVersion
                            ? S.update.newVersion(newVersion)
                            : S.update.checkNow}
                      </Button>
                    )}
                  </>
                )}
                {(section === "appearance" || section === "regional") && (
                  <p className="border-t border-gray-100 pt-4 text-xs leading-5 text-gray-400 dark:border-gray-800 dark:text-gray-500">
                    {T.savedAutomatically}
                  </p>
                )}
              </div>
            </section>
          </div>
        </div>
      </Modal>
      <ChangePasswordDialog
        open={open && passwordOpen}
        onClose={() => {
          setPasswordOpen(false);
          nestedTriggerRef.current?.focus();
        }}
      />
      <ProxySettingsDialog
        open={open && proxyOpen && user?.isAdmin === true}
        onClose={() => {
          setProxyOpen(false);
          nestedTriggerRef.current?.focus();
        }}
      />
      <UpdateDialog
        open={open && updateOpen && !desktopMode}
        onClose={() => {
          setUpdateOpen(false);
          nestedTriggerRef.current?.focus();
        }}
        latestVersion={newVersion}
        releaseUrl={update?.releaseUrl ?? null}
        canUpdate={user?.isAdmin === true}
        onRunFinished={() => void forceUpdateCheck().catch(() => undefined)}
      />
    </>
  );
}

function SettingsField({
  label,
  hint,
  children,
}: {
  label: string;
  hint?: string;
  children: ReactNode;
}) {
  return (
    <div>
      <p className="mb-3 text-sm font-medium">{label}</p>
      {children}
      {hint && <p className="mt-2 text-xs leading-5 text-gray-500 dark:text-gray-400">{hint}</p>}
    </div>
  );
}

function Choices<T extends string>({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: T;
  options: ReadonlyArray<{ value: T; label: string }>;
  onChange: (value: T) => void;
}) {
  return (
    <div
      role="group"
      aria-label={label}
      className="flex gap-1 rounded-xl bg-gray-100 p-1 dark:bg-gray-800"
    >
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          aria-pressed={option.value === value}
          onClick={() => onChange(option.value)}
          className={`min-h-9 min-w-0 flex-1 rounded-lg px-2 py-1.5 text-sm transition-colors ${option.value === value ? "bg-white font-medium text-gray-900 shadow-sm dark:bg-gray-600 dark:text-gray-100" : "text-gray-500 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"}`}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}
