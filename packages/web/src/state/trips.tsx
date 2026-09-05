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
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(false);
  const [loadedProjectId, setLoadedProjectId] = useState<string | null>(null);
  const requestId = useRef(0);
  const scope = useMemo(() => ({ projectId }), [projectId]);
  const activeScope = useRef<typeof scope | null>(scope);
  activeScope.current = scope;

  const reload = useCallback(async () => {
    if (activeScope.current !== scope) return;
    const request = ++requestId.current;
    if (!projectId) {
      setTrips([]);
      setLoading(false);
      setError(false);
      setLoadedProjectId(null);
      return;
    }
    setLoading(true);
    setError(false);
    try {
      const response = await api.listTrips(projectId);
      if (activeScope.current !== scope || request !== requestId.current) return;
      setTrips(response.trips);
    } catch {
      if (activeScope.current !== scope || request !== requestId.current) return;
      setError(true);
    } finally {
      if (activeScope.current === scope && request === requestId.current) {
        setLoadedProjectId(projectId);
        setLoading(false);
      }
    }
  }, [projectId, scope]);

  // Switching Project clears the list in the same tick as the refetch starts: a render
  // carrying the new Project's id beside the old Project's trips would show one person's
  // journeys under another's name, however briefly.
  useEffect(() => {
    activeScope.current = scope;
    setTrips([]);
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
        // Supersede every pre-mutation snapshot, including the first load. Refetching also
        // settles loading if that superseded request was the Project's initial index.
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

  const value = useMemo<TripsContextValue>(
    () => ({
      trips: loadedProjectId === projectId ? trips : [],
      loading: projectsLoading || loading || loadedProjectId !== projectId,
      error: loadedProjectId === projectId && error,
      byId: new Map(loadedProjectId === projectId ? trips.map((t) => [t.tripId, t]) : []),
      reload,
      create,
      patch,
      remove,
    }),
    [
      trips,
      loading,
      projectsLoading,
      error,
      loadedProjectId,
      projectId,
      reload,
      create,
      patch,
      remove,
    ],
  );

  return <TripsContext.Provider value={value}>{children}</TripsContext.Provider>;
}

export function useTrips(): TripsContextValue {
  const ctx = useContext(TripsContext);
  if (!ctx) throw new Error("useTrips must be used within a TripsProvider");
  return ctx;
}
