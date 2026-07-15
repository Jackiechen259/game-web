import { useEffect, useState } from "react";
import { Link, useNavigate, useParams } from "react-router-dom";
import {
  ALLOW_PERMISSIONS,
  SANDBOX_TOKENS,
  REQUIRED_SANDBOX_TOKENS,
  type GameConfig,
} from "@game-platform/game-schema";
import { can, type CreateGameInput, type UpdateGameInput } from "@game-platform/admin-types";
import { adminApi } from "../../lib/admin-api.ts";
import { ApiError } from "../../lib/api.ts";
import { useAuth } from "../AuthContext.tsx";
import { PageHeader, useToast } from "../ui.tsx";
import { Spinner } from "../../portal/components.tsx";

interface FormState {
  id: string;
  title: string;
  description: string;
  version: string;
  status: GameConfig["status"];
  featured: boolean;
  entry: string;
  cover: string;
  categories: string;
  tags: string;
  controls: string;
  aspectRatio: string;
  displayOrder: number;
  minimumPortalSdkVersion: string;
  seoTitle: string;
  seoDescription: string;
  allow: string[];
  sandbox: string[];
  changelog: string;
}

function toForm(g: GameConfig): FormState {
  return {
    id: g.id,
    title: g.title,
    description: g.description,
    version: g.version,
    status: g.status,
    featured: g.featured,
    entry: g.entry,
    cover: g.cover,
    categories: g.categories.join(", "),
    tags: g.tags.join(", "),
    controls: g.controls.join("\n"),
    aspectRatio: g.aspectRatio ?? "",
    displayOrder: g.displayOrder ?? 0,
    minimumPortalSdkVersion: g.minimumPortalSdkVersion ?? "",
    seoTitle: g.seo?.title ?? "",
    seoDescription: g.seo?.description ?? "",
    allow: g.iframe?.allow ?? ["fullscreen", "autoplay", "gamepad"],
    sandbox: g.iframe?.sandbox ?? ["allow-scripts", "allow-same-origin", "allow-pointer-lock"],
    changelog: (g.changelog ?? []).map((c) => `${c.version}|${c.date}|${c.changes.join("; ")}`).join("\n"),
  };
}

function emptyForm(): FormState {
  return {
    id: "",
    title: "",
    description: "",
    version: "1.0.0",
    status: "development",
    featured: false,
    entry: "",
    cover: "",
    categories: "",
    tags: "",
    controls: "",
    aspectRatio: "16/9",
    displayOrder: 0,
    minimumPortalSdkVersion: "1.0.0",
    seoTitle: "",
    seoDescription: "",
    allow: ["fullscreen", "autoplay", "gamepad"],
    sandbox: ["allow-scripts", "allow-same-origin", "allow-pointer-lock"],
    changelog: "",
  };
}

function parseList(s: string): string[] {
  return s.split(/[,\n]/).map((x) => x.trim()).filter(Boolean);
}

function parseChangelog(s: string): { version: string; date: string; changes: string[] }[] {
  return s.split("\n").map((l) => l.trim()).filter(Boolean).map((line) => {
    const [version, date, changes] = line.split("|");
    return { version: version?.trim() ?? "", date: date?.trim() ?? "", changes: changes ? changes.split(";").map((c) => c.trim()).filter(Boolean) : [] };
  }).filter((c) => c.version);
}

export function GameEdit(): JSX.Element {
  const { gameId } = useParams();
  const isEdit = Boolean(gameId);
  const { user } = useAuth();
  const { show } = useToast();
  const navigate = useNavigate();

  const [form, setForm] = useState<FormState>(emptyForm());
  const [sha, setSha] = useState<string>("");
  const [loading, setLoading] = useState(isEdit);
  const [submitting, setSubmitting] = useState(false);
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [conflict, setConflict] = useState<{ currentSha: string; expectedSha: string } | null>(null);
  const [dirty, setDirty] = useState(false);

  const canWrite = can(user?.role, "write");

  useEffect(() => {
    if (!gameId) return;
    setLoading(true);
    adminApi.getGame(gameId).then((detail) => {
      setForm(toForm(detail.game));
      setSha(detail.sha);
    }).catch((err: unknown) => {
      show(err instanceof ApiError ? err.message : "加载失败", "error");
    }).finally(() => setLoading(false));
  }, [gameId, show]);

  // Unsaved-changes prompt (browser navigation / close).
  useEffect(() => {
    const handler = (e: BeforeUnloadEvent): void => {
      if (dirty) { e.preventDefault(); e.returnValue = ""; }
    };
    window.addEventListener("beforeunload", handler);
    return () => window.removeEventListener("beforeunload", handler);
  }, [dirty]);

  const set = <K extends keyof FormState>(key: K, value: FormState[K]): void => {
    setForm((f) => ({ ...f, [key]: value }));
    setDirty(true);
  };

  const toggleToken = (key: "allow" | "sandbox", token: string): void => {
    setForm((f) => {
      const list = f[key];
      const next = list.includes(token) ? list.filter((t) => t !== token) : [...list, token];
      return { ...f, [key]: next };
    });
    setDirty(true);
  };

  const buildPayload = (): CreateGameInput => {
    const f = form;
    return {
      id: f.id,
      title: f.title,
      description: f.description,
      version: f.version,
      status: f.status,
      featured: f.featured,
      entry: f.entry,
      cover: f.cover,
      categories: parseList(f.categories),
      tags: parseList(f.tags),
      controls: f.controls.split("\n").map((x) => x.trim()).filter(Boolean),
      aspectRatio: f.aspectRatio || undefined,
      displayOrder: f.displayOrder,
      minimumPortalSdkVersion: f.minimumPortalSdkVersion || undefined,
      seo: f.seoTitle || f.seoDescription ? { title: f.seoTitle || undefined, description: f.seoDescription || undefined } : undefined,
      iframe: { allow: f.allow, sandbox: f.sandbox },
      changelog: parseChangelog(f.changelog),
    };
  };

  const handleSave = async (): Promise<void> => {
    if (!canWrite) return;
    setSubmitting(true);
    setFieldErrors({});
    setConflict(null);
    try {
      const payload = buildPayload();
      if (isEdit && gameId) {
        const update: UpdateGameInput = { ...payload, expectedSha: sha };
        const res = await adminApi.updateGame(gameId, update);
        setSha(res.sha);
        show("已保存草稿", "success");
      } else {
        const res = await adminApi.createGame(payload);
        setSha(res.sha);
        show("游戏已创建", "success");
        navigate(`/admin/games/${res.game.id}`);
      }
      setDirty(false);
    } catch (err) {
      if (err instanceof ApiError) {
        if (err.status === 409 && err.details) {
          const d = err.details as { currentSha: string; expectedSha: string };
          setConflict({ currentSha: d.currentSha, expectedSha: d.expectedSha });
          show("配置冲突：该游戏已被其他管理员修改。", "error");
        } else {
          // Field-level errors from validation details (zod issues).
          const issues = err.details as { path?: (string | number)[]; message?: string }[] | undefined;
          if (Array.isArray(issues)) {
            const map: Record<string, string> = {};
            for (const issue of issues) {
              const key = (issue.path ?? []).join(".");
              map[key] = issue.message ?? "invalid";
            }
            setFieldErrors(map);
          }
          show(err.message, "error");
        }
      } else {
        show("保存失败", "error");
      }
    } finally {
      setSubmitting(false);
    }
  };

  const handleValidate = async (): Promise<void> => {
    if (!gameId) return;
    try {
      const res = await adminApi.validateGame(gameId);
      show(res.valid ? "校验通过" : `校验失败：${res.errors.length} 个错误`, res.valid ? "success" : "error");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "校验失败", "error");
    }
  };

  const handleCoverUpload = async (file: File): Promise<void> => {
    if (!gameId) { show("请先创建游戏再上传封面。", "error"); return; }
    const base64 = await fileToBase64(file);
    try {
      const res = await adminApi.uploadCover(gameId, base64, file.name, file.type);
      set("cover", res.cover);
      show("封面上传成功", "success");
    } catch (err) {
      show(err instanceof ApiError ? err.message : "封面上传失败", "error");
    }
  };

  const reload = async (): Promise<void> => {
    if (!gameId) return;
    const detail = await adminApi.getGame(gameId);
    setForm(toForm(detail.game));
    setSha(detail.sha);
    setConflict(null);
    setDirty(false);
    show("已重新加载最新版本", "info");
  };

  if (loading) return <Spinner label="加载游戏配置…" />;

  const errorFor = (key: string): JSX.Element | null =>
    fieldErrors[key] ? <span className="error">{fieldErrors[key]}</span> : null;

  return (
    <div>
      <PageHeader title={isEdit ? `编辑游戏：${form.title || gameId}` : "新增游戏"} actions={
        <div className="row">
          {isEdit ? <button className="btn btn-sm" onClick={handleValidate}>校验</button> : null}
          <Link to="/admin/games" className="btn btn-sm">返回列表</Link>
        </div>
      } />

      {conflict ? (
        <div className="alert alert-warn">
          <strong>配置冲突</strong>：该游戏已被其他管理员修改（当前 SHA {conflict.currentSha.slice(0, 7)}，你的 SHA {conflict.expectedSha.slice(0, 7)}）。
          你的修改未丢失。请 <button className="btn btn-sm" onClick={reload}>重新加载最新版本</button> 后合并并再次保存。
        </div>
      ) : null}

      <form className="form" onSubmit={(e) => { e.preventDefault(); void handleSave(); }}>
        <div className="form-row">
          <div className="field">
            <label htmlFor="id">游戏 ID（创建后不可修改）</label>
            <input id="id" value={form.id} disabled={isEdit} onChange={(e) => set("id", e.target.value)} placeholder="snake" required />
            <span className="hint">只能小写字母、数字和连字符，正则 ^[a-z0-9][a-z0-9-]*$</span>
            {errorFor("id")}
          </div>
          <div className="field">
            <label htmlFor="version">版本</label>
            <input id="version" value={form.version} onChange={(e) => set("version", e.target.value)} placeholder="1.0.0" required />
            {errorFor("version")}
          </div>
        </div>

        <div className="field">
          <label htmlFor="title">标题</label>
          <input id="title" value={form.title} onChange={(e) => set("title", e.target.value)} required />
          {errorFor("title")}
        </div>

        <div className="field">
          <label htmlFor="description">描述</label>
          <textarea id="description" rows={3} value={form.description} onChange={(e) => set("description", e.target.value)} required />
          {errorFor("description")}
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="status">状态</label>
            <select id="status" value={form.status} onChange={(e) => set("status", e.target.value as GameConfig["status"])}>
              <option value="development">开发中</option>
              <option value="beta">Beta</option>
              <option value="published">已发布</option>
              <option value="archived">已归档</option>
            </select>
          </div>
          <div className="field">
            <label>推荐</label>
            <label style={{ display: "flex", alignItems: "center", gap: "0.5rem", paddingTop: "0.6rem" }}>
              <input type="checkbox" checked={form.featured} onChange={(e) => set("featured", e.target.checked)} /> 在首页推荐
            </label>
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="entry">入口（相对路径）</label>
            <input id="entry" value={form.entry} onChange={(e) => set("entry", e.target.value)} placeholder="games/snake/index.html" required />
            {errorFor("entry")}
          </div>
          <div className="field">
            <label htmlFor="cover">封面（相对路径）</label>
            <input id="cover" value={form.cover} onChange={(e) => set("cover", e.target.value)} placeholder="games/snake/cover.png" required />
            {isEdit ? (
              <input type="file" accept="image/png,image/jpeg,image/webp" onChange={(e) => { const f = e.target.files?.[0]; if (f) void handleCoverUpload(f); }} style={{ marginTop: "0.4rem" }} />
            ) : null}
            {errorFor("cover")}
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="categories">分类（逗号分隔）</label>
            <input id="categories" value={form.categories} onChange={(e) => set("categories", e.target.value)} placeholder="休闲, 益智" />
          </div>
          <div className="field">
            <label htmlFor="tags">标签（逗号分隔）</label>
            <input id="tags" value={form.tags} onChange={(e) => set("tags", e.target.value)} placeholder="单人, 键盘" />
          </div>
        </div>

        <div className="field">
          <label htmlFor="controls">操作说明（每行一条）</label>
          <textarea id="controls" rows={3} value={form.controls} onChange={(e) => set("controls", e.target.value)} />
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="aspectRatio">宽高比</label>
            <input id="aspectRatio" value={form.aspectRatio} onChange={(e) => set("aspectRatio", e.target.value)} placeholder="16/9" />
          </div>
          <div className="field">
            <label htmlFor="displayOrder">显示顺序</label>
            <input id="displayOrder" type="number" value={form.displayOrder} onChange={(e) => set("displayOrder", parseInt(e.target.value, 10) || 0)} />
          </div>
        </div>

        <div className="field">
          <label>iframe 权限（白名单）</label>
          <div className="row">
            {ALLOW_PERMISSIONS.map((p) => (
              <label key={p} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                <input type="checkbox" checked={form.allow.includes(p)} onChange={() => toggleToken("allow", p)} /> {p}
              </label>
            ))}
          </div>
          <span className="hint">sandbox 中 allow-scripts 与 allow-same-origin 必须保留，不可完全关闭。</span>
          <div className="row" style={{ marginTop: "0.4rem" }}>
            {SANDBOX_TOKENS.map((t) => {
              const required = (REQUIRED_SANDBOX_TOKENS as readonly string[]).includes(t);
              return (
                <label key={t} style={{ display: "flex", gap: "0.3rem", alignItems: "center" }}>
                  <input type="checkbox" checked={form.sandbox.includes(t)} disabled={required} onChange={() => toggleToken("sandbox", t)} /> {t}{required ? " *" : ""}
                </label>
              );
            })}
          </div>
        </div>

        <div className="form-row">
          <div className="field">
            <label htmlFor="seoTitle">SEO 标题</label>
            <input id="seoTitle" value={form.seoTitle} onChange={(e) => set("seoTitle", e.target.value)} />
          </div>
          <div className="field">
            <label htmlFor="seoDescription">SEO 描述</label>
            <input id="seoDescription" value={form.seoDescription} onChange={(e) => set("seoDescription", e.target.value)} />
          </div>
        </div>

        <div className="field">
          <label htmlFor="changelog">更新日志（每行：版本|日期|变更1;变更2）</label>
          <textarea id="changelog" rows={3} value={form.changelog} onChange={(e) => set("changelog", e.target.value)} placeholder="1.0.0|2026-07-15|首次发布" />
        </div>

        <div className="row">
          <button className="btn btn-primary" type="submit" disabled={submitting || !canWrite}>
            {submitting ? "保存中…" : isEdit ? "保存草稿" : "创建游戏"}
          </button>
          {!canWrite ? <span className="muted">你没有编辑权限。</span> : null}
        </div>
      </form>
    </div>
  );
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result as string;
      const comma = result.indexOf(",");
      resolve(comma >= 0 ? result.slice(comma + 1) : result);
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}
