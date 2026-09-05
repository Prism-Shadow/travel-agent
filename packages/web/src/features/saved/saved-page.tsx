/** Saved conversations across every Agent and Trip in the current Project. */
import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router";
import { BookmarkSimpleIcon } from "@phosphor-icons/react/dist/csr/BookmarkSimple";
import { DotsThreeIcon } from "@phosphor-icons/react/dist/csr/DotsThree";
import { ChatCircleIcon } from "@phosphor-icons/react/dist/csr/ChatCircle";
import type { SessionInfo } from "@prismshadow/penguin-server/api";
import * as api from "../../api/endpoints";
import { S } from "../../lib/strings";
import { apiErrorText } from "../../lib/api-error";
import { formatDateTime, formatMonthDay } from "../../lib/format";
import { useProject } from "../../state/project";
import { useAuth } from "../../state/auth";
import { useSessions } from "../../state/sessions";
import { useLocale } from "../../state/locale";
import { tripDisplayName, useTrips } from "../../state/trips";
import { Button } from "../../components/ui/button";
import { Dropdown } from "../../components/ui/dropdown";
import { Input } from "../../components/ui/input";
import { Modal } from "../../components/ui/modal";
import { ConfirmModal } from "../../components/ui/confirm-modal";
import { SkeletonList } from "../../components/ui/skeleton";
import { toastError } from "../../components/ui/toast";
import { desktopBrowserBridge } from "../../lib/desktop-bridge";
import { clearDraft, sessionDraftKey } from "../chat/draft-cache";

export function SavedPage() {
  const { currentProject, agents, agentsLoading, projectsLoading } = useProject();
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto max-w-5xl px-5 py-8 sm:px-8 sm:py-10">
        <header className="mb-8">
          <div className="mb-4 flex h-12 w-12 items-center justify-center rounded-2xl bg-gray-100 text-gray-700 dark:bg-gray-800 dark:text-gray-200">
            <BookmarkSimpleIcon size={25} aria-hidden />
          </div>
          <h1 className="text-3xl font-semibold tracking-tight">{S.saved.title}</h1>
          <p className="mt-3 text-sm leading-6 text-gray-500 dark:text-gray-400">
            {S.saved.description}
          </p>
        </header>
        {projectsLoading || agentsLoading || !currentProject ? (
          <SkeletonList rows={4} />
        ) : (
          <SavedList
            key={`${currentProject.projectId}:${agents.map((agent) => agent.agentId).join(",")}`}
            projectId={currentProject.projectId}
          />
        )}
      </div>
    </div>
  );
}

function SavedList({ projectId }: { projectId: string }) {
  const { user } = useAuth();
  const { agents, setCurrentAgentId } = useProject();
  const {
    sessions,
    loading,
    countsByAgent,
    isLoadedFor,
    hasMoreFor,
    loadMoreFor,
    replace,
    remove,
    reload,
  } = useSessions();
  const { trips } = useTrips();
  const { locale } = useLocale();
  const [started, setStarted] = useState(false);
  const [pending, setPending] = useState(false);
  const [failed, setFailed] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [menuId, setMenuId] = useState<string | null>(null);
  const [renaming, setRenaming] = useState<SessionInfo | null>(null);
  const [title, setTitle] = useState("");
  const [deleting, setDeleting] = useState<SessionInfo | null>(null);
  const initialRequest = useRef(false);
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

  const countsKnown = agents.every((agent) => countsByAgent.has(agent.agentId));
  const rows = useMemo(
    () =>
      sessions
        .filter((session) => session.projectId === projectId && session.archived)
        .sort(
          (a, b) =>
            b.createdAt.localeCompare(a.createdAt) || b.sessionId.localeCompare(a.sessionId),
        ),
    [sessions, projectId],
  );
  const total = Math.max(
    rows.length,
    agents.reduce((sum, agent) => sum + (countsByAgent.get(agent.agentId)?.archived ?? 0), 0),
  );
  const more = agents.some((agent) => hasMoreFor(agent.agentId, "archived"));

  const fetchPage = async (ids: string[]) => {
    setPending(true);
    setFailed(false);
    try {
      const success = await loadMoreFor(ids, "archived");
      if (mounted.current) setFailed(!success);
    } finally {
      if (mounted.current) setPending(false);
    }
  };

  useEffect(() => {
    if (loading || !countsKnown || initialRequest.current) return;
    initialRequest.current = true;
    setStarted(true);
    void fetchPage(
      agents
        .filter((agent) => !isLoadedFor(agent.agentId, "archived"))
        .map((agent) => agent.agentId),
    );
    // The first request is once per Project/Agent set. Later pages are explicitly requested.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loading, countsKnown, agents, isLoadedFor]);

  const refreshAfterMutation = async () => {
    // Removing a saved row shifts server offsets. Reset category cursors before loading more.
    await reload();
  };
  const unsave = async (session: SessionInfo) => {
    setBusyId(session.sessionId);
    try {
      const result = await api.patchSession(session.sessionId, { archived: false });
      if (!mounted.current) return;
      replace(result.session);
      await refreshAfterMutation();
    } catch (error) {
      toastError(apiErrorText(error));
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };
  const rename = async () => {
    if (!renaming || !title.trim() || busyId) return;
    setBusyId(renaming.sessionId);
    try {
      const result = await api.patchSession(renaming.sessionId, { title: title.trim() });
      if (!mounted.current) return;
      replace(result.session);
      setRenaming(null);
    } catch (error) {
      toastError(apiErrorText(error));
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };
  const deleteConversation = async () => {
    if (!deleting || busyId) return;
    setBusyId(deleting.sessionId);
    try {
      await api.deleteSession(deleting.sessionId);
      void desktopBrowserBridge()
        ?.dropSession(deleting.sessionId)
        .catch(() => {});
      if (user) clearDraft(sessionDraftKey(user.userId, deleting.sessionId));
      if (!mounted.current) return;
      remove(deleting.sessionId);
      setDeleting(null);
      await refreshAfterMutation();
    } catch (error) {
      toastError(apiErrorText(error));
    } finally {
      if (mounted.current) setBusyId(null);
    }
  };
  const showError = !loading && (!countsKnown || failed);
  const initialLoading = !showError && (!started || ((loading || pending) && rows.length === 0));

  return (
    <>
      {countsKnown && !initialLoading && (
        <p className="mb-4 text-xs font-medium text-gray-400">{S.saved.count(total)}</p>
      )}
      {initialLoading ? (
        <SkeletonList rows={4} />
      ) : rows.length > 0 ? (
        <ul className="divide-y divide-gray-100 rounded-2xl border border-gray-200 bg-white dark:divide-gray-800 dark:border-gray-800 dark:bg-gray-900/30">
          {rows.map((session) => {
            const trip = trips.find((entry) => entry.tripId === session.tripId);
            const tripName = session.tripId
              ? trip
                ? tripDisplayName(trip, S.trip.untitled)
                : S.trip.untitled
              : S.trip.scratch;
            return (
              <li
                key={session.sessionId}
                data-saved-conversation={session.sessionId}
                className="flex items-center gap-3 p-4 sm:gap-4 sm:px-5"
              >
                <span className="hidden h-10 w-10 shrink-0 items-center justify-center rounded-xl bg-gray-50 text-gray-400 sm:flex dark:bg-gray-800">
                  <ChatCircleIcon size={21} aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <Link
                    to={`/chat/${session.sessionId}`}
                    state={{ returnTo: "/saved" }}
                    onClick={() => setCurrentAgentId(session.agentId)}
                    className="block break-words text-sm font-medium text-gray-900 hover:underline dark:text-gray-100"
                  >
                    {session.title || S.chat.defaultSessionTitle}
                  </Link>
                  <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-gray-400">
                    <span className="max-w-full truncate">{tripName}</span>
                    <time dateTime={session.createdAt} title={formatDateTime(session.createdAt)}>
                      {S.saved.createdOn(formatMonthDay(session.createdAt, locale))}
                    </time>
                  </div>
                </div>
                <Button
                  variant="ghost"
                  size="icon"
                  disabled={busyId !== null}
                  aria-label={S.chat.unarchiveSession}
                  title={S.chat.unarchiveSession}
                  onClick={() => void unsave(session)}
                >
                  <BookmarkSimpleIcon size={19} weight="fill" aria-hidden />
                </Button>
                <Dropdown
                  open={menuId === session.sessionId}
                  setOpen={(open) => setMenuId(open ? session.sessionId : null)}
                  portal={{ direction: "down", align: "right" }}
                  menuClass="w-44 rounded-xl! p-1!"
                  button={
                    <Button
                      variant="ghost"
                      size="icon"
                      aria-label={S.saved.actions}
                      title={S.saved.actions}
                      aria-haspopup="menu"
                      aria-expanded={menuId === session.sessionId}
                      onClick={() =>
                        setMenuId(menuId === session.sessionId ? null : session.sessionId)
                      }
                    >
                      <DotsThreeIcon size={20} aria-hidden />
                    </Button>
                  }
                >
                  <div role="menu" aria-label={S.saved.actions}>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm hover:bg-gray-100 dark:hover:bg-gray-800"
                      onClick={() => {
                        setMenuId(null);
                        setTitle(session.title ?? "");
                        setRenaming(session);
                      }}
                    >
                      {S.chat.renameSession}
                    </button>
                    <button
                      type="button"
                      role="menuitem"
                      className="w-full rounded-lg px-3 py-2 text-left text-sm text-red-600 hover:bg-red-50 dark:text-red-400 dark:hover:bg-red-950"
                      onClick={() => {
                        setMenuId(null);
                        setDeleting(session);
                      }}
                    >
                      {S.chat.deleteSession}
                    </button>
                  </div>
                </Dropdown>
              </li>
            );
          })}
        </ul>
      ) : (
        !showError && (
          <div className="rounded-3xl border border-dashed border-gray-200 px-6 py-16 text-center dark:border-gray-800">
            <BookmarkSimpleIcon
              size={35}
              className="mx-auto mb-5 text-gray-300 dark:text-gray-600"
              aria-hidden
            />
            <h2 className="text-lg font-medium">{S.saved.emptyTitle}</h2>
            <p className="mx-auto mt-3 max-w-sm text-sm leading-6 text-gray-500">
              {S.saved.emptyDescription}
            </p>
          </div>
        )
      )}
      {showError && (
        <div role="alert" className="mt-4 flex flex-wrap items-center gap-3 text-sm text-gray-500">
          <p>{S.saved.loadFailed}</p>
          <Button
            disabled={pending}
            onClick={() => {
              if (!countsKnown) void reload();
              else
                void fetchPage(
                  agents
                    .filter((agent) => hasMoreFor(agent.agentId, "archived"))
                    .map((agent) => agent.agentId),
                );
            }}
          >
            {S.saved.retry}
          </Button>
        </div>
      )}
      {more && !showError && !initialLoading && (
        <div className="mt-6 flex justify-center">
          <Button
            disabled={pending || loading || busyId !== null}
            onClick={() =>
              void fetchPage(
                agents
                  .filter((agent) => hasMoreFor(agent.agentId, "archived"))
                  .map((agent) => agent.agentId),
              )
            }
          >
            {pending ? S.common.loading : S.saved.more}
          </Button>
        </div>
      )}
      <Modal
        open={renaming !== null}
        title={S.chat.renameSession}
        onClose={() => {
          if (!busyId) setRenaming(null);
        }}
        footer={
          <>
            <Button disabled={busyId !== null} onClick={() => setRenaming(null)}>
              {S.common.cancel}
            </Button>
            <Button
              variant="primary"
              disabled={busyId !== null || !title.trim()}
              onClick={() => void rename()}
            >
              {S.common.save}
            </Button>
          </>
        }
      >
        <Input
          label={S.chat.renameSessionLabel}
          value={title}
          autoFocus
          maxLength={120}
          onChange={(event) => setTitle(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") void rename();
          }}
        />
      </Modal>
      <ConfirmModal
        open={deleting !== null}
        title={S.chat.deleteSession}
        confirmLabel={S.common.delete}
        busy={busyId !== null}
        onClose={() => {
          if (!busyId) setDeleting(null);
        }}
        onConfirm={() => void deleteConversation()}
      >
        <p className="text-sm leading-6 text-gray-600 dark:text-gray-300">
          {deleting
            ? S.chat.deleteSessionConfirm(deleting.title || S.chat.defaultSessionTitle)
            : ""}
        </p>
      </ConfirmModal>
    </>
  );
}
