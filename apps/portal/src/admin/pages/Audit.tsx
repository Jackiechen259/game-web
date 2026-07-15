import { useState } from "react";
import { adminApi } from "../../lib/admin-api.ts";
import { useAsync, PageHeader } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function Audit(): JSX.Element {
  const [action, setAction] = useState("");
  const [result, setResult] = useState("");
  const { data, loading, error } = useAsync(
    () => adminApi.listAudit({ action: action || undefined, result: (result || undefined) as "success" | "failure" | undefined, pageSize: 100 }),
    [action, result],
  );

  if (loading && !data) return <Spinner label="加载审计日志…" />;
  if (error) return <EmptyState message={error} />;

  return (
    <div>
      <PageHeader title="审计日志" />
      <div className="row" style={{ marginBottom: "1rem" }}>
        <input placeholder="操作类型" value={action} onChange={(e) => setAction(e.target.value)} style={{ padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }} />
        <select value={result} onChange={(e) => setResult(e.target.value)} style={{ padding: "0.4rem 0.6rem", borderRadius: "var(--radius)", border: "1px solid var(--border)", background: "var(--bg-elev)", color: "var(--text)" }}>
          <option value="">全部结果</option>
          <option value="success">成功</option>
          <option value="failure">失败</option>
        </select>
      </div>
      {!data || data.logs.length === 0 ? <EmptyState message="暂无审计日志。" /> : (
        <table className="table">
          <thead><tr><th>时间</th><th>操作者</th><th>角色</th><th>操作</th><th>资源</th><th>结果</th></tr></thead>
          <tbody>
            {data.logs.map((l) => (
              <tr key={l.id}>
                <td className="muted">{new Date(l.timestamp).toLocaleString()}</td>
                <td>{l.actorLogin}</td>
                <td>{l.actorRole}</td>
                <td>{l.action}</td>
                <td className="muted">{l.resourceType}:{l.resourceId}</td>
                <td><span className={`badge badge-${l.result === "success" ? "published" : "archived"}`}>{l.result}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
