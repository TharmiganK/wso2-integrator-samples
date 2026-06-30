import type { ReactNode } from "react";
import { isPending } from "./types";

export function StatusBadge({ status }: { status: string }) {
  const s = (status || "").toUpperCase();
  let cls = "gray";
  if (s === "COMPLETED" || s === "SUCCEEDED") cls = "green";
  else if (isPending(s)) cls = "amber";
  else if (s === "FAILED" || s === "TERMINATED" || s === "CANCELED" || s === "CANCELLED" || s === "TIMED_OUT")
    cls = "red";
  return <span className={`badge ${cls}`}>{s || "UNKNOWN"}</span>;
}

export function Spinner({ label = "Loading…" }: { label?: string }) {
  return <div className="spinner">{label}</div>;
}

export function Empty({ children }: { children: ReactNode }) {
  return <div className="empty">{children}</div>;
}

export function ErrorBanner({ error }: { error: unknown }) {
  if (!error) return null;
  const msg = error instanceof Error ? error.message : String(error);
  return <div className="banner error">{msg}</div>;
}

export function formatTime(value: string | null | undefined): string {
  if (!value) return "—";
  const d = new Date(value);
  return isNaN(d.getTime()) ? value : d.toLocaleString();
}

export function StatusFilterBar({
  value,
  onChange,
}: {
  value: "PENDING" | "COMPLETED" | "ALL";
  onChange: (v: "PENDING" | "COMPLETED" | "ALL") => void;
}) {
  const opts: Array<"PENDING" | "COMPLETED" | "ALL"> = ["PENDING", "COMPLETED", "ALL"];
  return (
    <div className="segmented">
      {opts.map((o) => (
        <button key={o} className={value === o ? "active" : ""} onClick={() => onChange(o)}>
          {o === "PENDING" ? "Pending" : o === "COMPLETED" ? "Completed" : "All"}
        </button>
      ))}
    </div>
  );
}
