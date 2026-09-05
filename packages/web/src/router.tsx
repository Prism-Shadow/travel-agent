/**
 * Router (react-router v7 declarative style): /login is public; all other routes go through
 * the RequireAuth guard (redirects to /login when not authenticated) and are wrapped in
 * ProjectProvider + AppLayout.
 */
import { BrowserRouter, Navigate, Route, Routes } from "react-router";
import { useAuth } from "./state/auth";
import { ProjectProvider } from "./state/project";
import { SessionsProvider } from "./state/sessions";
import { TripsProvider } from "./state/trips";
import { AppLayout } from "./components/layout/app-layout";
import { LoginPage } from "./pages/login";
import { ChatPage } from "./features/chat/chat-page";

import { AdminUsersPage } from "./features/admin/admin-users-page";
import { ModelsPage } from "./features/models/models-page";
import { PrivateProfilePage } from "./features/private-profile/private-profile-page";
import { TripsOverviewPage } from "./features/trips/trips-overview-page";
import { TripPage } from "./features/trips/trip-page";
import { SavedPage } from "./features/saved/saved-page";

/** Route guard: shows blank while initializing, redirects to /login when not authenticated. */
function RequireAuth() {
  const { user } = useAuth();
  if (user === undefined) return null; // GET /api/me is still initializing
  if (user === null) return <Navigate to="/login" replace />;
  return (
    <ProjectProvider>
      <SessionsProvider>
        <TripsProvider>
          <AppLayout />
        </TripsProvider>
      </SessionsProvider>
    </ProjectProvider>
  );
}

/** When already logged in, visiting /login redirects straight to the chat page. */
function LoginRoute() {
  const { user } = useAuth();
  if (user) return <Navigate to="/chat" replace />;
  return <LoginPage />;
}

export function AppRouter() {
  return (
    <BrowserRouter>
      <Routes>
        <Route path="/login" element={<LoginRoute />} />
        <Route element={<RequireAuth />}>
          <Route index element={<Navigate to="/chat" replace />} />
          <Route path="/chat/:sessionId?" element={<ChatPage />} />
          <Route path="/trips" element={<TripsOverviewPage />} />
          <Route path="/trips/:tripId" element={<TripPage />} />
          <Route path="/saved" element={<SavedPage />} />

          <Route path="/models" element={<ModelsPage />} />
          <Route path="/settings/private-profile" element={<PrivateProfilePage />} />
          <Route path="/admin/users" element={<AdminUsersPage />} />
          <Route path="*" element={<Navigate to="/chat" replace />} />
        </Route>
      </Routes>
    </BrowserRouter>
  );
}
