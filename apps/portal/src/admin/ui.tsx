import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from "react";
import { ApiError } from "../lib/api.ts";

/** Generic async data hook. */
export function useAsync<T>(fn: () => Promise<T>, deps: unknown[]): {
  data: T | null;
  loading: boolean;
  error: string | null;
  reload: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  const reload = useCallback(() => setNonce((n) => n + 1), []);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fn()
      .then((d) => { if (!cancelled) { setData(d); setError(null); } })
      .catch((err: unknown) => { if (!cancelled) setError(err instanceof ApiError ? err.message : String(err)); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
    // deps intentionally captured by closure via nonce + deps array below
  }, [nonce, ...deps]);

  return { data, loading, error, reload };
}

export interface Toast {
  id: number;
  message: string;
  type: "success" | "error" | "info";
}

interface ToastApi {
  show: (message: string, type?: Toast["type"]) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<Toast[]>([]);
  const show = useCallback((message: string, type: Toast["type"] = "info") => {
    const id = Date.now() + Math.random();
    setToasts((t) => [...t, { id, message, type }]);
    setTimeout(() => setToasts((t) => t.filter((x) => x.id !== id)), 4000);
  }, []);
  const dismiss = useCallback((id: number) => setToasts((t) => t.filter((x) => x.id !== id)), []);

  return (
    <ToastContext.Provider value={{ show }}>
      {children}
      <ToastHost toasts={toasts} dismiss={dismiss} />
    </ToastContext.Provider>
  );
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error("useToast must be used within ToastProvider");
  return ctx;
}

export function ToastHost({ toasts, dismiss }: { toasts: Toast[]; dismiss: (id: number) => void }): JSX.Element {
  return (
    <>
      {toasts.map((t) => (
        <div key={t.id} className={`toast ${t.type}`} onClick={() => dismiss(t.id)} role="alert">
          {t.message}
        </div>
      ))}
    </>
  );
}

export function PageHeader({ title, actions }: { title: string; actions?: JSX.Element }): JSX.Element {
  return (
    <div className="row" style={{ marginBottom: "1rem" }}>
      <h1 className="section-title" style={{ margin: 0 }}>{title}</h1>
      <span className="spacer" />
      {actions}
    </div>
  );
}
