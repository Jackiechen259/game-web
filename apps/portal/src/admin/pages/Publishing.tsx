import { useState } from "react";
import { can, type Permission } from "@game-platform/admin-types";
import { adminApi } from "../../lib/admin-api.ts";
import { ApiError } from "../../lib/api.ts";
import { useAuth } from "../AuthContext.tsx";
import { useAsync, PageHeader, useToast } from "../ui.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";

export function Publishing(): JSX.Element {
  const { user } = useAuth();
  const { show } = useToast();
  const [busy, setBusy] = useState(false);
  const { data, loading, error, reload } = useAsync(() => adminApi.publishingStatus(), []);

  const canPublish = can(user?.role, "publish" as Permission);

  const prepare = async (): Promise<void> => {
    setBusy(true);
    try {
      const res = await adminApi.preparePublish();
      show(res.prepared ? "校验通过，可以发布" : `校验失败：${res.validation.errors.length} 个错误`, res.prepared ? "success" : "error");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "校验失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const publish = async (): Promise<void> => {
    if (!canPublish) return;
    if (!confirm("确认发布？将创建 Pull Request 并触发门户重新部署。")) return;
    setBusy(true);
    try {
      const res = await adminApi.publish();
      show(`发布已创建（PR #${res.publishJob.pullRequestNumber ?? "-"}），状态：${res.publishJob.status}`, "success");
      reload();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "发布失败", "error");
    } finally {
      setBusy(false);
    }
  };

  const cancel = async (): Promise<void> => {
    setBusy(true);
    try {
      await adminApi.cancelPublish();
      show("已取消发布", "info");
      reload();
    } catch (err) {
      show(err instanceof ApiError ? err.message : "取消失败", "error");
    } finally {
      setBusy(false);
    }
  };

  if (loading) return <Spinner label="加载发布状态…" />;
  if (error || !data) return <EmptyState message={error ?? "无法加载发布状态。"} />;

  return (
    <div>
      <PageHeader title="发布" actions={
        <div className="row">
          <button className="btn btn-sm" onClick={prepare} disabled={busy}>校验草稿</button>
          {canPublish ? <button className="btn btn-primary btn-sm" onClick={publish} disabled={busy}>发布</button> : null}
          {canPublish ? <button className="btn btn-sm" onClick={cancel} disabled={busy}>取消</button> : null}
        </div>
      } />
      <div className="alert alert-info">
        当前状态：<strong>{data.status}</strong>
        {data.publishJob ? <> · PR #{data.publishJob.pullRequestNumber ?? "-"} · {data.publishJob.sourceBranch}</> : null}
      </div>
      {data.validation ? (
        <div>
          <h2 className="section-title">校验结果</h2>
          {data.validation.valid ? <div className="alert alert-info">校验通过。</div> : (
            <div className="alert alert-error">
              <strong>{data.validation.errors.length} 个错误：</strong>
              <ul>{data.validation.errors.map((e, i) => <li key={i}>[{e.code}] {e.path}: {e.message}</li>)}</ul>
            </div>
          )}
        </div>
      ) : null}
    </div>
  );
}
