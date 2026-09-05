import { useEffect, useId, useRef, useState } from "react";
import { useLocation, useNavigate } from "react-router";
import { GearSixIcon } from "@phosphor-icons/react/dist/csr/GearSix";
import { UsersIcon } from "@phosphor-icons/react/dist/csr/Users";
import { SignOutIcon } from "@phosphor-icons/react/dist/csr/SignOut";
import { CaretUpDownIcon } from "@phosphor-icons/react/dist/csr/CaretUpDown";
import { S } from "../../lib/strings";
import { useAuth } from "../../state/auth";
import { useVersionInfo } from "../../lib/use-version-info";
import { Dropdown } from "../ui/dropdown";
import { UserAvatar } from "../ui/user-avatar";

/** Account actions stay compact; preferences live in the shared settings dialog. */
export function AccountMenu({ onNavigate }: { onNavigate?: () => void }) {
  const { user, logout, desktopMode } = useAuth();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuId = useId();
  const { update } = useVersionInfo(open);
  const newVersion = update?.updateAvailable ? (update.latestVersion ?? null) : null;
  const rowClass =
    "flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-gray-700 transition-colors hover:bg-gray-100 dark:text-gray-200 dark:hover:bg-gray-800";

  useEffect(() => {
    if (open) menuRef.current?.querySelector<HTMLButtonElement>("button")?.focus();
  }, [open]);

  const openSettings = () => {
    const search = new URLSearchParams(location.search);
    search.set("settings", "appearance");
    setOpen(false);
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
    onNavigate?.();
  };

  return (
    <div className="shrink-0 border-t border-gray-200 p-2 dark:border-gray-800">
      <Dropdown
        open={open}
        setOpen={setOpen}
        onEscape={() => {
          setOpen(false);
          triggerRef.current?.focus();
        }}
        portal={{ direction: "up", align: "left", matchTriggerWidth: true }}
        menuClass="rounded-2xl! p-1.5!"
        button={
          <button
            ref={triggerRef}
            type="button"
            data-account-menu-trigger
            aria-label={
              newVersion
                ? `${user?.userId ?? ""} · ${S.update.newVersion(newVersion)}`
                : user?.userId
            }
            title={newVersion ? S.update.newVersion(newVersion) : undefined}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-controls={open ? menuId : undefined}
            onClick={() => setOpen(!open)}
            onKeyDown={(event) => {
              if (event.key === "ArrowDown" || event.key === "ArrowUp") {
                event.preventDefault();
                setOpen(true);
              }
            }}
            className={`flex w-full items-center gap-2.5 rounded-xl px-2 py-2 text-left transition-colors hover:bg-gray-200/70 dark:hover:bg-gray-800 ${open ? "bg-gray-200/70 dark:bg-gray-800" : ""}`}
          >
            <span className="relative shrink-0">
              <UserAvatar />
              {newVersion && (
                <span
                  aria-hidden
                  className="absolute -right-0.5 -top-0.5 h-2.5 w-2.5 rounded-full border-2 border-gray-50 bg-(--accent-bg) dark:border-gray-900"
                />
              )}
            </span>
            <span className="min-w-0 flex-1 truncate text-sm font-medium">{user?.userId}</span>
            <CaretUpDownIcon size={15} className="shrink-0 text-gray-400" aria-hidden />
          </button>
        }
      >
        <div className="mb-1 flex items-center gap-3 border-b border-gray-100 px-3 py-3 dark:border-gray-800">
          <UserAvatar size={40} />
          <div className="min-w-0">
            <p className="truncate text-sm font-semibold">{user?.userId}</p>
            <p className="mt-0.5 text-xs text-gray-500">
              {user?.isAdmin ? S.auth.admin : S.appName}
            </p>
          </div>
        </div>
        <div
          ref={menuRef}
          id={menuId}
          role="menu"
          aria-label={S.settings.accountMenu}
          onKeyDown={(event) => {
            if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
            event.preventDefault();
            const buttons = Array.from(
              event.currentTarget.querySelectorAll<HTMLButtonElement>("button"),
            );
            const current = buttons.indexOf(document.activeElement as HTMLButtonElement);
            const next =
              event.key === "Home"
                ? 0
                : event.key === "End"
                  ? buttons.length - 1
                  : (current + (event.key === "ArrowDown" ? 1 : -1) + buttons.length) %
                    buttons.length;
            buttons[next]?.focus();
          }}
        >
          <button type="button" role="menuitem" className={rowClass} onClick={openSettings}>
            <GearSixIcon size={18} aria-hidden />
            <span className="flex-1">{S.nav.settings}</span>
            {newVersion && (
              <span aria-hidden className="h-1.5 w-1.5 rounded-full bg-(--accent-bg)" />
            )}
          </button>
          {user?.isAdmin && !desktopMode && (
            <button
              type="button"
              role="menuitem"
              className={rowClass}
              onClick={() => {
                setOpen(false);
                navigate("/admin/users");
                onNavigate?.();
              }}
            >
              <UsersIcon size={18} aria-hidden />
              {S.settings.userManagement}
            </button>
          )}
          {!desktopMode && (
            <div className="mt-1 border-t border-gray-100 pt-1 dark:border-gray-800">
              <button
                type="button"
                role="menuitem"
                className="flex min-h-10 w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm text-red-600 transition-colors hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950/40"
                onClick={() => {
                  setOpen(false);
                  void logout().then(() => navigate("/login"));
                }}
              >
                <SignOutIcon size={18} aria-hidden />
                {S.auth.logout}
              </button>
            </div>
          )}
        </div>
      </Dropdown>
    </div>
  );
}
