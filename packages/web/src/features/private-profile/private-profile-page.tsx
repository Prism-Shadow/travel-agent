import { useEffect, useState } from "react";
import type { ReactNode } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { ArrowLeftIcon } from "@phosphor-icons/react/dist/csr/ArrowLeft";
import { IdentificationCardIcon } from "@phosphor-icons/react/dist/csr/IdentificationCard";
import { KeyholeIcon } from "@phosphor-icons/react/dist/csr/Keyhole";
import { LockKeyIcon } from "@phosphor-icons/react/dist/csr/LockKey";
import { ShieldCheckIcon } from "@phosphor-icons/react/dist/csr/ShieldCheck";

import * as api from "../../api/endpoints";
import { Button } from "../../components/ui/button";
import { TravelAgentLogo } from "../../components/ui/travel-agent-logo";
import { Tabs } from "../../components/ui/tabs";
import { S } from "../../lib/strings";
import { useDocumentTitle } from "../../lib/use-document-title";
import type { CapabilityReport } from "../capabilities/capability-model";
import {
  parsePrivateProfileTab,
  privateProfileCapabilityState,
  type PrivateProfileCapabilityState,
  type PrivateProfileTab,
} from "./private-profile-model";

interface ProfileField {
  label: string;
}

interface ProfileSection {
  title: string;
  description: string;
  fields: ProfileField[];
}

/**
 * User-owned profile settings. The route deliberately stays visible in standalone-web mode: there
 * is no alternate backend to silently substitute for the desktop vault, so that state is rendered
 * as unavailable instead.
 *
 * This first surface is read-only because the renderer has no vault status or CRUD bridge yet.
 * Disabled write controls state that boundary explicitly; no browser storage is used as a fake
 * persistence layer for personal data.
 */
export function PrivateProfilePage() {
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  const [report, setReport] = useState<CapabilityReport | null>(null);
  const [capabilityFailed, setCapabilityFailed] = useState(false);
  const T = S.privateProfile;

  useDocumentTitle(T.title);

  useEffect(() => {
    let cancelled = false;
    void api
      .getCapabilities()
      .then((next) => {
        if (!cancelled) setReport(next);
      })
      .catch(() => {
        if (!cancelled) setCapabilityFailed(true);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const activeTab = parsePrivateProfileTab(searchParams.get("tab"));
  const capability = report ? privateProfileCapabilityState(report) : null;
  const personal: ProfileSection = {
    title: T.personalTitle,
    description: T.personalDescription,
    fields: [
      { label: T.fieldFullName },
      { label: T.fieldEmail },
      { label: T.fieldHomeCity },
      { label: T.fieldBirthDate },
    ],
  };
  const personalOverview: ProfileSection = {
    ...personal,
    fields: personal.fields.slice(0, 3),
  };
  const preferences: ProfileSection = {
    title: T.preferencesTitle,
    description: T.preferencesDescription,
    fields: [{ label: T.fieldSeat }, { label: T.fieldRoom }, { label: T.fieldBreakfast }],
  };
  const identity: ProfileSection = {
    title: T.identityTitle,
    description: T.identityDescription,
    fields: [{ label: T.fieldPassport }, { label: T.fieldPhone }, { label: T.fieldAddress }],
  };

  const selectTab = (tab: PrivateProfileTab) => {
    const next = new URLSearchParams(searchParams);
    if (tab === "overview") next.delete("tab");
    else next.set("tab", tab);
    setSearchParams(next, { replace: true });
  };

  const statusCopy = storageStatusCopy(capability, capabilityFailed);
  const tabItems = [
    { key: "overview", label: T.tabOverview },
    { key: "personal", label: T.tabPersonal },
    { key: "preferences", label: T.tabPreferences },
    { key: "privacy", label: T.tabPrivacy },
  ] as const;

  return (
    <div className="h-full overflow-y-auto bg-white dark:bg-gray-950" data-testid="private-profile">
      <div className="w-full px-5 py-5 sm:pt-4 sm:pr-[52px] sm:pb-6 sm:pl-[70px]">
        <div className="-ml-5 mb-[35px] flex items-center gap-2 text-sm font-semibold text-gray-900 dark:text-gray-100">
          <TravelAgentLogo className="h-7 w-7 rounded-md" />
          <span>{S.appName}</span>
        </div>

        <button
          type="button"
          onClick={() => navigate("/chat")}
          className="mb-5 inline-flex items-center gap-1 text-sm text-gray-500 transition-colors duration-150 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
        >
          <ArrowLeftIcon size={15} aria-hidden />
          {T.backToChat}
        </button>

        <header className="mb-8 flex items-start justify-between gap-6">
          <div>
            <h1 className="text-[28px] leading-9 font-semibold tracking-tight text-gray-950 dark:text-gray-50">
              {T.title}
            </h1>
            <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{T.subtitle}</p>
          </div>
          <Button
            variant="primary"
            disabled
            title={T.editingUnavailable}
            className="mt-0.5 h-10 shrink-0 px-5 sm:-mt-4"
          >
            {T.addDetails}
          </Button>
        </header>

        <Tabs items={tabItems} active={activeTab} onChange={selectTab} />

        {activeTab === "privacy" ? (
          <PrivacyPanel
            capability={capability}
            capabilityFailed={capabilityFailed}
            statusCopy={statusCopy}
          />
        ) : (
          <>
            <SecuritySummary
              capability={capability}
              capabilityFailed={capabilityFailed}
              statusCopy={statusCopy}
            />
            <div className="border-b border-gray-200 dark:border-gray-800">
              {activeTab === "overview" && (
                <ProfileTable section={personalOverview} showDescription={false} />
              )}
              {activeTab === "personal" && <ProfileTable section={personal} showDescription />}
              {(activeTab === "overview" || activeTab === "preferences") && (
                <ProfileTable section={preferences} showDescription={activeTab !== "overview"} />
              )}
              {activeTab === "overview" && (
                <IdentitySection
                  capability={capability}
                  section={identity}
                  onWhy={() => selectTab("privacy")}
                />
              )}
            </div>
            <ProfileFooter />
          </>
        )}
      </div>
    </div>
  );
}

function storageStatusCopy(
  capability: PrivateProfileCapabilityState | null,
  failed: boolean,
): { title: string; description: string; tone: "good" | "quiet" | "warning" } {
  const T = S.privateProfile;
  if (failed) {
    return {
      title: T.storageLoadFailedTitle,
      description: T.storageLoadFailedDescription,
      tone: "warning",
    };
  }
  if (!capability) {
    return {
      title: T.storageCheckingTitle,
      description: T.storageCheckingDescription,
      tone: "quiet",
    };
  }
  if (capability.storage === "available") {
    return {
      title: T.storageAvailableTitle,
      description: T.storageAvailableDescription,
      tone: "good",
    };
  }
  if (capability.storage === "desktop_required") {
    return {
      title: T.storageDesktopTitle,
      description: T.storageDesktopDescription,
      tone: "quiet",
    };
  }
  if (capability.storage === "denied") {
    return {
      title: T.storageDeniedTitle,
      description: T.storageDeniedDescription,
      tone: "warning",
    };
  }
  return {
    title: T.storageOffTitle,
    description: T.storageOffDescription,
    tone: "quiet",
  };
}

function SecuritySummary({
  capability,
  capabilityFailed,
  statusCopy,
}: {
  capability: PrivateProfileCapabilityState | null;
  capabilityFailed: boolean;
  statusCopy: ReturnType<typeof storageStatusCopy>;
}) {
  const T = S.privateProfile;
  const statusTone = statusCopy.tone;
  return (
    <div className="flex flex-col gap-3 border-b border-gray-200 pt-7 pb-[29px] text-sm sm:flex-row sm:items-center sm:gap-8 dark:border-gray-800">
      <span
        className={`inline-flex items-center gap-2 ${
          statusTone === "good"
            ? "text-emerald-700 dark:text-emerald-400"
            : statusTone === "warning"
              ? "text-amber-700 dark:text-amber-400"
              : "text-gray-600 dark:text-gray-400"
        }`}
        title={statusCopy.description}
      >
        {statusTone === "good" ? (
          <ShieldCheckIcon size={18} aria-hidden />
        ) : (
          <LockKeyIcon size={18} aria-hidden />
        )}
        {statusCopy.title}
      </span>
      <span className="inline-flex items-center gap-2 text-gray-600 dark:text-gray-400">
        <KeyholeIcon size={18} aria-hidden />
        {T.approvalTitle}
      </span>
      {capability?.storageReason ? (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {capability.storageReason}
        </span>
      ) : null}
      {capabilityFailed ? (
        <span className="text-xs text-amber-700 dark:text-amber-400">
          {T.storageLoadFailedDescription}
        </span>
      ) : null}
    </div>
  );
}

function ProfileTable({
  section,
  showDescription,
}: {
  section: ProfileSection;
  showDescription: boolean;
}) {
  const T = S.privateProfile;
  return (
    <section aria-labelledby={`profile-${section.title.replace(/\s+/g, "-").toLowerCase()}`}>
      <div className="flex min-h-12 flex-col justify-center border-x border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/70">
        <h2
          id={`profile-${section.title.replace(/\s+/g, "-").toLowerCase()}`}
          className="text-sm font-medium text-gray-800 dark:text-gray-200"
        >
          {section.title}
        </h2>
        {showDescription ? (
          <p className="mt-1 text-xs text-gray-500 dark:text-gray-400">{section.description}</p>
        ) : null}
      </div>
      {section.fields.map((field) => (
        <div
          key={field.label}
          className="grid min-h-[49px] grid-cols-[35%_minmax(0,1fr)_auto] items-center gap-3 border-t border-gray-200 pr-6 pl-3 text-sm dark:border-gray-800"
        >
          <span className="text-gray-800 dark:text-gray-200">{field.label}</span>
          <span className="text-gray-500 dark:text-gray-400">{T.notSaved}</span>
          <button
            type="button"
            disabled
            title={T.editingUnavailable}
            className="px-1 py-2 text-gray-400 disabled:cursor-not-allowed dark:text-gray-600"
          >
            {T.add}
          </button>
        </div>
      ))}
    </section>
  );
}

function IdentitySection({
  capability,
  section,
  onWhy,
}: {
  capability: PrivateProfileCapabilityState | null;
  section: ProfileSection;
  onWhy: () => void;
}) {
  const T = S.privateProfile;
  return (
    <section aria-labelledby="profile-identity">
      <div className="flex min-h-12 items-center border-x border-t border-gray-100 bg-gray-50/80 px-3 py-3 dark:border-gray-800 dark:bg-gray-900/70">
        <h2 id="profile-identity" className="text-sm font-medium text-gray-800 dark:text-gray-200">
          {section.title}
        </h2>
      </div>
      {capability?.l2Available ? (
        <ProfileTableRows fields={section.fields} />
      ) : (
        <div className="flex min-h-[66px] items-center gap-3 border-t border-gray-200 px-3 text-sm text-gray-500 dark:border-gray-800 dark:text-gray-400">
          <IdentificationCardIcon className="shrink-0" size={19} aria-hidden />
          <span className="min-w-0 flex-1">{T.l2UnavailableDescription}</span>
          {capability?.l2Reason ? (
            <span className="hidden max-w-sm text-right text-xs text-gray-400 lg:block dark:text-gray-500">
              {capability.l2Reason}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onWhy}
            className="shrink-0 text-gray-500 underline underline-offset-2 hover:text-gray-900 dark:text-gray-400 dark:hover:text-gray-100"
          >
            {T.why}
          </button>
        </div>
      )}
    </section>
  );
}

function ProfileTableRows({ fields }: { fields: ProfileField[] }) {
  const T = S.privateProfile;
  return (
    <>
      {fields.map((field) => (
        <div
          key={field.label}
          className="grid min-h-[49px] grid-cols-[35%_minmax(0,1fr)_auto] items-center gap-3 border-t border-gray-200 pr-6 pl-3 text-sm dark:border-gray-800"
        >
          <span className="text-gray-800 dark:text-gray-200">{field.label}</span>
          <span className="text-gray-500 dark:text-gray-400">{T.notSaved}</span>
          <button
            type="button"
            disabled
            title={T.editingUnavailable}
            className="px-1 py-2 text-gray-400 disabled:cursor-not-allowed dark:text-gray-600"
          >
            {T.add}
          </button>
        </div>
      ))}
    </>
  );
}

function ProfileFooter() {
  const T = S.privateProfile;
  return (
    <div className="pt-11 pb-8 text-sm">
      <p className="text-gray-500 dark:text-gray-400">{T.neverStoredDescription}</p>
      <button
        type="button"
        disabled
        title={T.editingUnavailable}
        className="mt-4 text-red-500 disabled:cursor-not-allowed disabled:opacity-60 dark:text-red-400"
      >
        {T.deleteAll}
      </button>
    </div>
  );
}

function PrivacyPanel({
  capability,
  capabilityFailed,
  statusCopy,
}: {
  capability: PrivateProfileCapabilityState | null;
  capabilityFailed: boolean;
  statusCopy: ReturnType<typeof storageStatusCopy>;
}) {
  const T = S.privateProfile;
  return (
    <div className="py-6">
      <div className="mb-6">
        <h2 className="text-base font-semibold text-gray-900 dark:text-gray-100">
          {T.privacyTitle}
        </h2>
        <p className="mt-1 text-sm text-gray-500 dark:text-gray-400">{T.privacyDescription}</p>
      </div>
      <div className="divide-y divide-gray-200 border-y border-gray-200 dark:divide-gray-800 dark:border-gray-800">
        <PrivacyRow
          icon={<ShieldCheckIcon size={20} aria-hidden />}
          title={statusCopy.title}
          description={
            capability?.storageReason ??
            (capabilityFailed ? T.storageLoadFailedDescription : statusCopy.description)
          }
          value={
            !capability && !capabilityFailed
              ? S.common.loading
              : capability?.storage === "available"
                ? T.available
                : T.unavailable
          }
          good={capability?.storage === "available"}
        />
        <PrivacyRow
          icon={<KeyholeIcon size={20} aria-hidden />}
          title={T.approvalTitle}
          description={T.approvalDescription}
          value={T.always}
          good
        />
        <PrivacyRow
          icon={<LockKeyIcon size={20} aria-hidden />}
          title={T.localOnlyTitle}
          description={T.localOnlyDescription}
          value={
            !capability && !capabilityFailed
              ? S.common.loading
              : capability?.storage === "available"
                ? T.available
                : T.unavailable
          }
          good={capability?.storage === "available"}
        />
        <PrivacyRow
          icon={<IdentificationCardIcon size={20} aria-hidden />}
          title={capability?.l2Available ? T.l2AvailableTitle : T.l2UnavailableTitle}
          description={capability?.l2Reason ?? T.l2UnavailableDescription}
          value={
            !capability && !capabilityFailed
              ? S.common.loading
              : capability?.l2Available
                ? T.available
                : T.unavailable
          }
          good={capability?.l2Available === true}
        />
      </div>
      <section className="mt-9" aria-labelledby="private-profile-activity">
        <h2
          id="private-profile-activity"
          className="text-base font-semibold text-gray-900 dark:text-gray-100"
        >
          {T.activityTitle}
        </h2>
        <p className="mt-2 max-w-2xl text-sm text-gray-500 dark:text-gray-400">
          {T.activityUnavailable}
        </p>
      </section>
    </div>
  );
}

function PrivacyRow({
  icon,
  title,
  description,
  value,
  good,
}: {
  icon: ReactNode;
  title: string;
  description: string;
  value: string;
  good: boolean;
}) {
  return (
    <div className="grid gap-3 py-4 sm:grid-cols-[24px_minmax(0,1fr)_auto] sm:items-start">
      <span className="text-gray-500 dark:text-gray-400">{icon}</span>
      <div>
        <h3 className="text-sm font-medium text-gray-900 dark:text-gray-100">{title}</h3>
        <p className="mt-1 max-w-3xl text-sm text-gray-500 dark:text-gray-400">{description}</p>
      </div>
      <span
        className={`text-xs font-medium ${
          good ? "text-emerald-700 dark:text-emerald-400" : "text-gray-500 dark:text-gray-400"
        }`}
      >
        {value}
      </span>
    </div>
  );
}
