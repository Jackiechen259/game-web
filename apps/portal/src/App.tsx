import { Navigate, Route, Routes } from "react-router-dom";
import { CatalogProvider } from "./portal/catalog-context.tsx";
import { PortalLayout } from "./portal/Layout.tsx";
import { Home } from "./portal/pages/Home.tsx";
import { GamesList } from "./portal/pages/GamesList.tsx";
import { GameDetail } from "./portal/pages/GameDetail.tsx";
import { About } from "./portal/pages/About.tsx";
import { NotFound } from "./portal/pages/NotFound.tsx";
import { AuthProvider, useAuth } from "./admin/AuthContext.tsx";
import { AdminLayout } from "./admin/AdminLayout.tsx";
import { Login } from "./admin/pages/Login.tsx";
import { Dashboard } from "./admin/pages/Dashboard.tsx";
import { AdminGamesList } from "./admin/pages/GamesList.tsx";
import { GameEdit } from "./admin/pages/GameEdit.tsx";
import { Preview } from "./admin/pages/Preview.tsx";
import { Publishing } from "./admin/pages/Publishing.tsx";
import { Deployments } from "./admin/pages/Deployments.tsx";
import { Releases } from "./admin/pages/Releases.tsx";
import { Settings } from "./admin/pages/Settings.tsx";
import { Audit } from "./admin/pages/Audit.tsx";
import { ToastProvider } from "./admin/ui.tsx";
import { Spinner } from "./portal/components.tsx";

function ProtectedAdmin(): JSX.Element {
  const { user, loading } = useAuth();
  if (loading) {
    return (
      <div className="center">
        <Spinner label="加载会话…" />
      </div>
    );
  }
  if (!user) return <Navigate to="/admin/login" replace />;
  return <AdminLayout />;
}

export function App(): JSX.Element {
  return (
    <ToastProvider>
      <AuthProvider>
        <CatalogProvider>
          <Routes>
            <Route element={<PortalLayout />}>
              <Route path="/" element={<Home />} />
              <Route path="/games" element={<GamesList />} />
              <Route path="/games/:gameId" element={<GameDetail />} />
              <Route path="/categories/:category" element={<GamesList />} />
              <Route path="/about" element={<About />} />
            </Route>

            <Route path="/admin/login" element={<Login />} />
            <Route path="/admin" element={<ProtectedAdmin />}>
              <Route index element={<Dashboard />} />
              <Route path="games" element={<AdminGamesList />} />
              <Route path="games/new" element={<GameEdit />} />
              <Route path="games/:gameId" element={<GameEdit />} />
              <Route path="games/:gameId/preview" element={<Preview />} />
              <Route path="publishing" element={<Publishing />} />
              <Route path="deployments" element={<Deployments />} />
              <Route path="releases" element={<Releases />} />
              <Route path="settings" element={<Settings />} />
              <Route path="audit" element={<Audit />} />
            </Route>

            <Route path="*" element={<NotFound />} />
          </Routes>
        </CatalogProvider>
      </AuthProvider>
    </ToastProvider>
  );
}
