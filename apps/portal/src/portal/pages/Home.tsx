import { Link } from "react-router-dom";
import { useCatalog } from "../catalog-context.tsx";
import { featuredGames, filterVisible, paginate } from "../../lib/catalog.ts";
import { EmptyState, GameCard, Spinner } from "../components.tsx";

export function Home(): JSX.Element {
  const { catalog, settings, loading, error } = useCatalog();

  if (loading) return <Spinner label="加载游戏中…" />;
  if (error || !catalog) return <EmptyState message="暂时没有可显示的游戏。" />;
  if (settings.maintenanceMode) {
    return <div className="alert alert-warn">站点维护中，稍后再来。</div>;
  }

  const visible = filterVisible(catalog.games, settings);
  const featured = featuredGames(visible, settings).slice(0, 6);
  const recent = [...visible].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)).slice(0, 8);
  const categories = Array.from(new Set(visible.flatMap((g) => g.categories)));

  return (
    <div style={{ display: "grid", gap: "2rem" }}>
      <section>
        <h2 className="section-title">推荐游戏</h2>
        {featured.length === 0 ? <EmptyState message="暂无推荐游戏。" /> : (
          <div className="grid">
            {featured.map((g) => <GameCard key={g.id} game={g} />)}
          </div>
        )}
      </section>

      <section>
        <div className="row">
          <h2 className="section-title" style={{ margin: 0 }}>最近更新</h2>
          <span className="spacer" />
          <Link to="/games" className="btn btn-sm">全部游戏 →</Link>
        </div>
        <div className="grid">
          {paginate(recent, 1, 8).items.map((g) => <GameCard key={g.id} game={g} />)}
        </div>
      </section>

      {categories.length > 0 ? (
        <section>
          <h2 className="section-title">分类</h2>
          <div className="row">
            {categories.map((c) => (
              <Link key={c} to={`/categories/${encodeURIComponent(c)}`} className="badge" style={{ padding: "0.4rem 0.8rem" }}>{c}</Link>
            ))}
          </div>
        </section>
      ) : null}
    </div>
  );
}
