import { Link } from "react-router-dom";
import { adminApi } from "../../lib/admin-api.ts";
import { useAsync, PageHeader } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function Dashboard(): JSX.Element {
  const { data, loading, error } = useAsync(() => adminApi.dashboard(), []);

  if (loading) return <Spinner label="加载概览…" />;
  if (error || !data) return <EmptyState message={error ?? "无法加载概览。"} />;

  const stats = [
    { label: "游戏总数", value: data.total },
    { label: "已发布", value: data.published },
    { label: "Beta", value: data.beta },
    { label: "开发中", value: data.development },
    { label: "归档", value: data.archived },
    { label: "草稿", value: data.drafts },
    { label: "失败构建", value: data.failedBuilds },
  ];

  return (
    <div>
      <PageHeader title="概览" actions={<Link to="/admin/games/new" className="btn btn-primary btn-sm">新增游戏</Link>} />
      <div className="grid" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(140px, 1fr))", marginBottom: "1.5rem" }}>
        {stats.map((s) => (
          <div key={s.label} className="game-card">
            <div className="body" style={{ textAlign: "center" }}>
              <div style={{ fontSize: "1.6rem", fontWeight: 700 }}>{s.value}</div>
              <div className="muted">{s.label}</div>
            </div>
          </div>
        ))}
      </div>

      <section>
        <h2 className="section-title">最近发布</h2>
        {data.recentReleases.length === 0 ? <EmptyState message="暂无发布记录。" /> : (
          <table className="table">
            <thead><tr><th>时间</th><th>状态</th><th>PR</th><th>dist commit</th></tr></thead>
            <tbody>
              {data.recentReleases.map((r) => (
                <tr key={r.id}>
                  <td>{new Date(r.publishedAt).toLocaleString()}</td>
                  <td>{r.status}</td>
                  <td>{r.pullRequestNumber ?? "-"}</td>
                  <td className="muted">{r.distCommit?.slice(0, 7) ?? "-"}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section style={{ marginTop: "1.5rem" }}>
        <h2 className="section-title">最近修改</h2>
        <div className="grid">
          {data.recentlyModified.map((g) => (
            <Link key={g.id} to={`/admin/games/${g.id}`} className="game-card">
              <div className="cover" style={{ backgroundImage: `url(/${g.cover})` }} />
              <div className="body">
                <div className="title">{g.title}</div>
                <div className="meta"><span className="badge">{g.status}</span> <span className="badge">v{g.version}</span></div>
              </div>
            </Link>
          ))}
        </div>
      </section>
    </div>
  );
}
