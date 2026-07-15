import { Link } from "react-router-dom";
import type { GameMetadata, GameStatus } from "@game-platform/game-schema";

export function Spinner({ label }: { label?: string }): JSX.Element {
  return (
    <div className="state">
      <span className="spinner" aria-hidden /> {label ?? "Loading…"}
    </div>
  );
}

export function ErrorState({ message }: { message: string }): JSX.Element {
  return <div className="state error">⚠ {message}</div>;
}

export function EmptyState({ message }: { message: string }): JSX.Element {
  return <div className="empty">{message}</div>;
}

export function StatusBadge({ status }: { status: GameStatus }): JSX.Element {
  const cls = `badge badge-${status}`;
  return <span className={cls}>{status}</span>;
}

export function GameCard({ game }: { game: GameMetadata }): JSX.Element {
  return (
    <Link to={`/games/${game.id}`} className="game-card" aria-label={`Play ${game.title}`}>
      <div className="cover" style={{ backgroundImage: `url(/${game.cover})` }} role="img" aria-label={`${game.title} cover`} />
      <div className="body">
        <div className="title">{game.title}</div>
        <div className="meta">
          <StatusBadge status={game.status} />
          {game.categories.slice(0, 2).map((c) => (
            <span key={c} className="badge">{c}</span>
          ))}
        </div>
      </div>
    </Link>
  );
}

export function Pagination({ page, pages, onChange }: { page: number; pages: number; onChange: (p: number) => void }): JSX.Element | null {
  if (pages <= 1) return null;
  return (
    <div className="row" style={{ justifyContent: "center", marginTop: "1rem" }}>
      <button className="btn btn-sm" disabled={page <= 1} onClick={() => onChange(page - 1)}>上一页</button>
      <span className="muted">第 {page} / {pages} 页</span>
      <button className="btn btn-sm" disabled={page >= pages} onClick={() => onChange(page + 1)}>下一页</button>
    </div>
  );
}
