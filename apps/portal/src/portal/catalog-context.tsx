import { createContext, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { GameCatalog, SiteSettings } from "@game-platform/game-schema";
import { DEFAULT_SETTINGS, loadGameCatalog, loadSiteSettings } from "../lib/catalog.ts";

interface CatalogState {
  catalog: GameCatalog | null;
  settings: SiteSettings;
  loading: boolean;
  error: string | null;
  reload: () => void;
}

const CatalogContext = createContext<CatalogState | null>(null);

export function CatalogProvider({ children }: { children: ReactNode }): JSX.Element {
  const [catalog, setCatalog] = useState<GameCatalog | null>(null);
  const [settings, setSettings] = useState<SiteSettings>(DEFAULT_SETTINGS);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    Promise.all([loadGameCatalog(), loadSiteSettings()])
      .then(([cat, set]) => {
        if (cancelled) return;
        setCatalog(cat);
        if (set) setSettings(set);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Failed to load games");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [nonce]);

  const value = useMemo<CatalogState>(
    () => ({ catalog, settings, loading, error, reload: () => setNonce((n) => n + 1) }),
    [catalog, settings, loading, error],
  );

  return <CatalogContext.Provider value={value}>{children}</CatalogContext.Provider>;
}

export function useCatalog(): CatalogState {
  const ctx = useContext(CatalogContext);
  if (!ctx) throw new Error("useCatalog must be used within CatalogProvider");
  return ctx;
}
