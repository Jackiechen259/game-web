import { useMemo, useState } from "react";
import { useParams, useSearchParams } from "react-router-dom";
import { useCatalog } from "../catalog-context.tsx";
import { filterVisible, paginate, searchGames } from "../../lib/catalog.ts";
import { EmptyState, GameCard, Pagination, Spinner } from "../components.tsx";

export function GamesList(): JSX.Element {
  const { gameId } = useParams(); // not used; kept for parity
  void gameId;
  const { catalog, settings, loading, error } = useCatalog();
  const [params, setParams] = useSearchParams();
  const q = params.get("q") ?? "";
  const category = params.get("category") ?? "";
  const page = Math.max(1, parseInt(params.get("page") ?? "1", 10) || 1);

  const [query, setQuery] = useState(q);

  const result = useMemo(() => {
    if (!catalog) return { items: [], total: 0, pages: 1 };
    let games = filterVisible(catalog.games, settings);
    if (category) games = games.filter((g) => g.categories.includes(category));
    if (q) games = searchGames(games, q);
    return paginate(games, page, settings.gamesPerPage);
  }, [catalog, settings, category, q, page]);

  if (loading) return <Spinner label="加载游戏中…" />;
  if (error || !catalog) return <EmptyState message="无法加载游戏列表。" />;

  const categories = Array.from(new Set(filterVisible(catalog.games, settings).flatMap((g) => g.categories)));

  return (
    <div style={{ display: "grid", gap: "1rem" }}>
      <div className="row">
        <input
          className="field" // reuses input styling
          style={{ maxWidth: 360, padding: "0.5rem 0.7rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }}
          placeholder="搜索游戏…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              const next = new URLSearchParams(params);
              if (query) next.set("q", query); else next.delete("q");
              next.delete("page");
              setParams(next);
            }
          }}
        />
        <select
          value={category}
          onChange={(e) => {
            const next = new URLSearchParams(params);
            if (e.target.value) next.set("category", e.target.value); else next.delete("category");
            next.delete("page");
            setParams(next);
          }}
          style={{ padding: "0.5rem 0.7rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }}
        >
          <option value="">全部分类</option>
          {categories.map((c) => <option key={c} value={c}>{c}</option>)}
        </select>
      </div>

      {result.items.length === 0 ? (
        <EmptyState message={q || category ? "没有符合条件的游戏。" : "暂无游戏。"} />
      ) : (
        <div className="grid">
          {result.items.map((g) => <GameCard key={g.id} game={g} />)}
        </div>
      )}

      <Pagination page={page} pages={result.pages} onChange={(p) => { const next = new URLSearchParams(params); next.set("page", String(p)); setParams(next); }} />
    </div>
  );
}
