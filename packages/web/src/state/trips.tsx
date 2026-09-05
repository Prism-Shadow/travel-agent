/**
 * Trip list for the current Project — the sidebar's first-class objects.
 *
 * A Trip owns a directory and gathers a journey's conversations; a conversation belongs to at
 * most one Trip and may belong to none (a "scratch" conversation, which is a first-class state
 * rather than a defect). Membership lives on the session row (`SessionInfo.tripId`), so the
 * grouping is computed from the session list this context does not own — `useSessions()` stays
 * the single source of conversations, and this context only adds the Trips themselves.
 *
 * Mutations go through here rather than through components so that one store applies the
 * server's answer: every one of them returns the server's row and replaces the local copy,
 * because a Trip's identity can also change underneath the UI (a rename from another window,
 * a folder the person moved away).
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import type { ReactNode } from "react";
import type {
  TripCreateRequest,
  TripPatchRequest,
  TripSummary,
} from "@prismshadow/penguin-server/api";
import * as api from "../api/endpoints";
import { useProject } from "./project";

interface TripsContextValue {
  trips: TripSummary[];
  loading: boolean;
  error: boolean;
  /** Trip by id, for a conversation that knows only its `tripId`. */
  byId: ReadonlyMap<string, TripSummary>;
  reload: () => Promise<void>;
  create: (body?: TripCreateRequest) => Promise<TripSummary>;
  patch: (tripId: string, body: TripPatchRequest) => Promise<TripSummary>;
  remove: (tripId: string) => Promise<void>;
}

const TripsContext = createContext<TripsContextValue | null>(null);

/** Display name of a Trip; a Trip with no name of its own is honestly untitled, never blank. */
export function tripDisplayName(trip: TripSummary, untitled: string): string {
  return trip.name.trim() || trip.destination.trim() || untitled;
}

export function TripsProvider({ children }: { children: ReactNode }) {
  const { currentProject, projectsLoading } = useProject();
  const projectId = currentProject?.projectId ?? null;
  const [trips, setTrips] = useState<TripSummary[]>([]);
  const [error, setError] = useState(false);
  /**
   * The Project whose index has settled — answered or failed — at least once. "Loading" is
   * derived from it: true until this Project has an answer, and never again for that Project
   * while it stays current. A refetch after a mutation is a *revalidation*: the list already on
   * screen stays put and is replaced in place when the answer lands, so deleting a Trip from the
   * sidebar does not flash the overview page back to a skeleton.
   */
  const [settledProjectId, setSettledProjectId] = useState<string | null>(null);
  const settledRef = useRef<string | null>(null);
  const requestId = useRef(0);
  const scope = useMemo(() => ({ projectId }), [projectId]);
  const activeScope = useRef<typeof scope | null>(scope);
  activeScope.current = scope;

  const reload = useCallback(async () => {
    if (activeScope.current !== scope) return;
    const request = ++requestId.current;
    if (!projectId) {
      setTrips([]);
      setError(false);
      settledRef.current = null;
      setSettledProjectId(null);
      return;
    }
    const revalidating = settledRef.current === projectId;
    try {
      const response = await api.listTrips(projectId);
      if (activeScope.current !== scope || request !== requestId.current) return;
      setTrips(response.trips);
      setError(false);
    } catch {
      if (activeScope.current !== scope || request !== requestId.current) return;
      // A failed revalidation keeps the list it has — the mutation that prompted it already
      // succeeded and was applied — so only a first load with nothing to show reports an error.
      if (!revalidating) setError(true);
    } finally {
      if (activeScope.current === scope && request === requestId.current) {
        settledRef.current = projectId;
        setSettledProjectId(projectId);
      }
    }
  }, [projectId, scope]);

  // Switching Project clears the list in the same tick as the refetch starts: a render
  // carrying the new Project's id beside the old Project's trips would show one person's
  // journeys under another's name, however briefly. The settled marker is cleared with it, so
  // the switch always goes through a real first load, even back to a Project seen before.
  useEffect(() => {
    activeScope.current = scope;
    setTrips([]);
    setError(false);
    settledRef.current = null;
    setSettledProjectId(null);
    void reload();
    return () => {
      requestId.current++;
      if (activeScope.current === scope) activeScope.current = null;
    };
  }, [reload, scope]);

  const create = useCallback(
    async (body: TripCreateRequest = {}) => {
      if (!projectId) throw new Error("No current project");
      const { trip } = await api.createTrip(projectId, body);
      if (activeScope.current === scope) {
        setTrips((prev) => [trip, ...prev.filter((t) => t.tripId !== trip.tripId)]);
        // Supersede every pre-mutation snapshot, including a first load still in flight: its
        // answer would predate this Trip. The refetch settles the index either way.
        void reload();
      }
      return trip;
    },
    [projectId, reload, scope],
  );

  const patch = useCallback(
    async (tripId: string, body: TripPatchRequest) => {
      const { trip } = await api.patchTrip(tripId, body);
      if (activeScope.current === scope) {
        setTrips((prev) => prev.map((t) => (t.tripId === tripId ? trip : t)));
        void reload();
      }
      return trip;
    },
    [reload, scope],
  );

  const remove = useCallback(
    async (tripId: string) => {
      await api.deleteTrip(tripId);
      if (activeScope.current === scope) {
        setTrips((prev) => prev.filter((t) => t.tripId !== tripId));
        void reload();
      }
    },
    [reload, scope],
  );

  const settled = settledProjectId === projectId;
  const value = useMemo<TripsContextValue>(
    () => ({
      trips: settled ? trips : [],
      loading: projectsLoading || !settled,
      error: settled && error,
      byId: new Map(settled ? trips.map((t) => [t.tripId, t]) : []),
      reload,
      create,
      patch,
      remove,
    }),
    [trips, projectsLoading, error, settled, reload, create, patch, remove],
  );

  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>;
}

export function useTrips(): TripsContextValue {
  const ctx = useContext(TripsContext);
  if (!ctx) throw new Error("useTrips must be used within a TripsProvider");
  return ctx;
}
