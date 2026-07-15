import { Link, Outlet } from "react-router-dom";
import { useCatalog } from "./catalog-context.tsx";

export function PortalLayout(): JSX.Element {
  const { settings, loading, error } = useCatalog();
  const nav = settings.navigation.length > 0 ? settings.navigation : DEFAULT_NAV;

  return (
    <div>
      <header className="site-header">
        <div className="container">
          <Link to="/" className="brand">{settings.siteName}</Link>
          <nav>
            {nav.map((item) => (
              <Link key={item.path} to={item.path}>{item.label}</Link>
            ))}
          </nav>
          <div className="actions">
            <Link to="/admin" className="btn btn-sm">管理后台</Link>
          </div>
        </div>
      </header>
      <main className="container" style={{ paddingTop: "1.5rem", paddingBottom: "2rem" }}>
        {error ? (
          <div className="alert alert-warn">无法加载游戏清单：{error}。请稍后重试或检查同步状态。</div>
        ) : null}
        {loading ? null : null}
        <Outlet />
      </main>
      <footer className="footer">
        <div className="container">{settings.siteDescription}</div>
      </footer>
    </div>
  );
}

const DEFAULT_NAV = [
  { label: "首页", path: "/" },
  { label: "全部游戏", path: "/games" },
];
