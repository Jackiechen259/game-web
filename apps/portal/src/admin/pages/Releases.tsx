import { adminApi } from "../../lib/admin-api.ts";
import { ApiError } from "../../lib/api.ts";
import { useAsync, PageHeader, useToast } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function Releases(): JSX.Element {
  const { show } = useToast();
  const { data, loading, error, reload } = useAsync(() => adminApi.listReleases(), []);

  const rollback = async (id: string): Promise<void> => {
    if (!confirm("确认回滚？将创建反向提交或回滚 PR，不会删除 Git 历史。")) return;
    try {
      const res = await adminApi.rollback(id);
      show(res.rollbackPrUrl ? `回滚 PR 已创建：${res.rollbackPrUrl}` : "回滚已创建", "success");
      reload();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "回滚失败", "error");
    }
  };

  if (loading) return <Spinner label="加载发布历史…" />;
  if (error || !data) return <EmptyState message={error ?? "无法加载发布历史。"} />;

  return (
    <div>
      <PageHeader title="发布历史" />
      {data.releases.length === 0 ? <EmptyState message="暂无发布记录。" /> : (
        <table className="table">
          <thead><tr><th>时间</th><th>状态</th><th>源 commit</th><th>dist commit</th><th>PR</th><th>操作</th></tr></thead>
          <tbody>
            {data.releases.map((r) => (
              <tr key={r.id}>
                <td>{new Date(r.publishedAt).toLocaleString()}</td>
                <td>{r.status}</td>
                <td className="muted">{r.sourceCommit?.slice(0, 7) ?? "-"}</td>
                <td className="muted">{r.distCommit?.slice(0, 7) ?? "-"}</td>
                <td>{r.pullRequestNumber ?? "-"}</td>
                <td>{r.distCommit ? <button className="btn btn-sm" onClick={() => rollback(r.id)}>回滚</button> : <span className="muted">无</span>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
