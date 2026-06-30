import { createContext, useContext, useState, type ReactNode } from "react";
import * as api from "./api";
import type { Session } from "./types";

interface AuthState {
  session: Session | null;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
}

const AuthContext = createContext<AuthState | null>(null);

function loadSession(): Session | null {
  const token = api.getToken();
  const raw = localStorage.getItem("ht_session");
  if (token && raw) {
    try {
      return JSON.parse(raw) as Session;
    } catch {
      return null;
    }
  }
  return null;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(loadSession());

  async function login(username: string, password: string) {
    const s = await api.login(username, password);
    api.setToken(s.token);
    localStorage.setItem("ht_session", JSON.stringify(s));
    setSession(s);
  }

  async function logout() {
    await api.logout();
    api.setToken(null);
    localStorage.removeItem("ht_session");
    setSession(null);
  }

  return <AuthContext.Provider value={{ session, login, logout }}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthState {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error("useAuth must be used within AuthProvider");
  return ctx;
}
