import { Link, useParams } from "react-router-dom";
import { useCatalog } from "../catalog-context.tsx";
import { filterVisible } from "../../lib/catalog.ts";
import { GameFrame } from "./GameFrame.tsx";
import { EmptyState, Spinner, StatusBadge } from "../components.tsx";

export function GameDetail(): JSX.Element {
  const { gameId } = useParams();
  const { catalog, settings, loading, error } = useCatalog();

  if (loading) return <Spinner label="加载游戏中…" />;
  if (error || !catalog) return <EmptyState message="无法加载游戏。" />;

  const game = catalog.games.find((g) => g.id === gameId);
  if (!game) {
    return (
      <div className="state error">
        ⚠ 找不到游戏 “{gameId}”。
        <div style={{ marginTop: "1rem" }}>
          <Link to="/games" className="btn btn-sm">返回游戏列表</Link>
        </div>
      </div>
    );
  }

  // Archived games are not shown in lists; keep their detail pages when allowed.
  const visible = filterVisible(catalog.games, settings);
  const isVisible = visible.some((g) => g.id === game.id);
  if (!isVisible && !(game.status === "archived" && settings.showArchivedGamePages)) {
    return (
      <div className="state error">
        ⚠ 该游戏当前不可访问。
        <div style={{ marginTop: "1rem" }}>
          <Link to="/games" className="btn btn-sm">返回游戏列表</Link>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="row">
        <h1 className="section-title" style={{ margin: 0 }}>{game.title}</h1>
        <StatusBadge status={game.status} />
        <span className="muted">v{game.version}</span>
      </div>
      <p className="muted">{game.description}</p>

      <GameFrame game={game} />

      <div className="row">
        {game.categories.map((c) => (
          <Link key={c} to={`/categories/${encodeURIComponent(c)}`} className="badge">{c}</Link>
        ))}
        {game.tags.map((t) => <span key={t} className="badge">{t}</span>)}
      </div>

      {game.seo?.description ? <p className="muted">{game.seo.description}</p> : null}
    </div>
  );
}
