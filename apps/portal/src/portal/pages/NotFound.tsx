import { Link } from "react-router-dom";

export function NotFound(): JSX.Element {
  return (
    <div className="state">
      <h1 className="section-title">404</h1>
      <p>页面不存在。</p>
      <div style={{ marginTop: "1rem" }}>
        <Link to="/" className="btn btn-sm">返回首页</Link>
      </div>
    </div>
  );
}
