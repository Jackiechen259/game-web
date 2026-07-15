import { Link, NavLink, Outlet, useNavigate } from "react-router-dom";
import type { Role } from "@game-platform/admin-types";
import { hasRole } from "@game-platform/admin-types";
import { useAuth } from "./AuthContext.tsx";

const NAV_ITEMS: { to: string; label: string; minRole: Role }[] = [
  { to: "/admin", label: "概览", minRole: "viewer" },
  { to: "/admin/games", label: "游戏管理", minRole: "viewer" },
  { to: "/admin/publishing", label: "发布", minRole: "viewer" },
  { to: "/admin/deployments", label: "部署", minRole: "viewer" },
  { to: "/admin/releases", label: "发布历史", minRole: "viewer" },
  { to: "/admin/settings", label: "站点设置", minRole: "viewer" },
  { to: "/admin/audit", label: "审计日志", minRole: "viewer" },
];

export function AdminLayout(): JSX.Element {
  const { user, loading, logout } = useAuth();
  const navigate = useNavigate();

  if (loading) {
    return <div className="center"><span className="spinner" /> 加载会话…</div>;
  }
  if (!user) {
    // AuthProvider should redirect, but guard just in case.
    void navigate("/admin/login");
    return <div className="center">重定向到登录…</div>;
  }

  const handleLogout = async (): Promise<void> => {
    await logout();
    navigate("/admin/login");
  };

  return (
    <div className="admin-layout">
      <aside className="admin-sidebar">
        <div className="brand">管理后台</div>
        <nav>
          {NAV_ITEMS.filter((item) => hasRole(user.role, item.minRole)).map((item) => (
            <NavLink key={item.to} to={item.to} end={item.to === "/admin"}>
              {item.label}
            </NavLink>
          ))}
        </nav>
        <div style={{ marginTop: "1rem", fontSize: "0.8rem" }} className="muted">
          {user.login}（{user.role}）
        </div>
        <button className="btn btn-sm" style={{ marginTop: "0.5rem" }} onClick={handleLogout}>注销</button>
        <Link to="/" style={{ display: "block", marginTop: "0.5rem", fontSize: "0.8rem" }}>← 返回门户</Link>
      </aside>
      <main className="admin-main">
        <Outlet />
      </main>
    </div>
  );
}
