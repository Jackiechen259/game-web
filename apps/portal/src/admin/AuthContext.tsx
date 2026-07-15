import { createContext, useContext, useEffect, useState, type ReactNode } from "react";
import type { AdminUser } from "@game-platform/admin-types";
import { adminApi } from "../lib/admin-api.ts";
import { setCsrfToken } from "../lib/api.ts";

interface AuthState {
  user: AdminUser | null;
  loading: boolean;
  login: (login: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<AdminUser | null>(null);
  const [loading, setLoading] = useState(true);

  const refresh = async (): Promise<void> => {
    try {
      const session = await adminApi.getSession();
      setCsrfToken(session.csrfToken);
      setUser(session.user);
    } catch {
      setUser(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void refresh();
  }, []);

  const login = async (username: string, password: string): Promise<void> => {
    const res = await adminApi.login(username, password);
    setCsrfToken(res.csrfToken);
    setUser(res.user);
  };

  const logout = async (): Promise<void> => {
    await adminApi.logout();
    setCsrfToken(null);
    setUser(null);
  };

  return <AuthContext.Provider value={{ user, loading, login, logout, refresh }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
