import { useState } from "react";
import { useParams } from "react-router-dom";
import type { GameMetadata } from "@game-platform/game-schema";
import { adminApi } from "../../lib/admin-api.ts";
import { ApiError } from "../../lib/api.ts";
import { GameFrame } from "../../portal/pages/GameFrame.tsx";
import { EmptyState, Spinner } from "../../portal/components.tsx";
import { useAsync, PageHeader, useToast } from "../ui.tsx";

export function Preview(): JSX.Element {
  const { gameId } = useParams();
  const { show } = useToast();
  const { data, loading, error } = useAsync(() => adminApi.getGame(gameId!), [gameId]);
  const [previewUrl, setPreviewUrl] = useState<string | null>(null);

  if (loading) return <Spinner label="加载游戏…" />;
  if (error || !data) return <EmptyState message={error ?? "无法加载游戏。"} />;
  const g = data.game;

  const metadata: GameMetadata = {
    id: g.id, title: g.title, description: g.description, version: g.version,
    entry: g.entry, cover: g.cover, categories: g.categories, tags: g.tags,
    status: g.status, featured: g.featured, controls: g.controls,
    aspectRatio: g.aspectRatio, displayOrder: g.displayOrder, createdAt: g.createdAt, updatedAt: g.updatedAt,
    iframe: g.iframe,
  };

  const createPreview = async (): Promise<void> => {
    try {
      const res = await adminApi.createPreview(g.id);
      setPreviewUrl(res.url);
      show(`预览已创建，有效期至 ${new Date(res.expiresAt).toLocaleString()}`, "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "创建预览失败", "error");
    }
  };

  return (
    <div>
      <PageHeader title={`预览：${g.title}`} />
      {previewUrl ? (
        <GameFrame game={metadata} />
      ) : (
        <div className="alert alert-info">
          预览会基于已构建的静态游戏文件。点击下方按钮创建一个临时预览令牌。
          <div style={{ marginTop: "0.75rem" }}>
            <button className="btn btn-primary" onClick={createPreview}>创建预览</button>
          </div>
        </div>
      )}
    </div>
  );
}
