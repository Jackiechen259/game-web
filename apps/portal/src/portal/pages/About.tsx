import { useCatalog } from "../catalog-context.tsx";

export function About(): JSX.Element {
  const { settings } = useCatalog();
  return (
    <div style={{ maxWidth: 720 }}>
      <h1 className="section-title">关于</h1>
      <p>{settings.siteDescription}</p>
      <p className="muted">
        本站游戏来自独立的 GitHub 游戏仓库，构建时同步到门户。浏览器运行时不直接访问 GitHub API，
        游戏通过隔离的 iframe 运行，样式与运行环境互不影响。
      </p>
      <p className="muted">如需管理游戏，请访问 <a href="/admin">/admin</a> 后台。</p>
    </div>
  );
}
