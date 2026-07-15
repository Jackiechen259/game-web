import { useEffect, useState } from "react";
import type { SiteSettings } from "@game-platform/game-schema";
import { can, type Permission } from "@game-platform/admin-types";
import { adminApi } from "../../lib/admin-api.ts";
import { ApiError } from "../../lib/api.ts";
import { useAuth } from "../AuthContext.tsx";
import { PageHeader, useToast } from "../ui.tsx";
import { Spinner } from "../../portal/components.tsx";

export function Settings(): JSX.Element {
  const { user } = useAuth();
  const { show } = useToast();
  const canEdit = can(user?.role, "settings" as Permission);
  const [settings, setSettings] = useState<SiteSettings | null>(null);
  const [sha, setSha] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [featuredIds, setFeaturedIds] = useState("");
  const [navText, setNavText] = useState("");

  useEffect(() => {
    adminApi.getSettings().then((res) => {
      setSettings(res.settings);
      setSha(res.sha);
      setFeaturedIds(res.settings.featuredGameIds.join(", "));
      setNavText(res.settings.navigation.map((n) => `${n.label}|${n.path}`).join("\n"));
    }).catch((err: unknown) => show(err instanceof ApiError ? err.message : "加载失败", "error"))
      .finally(() => setLoading(false));
  }, [show]);

  const update = <K extends keyof SiteSettings>(key: K, value: SiteSettings[K]): void => {
    setSettings((s) => (s ? { ...s, [key]: value } : s));
  };

  const save = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    if (!settings) return;
    setSaving(true);
    const payload: SiteSettings = {
      ...settings,
      featuredGameIds: featuredIds.split(",").map((x) => x.trim()).filter(Boolean),
      navigation: navText.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
        const [label, path] = line.split("|");
        return { label: (label ?? "").trim(), path: (path ?? "").trim() };
      }).filter((n) => n.label && n.path),
    };
    try {
      const res = await adminApi.updateSettings(payload, sha);
      setSha(res.sha);
      show("设置已保存", "success");
    } catch (err) {
      if (err instanceof ApiError && err.status === 409) {
        show("配置冲突：设置已被其他人修改，请重新加载。", "error");
      } else {
        show(err instanceof ApiError ? err.message : "保存失败", "error");
      }
    } finally {
      setSaving(false);
    }
  };

  if (loading || !settings) return <Spinner label="加载设置…" />;

  return (
    <div>
      <PageHeader title="站点设置" />
      <form className="form" onSubmit={save}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="siteName">站点名称</label>
            <input id="siteName" value={settings.siteName} onChange={(e) => update("siteName", e.target.value)} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="defaultLanguage">默认语言</label>
            <input id="defaultLanguage" value={settings.defaultLanguage} onChange={(e) => update("defaultLanguage", e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div className="field">
          <label htmlFor="siteDescription">站点描述</label>
          <textarea id="siteDescription" rows={2} value={settings.siteDescription} onChange={(e) => update("siteDescription", e.target.value)} disabled={!canEdit} />
        </div>
        <div className="form-row">
          <div className="field">
            <label htmlFor="gamesPerPage">每页游戏数</label>
            <input id="gamesPerPage" type="number" value={settings.gamesPerPage} onChange={(e) => update("gamesPerPage", parseInt(e.target.value, 10) || 24)} disabled={!canEdit} />
          </div>
          <div className="field">
            <label htmlFor="featuredIds">推荐游戏 ID（逗号分隔）</label>
            <input id="featuredIds" value={featuredIds} onChange={(e) => setFeaturedIds(e.target.value)} disabled={!canEdit} />
          </div>
        </div>
        <div className="field">
          <label>导航（每行：标签|路径）</label>
          <textarea rows={3} value={navText} onChange={(e) => setNavText(e.target.value)} disabled={!canEdit} />
        </div>
        <div className="row">
          {([
            ["showBetaGames", "显示 Beta 游戏"],
            ["showArchivedGamePages", "保留归档游戏详情页"],
            ["enableSearch", "启用搜索"],
            ["enableCategories", "启用分类"],
            ["enableFullscreen", "启用全屏"],
            ["enableGamepad", "启用手柄"],
            ["maintenanceMode", "维护模式"],
          ] as const).map(([key, label]) => (
            <label key={key} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
              <input type="checkbox" checked={settings[key] as boolean} onChange={(e) => update(key, e.target.checked as never)} disabled={!canEdit} /> {label}
            </label>
          ))}
        </div>
        {canEdit ? (
          <button className="btn btn-primary" type="submit" disabled={saving}>{saving ? "保存中…" : "保存设置"}</button>
        ) : <span className="muted">你没有修改设置的权限。</span>}
      </form>
    </div>
  );
}
