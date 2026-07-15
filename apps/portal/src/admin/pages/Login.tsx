import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../AuthContext.tsx";
import { ApiError } from "../../lib/api.ts";

export function Login(): JSX.Element {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const onSubmit = async (e: React.FormEvent): Promise<void> => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await login(username, password);
      navigate("/admin");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "登录失败，请重试。");
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="center">
      <form className="form" style={{ width: 320 }} onSubmit={onSubmit}>
        <h1 className="section-title">管理后台登录</h1>
        {error ? <div className="alert alert-error">{error}</div> : null}
        <div className="field">
          <label htmlFor="username">用户名</label>
          <input id="username" value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username" required />
        </div>
        <div className="field">
          <label htmlFor="password">密码</label>
          <input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "登录中…" : "登录"}
        </button>
        <p className="muted" style={{ fontSize: "0.8rem" }}>
          本地开发使用 AUTH_PROVIDER=dev 与 DEV_ADMIN_LOGIN/DEV_ADMIN_PASSWORD；生产环境使用 GitHub OAuth。
        </p>
      </form>
    </div>
  );
}
