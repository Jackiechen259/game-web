import { can, type Permission } from "@game-platform/admin-types";
import { adminApi } from "../../lib/admin-api.ts";
import { useAuth } from "../AuthContext.tsx";
import { useAsync, PageHeader, useToast } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function Deployments(): JSX.Element {
  const { user } = useAuth();
  const { show } = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.listDeployments(), []);

  const canRetry = can(user?.role, "publish" as Permission);

  const retry = async (): Promise<void> => {
    try {
      await adminApi.retryDeployment();
      show("已重新触发门户部署", "success");
      reload();
    } catch (err) {
      show(err instanceof Error ? err.message : "重试失败", "error");
    }
  };

  if (loading) return <Spinner label="加载部署…" />;
  if (error || !data) return <EmptyState message={error ?? "无法加载部署。"} />;

  return (
    <div>
      <PageHeader title="部署" actions={
        canRetry ? <button className="btn btn-sm" onClick={retry}>重新触发部署</button> : undefined
      } />
      {data.deployments.length === 0 ? <EmptyState message="暂无部署记录。" /> : (
        <table className="table">
          <thead><tr><th>仓库</th><th>阶段</th><th>状态</th><th>开始</th><th>完成</th><th>错误</th><th>链接</th></tr></thead>
          <tbody>
            {data.deployments.map((d) => (
              <tr key={d.id}>
                <td>{d.repository}</td>
                <td>{d.stage}</td>
                <td><span className={`badge badge-${d.status === "success" ? "published" : d.status === "failure" ? "archived" : "development"}`}>{d.status}</span></td>
                <td className="muted">{d.startedAt ?? "-"}</td>
                <td className="muted">{d.completedAt ?? "-"}</td>
                <td className="muted">{d.errorMessage ?? "-"}</td>
                <td>{d.workflowRunUrl ? <a href={d.workflowRunUrl} target="_blank" rel="noreferrer">查看</a> : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
