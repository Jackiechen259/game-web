import { useState } from "react";
import { Link } from "react-router-dom";
import { adminApi } from "../../lib/admin-api.ts";
import { can, type Permission } from "@game-platform/admin-types";
import { useAuth } from "../AuthContext.tsx";
import { useAsync, PageHeader } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function AdminGamesList(): JSX.Element {
  const { user } = useAuth();
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const { data, loading, error, reload } = useAsync(
    () => adminApi.listGames({ q, status, pageSize: 100 }),
    [q, status],
  );

  const canWrite = can(user?.role, "write" as Permission);

  if (loading && !data) return <Spinner label="加载游戏列表…" />;
  if (error) return <EmptyState message={error} />;

  return (
    <div>
      <PageHeader
        title="游戏管理"
        actions={canWrite ? <Link to="/admin/games/new" className="btn btn-primary btn-sm">新增游戏</Link> : undefined}
      />
      <div className="row" style={{ marginBottom: "1rem" }}>
        <input
          placeholder="搜索…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          style={{ padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }}
        />
        <select value={status} onChange={(e) => setStatus(e.target.value)} style={{ padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }}>
          <option value="">全部状态</option>
          <option value="development">开发中</option>
          <option value="beta">Beta</option>
          <option value="published">已发布</option>
          <option value="archived">已归档</option>
        </select>
        <button className="btn btn-sm" onClick={reload}>刷新</button>
      </div>

      {!data || data.games.length === 0 ? <EmptyState message="没有游戏。" /> : (
        <table className="table">
          <thead>
            <tr><th>封面</th><th>标题</th><th>ID</th><th>版本</th><th>状态</th><th>配置</th><th>更新时间</th><th>操作</th></tr>
          </thead>
          <tbody>
            {data.games.map((g) => (
              <tr key={g.id}>
                <td><div style={{ width: 48, height: 28, backgroundImage: `url(/${g.cover})`, backgroundSize: "cover", borderRadius: 4 }} /></td>
                <td>{g.title} {g.featured ? <span className="badge badge-beta">推荐</span> : null}</td>
                <td className="muted">{g.id}</td>
                <td>v{g.version}</td>
                <td><span className={`badge badge-${g.status}`}>{g.status}</span></td>
                <td>{g.configStatus}</td>
                <td className="muted">{g.updatedAt}</td>
                <td>
                  <Link to={`/admin/games/${g.id}`} className="btn btn-sm">编辑</Link>{" "}
                  {canWrite ? <Link to={`/admin/games/${g.id}/preview`} className="btn btn-sm">预览</Link> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
