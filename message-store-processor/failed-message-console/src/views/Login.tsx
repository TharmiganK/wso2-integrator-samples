import { useState, type FormEvent } from "react";
import { useAuth } from "../auth";

export default function Login() {
  const { login } = useAuth();
  const [username, setUsername] = useState("manager");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    try {
      await login(username.trim(), password);
    } catch (err) {
      setError((err as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="center-screen">
      <div className="card login-card">
        <div className="card-head">
          <h3>📦 Failed Sales Order Console — Sign in</h3>
        </div>
        <div className="card-body">
          <form className="form" onSubmit={handleSubmit}>
            <div className="field">
              <label>Username</label>
              <input value={username} onChange={(e) => setUsername(e.target.value)} autoFocus />
            </div>
            <div className="field">
              <label>Password</label>
              <input
                type="password"
                value={password}
                onChange={(e) => setPassword(e.target.value)}
              />
            </div>
            {error && <p className="error">{error}</p>}
            <button type="submit" className="btn primary" disabled={busy}>
              {busy ? "Signing in…" : "Sign in"}
            </button>
          </form>
          <p className="muted small" style={{ marginTop: 16 }}>
            Demo managers: <code>manager / manager123</code>, <code>ops / ops123</code>
          </p>
        </div>
      </div>
    </div>
  );
}
