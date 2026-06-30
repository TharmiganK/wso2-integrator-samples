import { useState, type ReactNode } from "react";

/**
 * Wraps an action that triggers asynchronous workflow progress. Because the
 * workflow takes a moment to advance, we show an overlay, wait briefly after
 * the call returns, then refresh so the user sees the updated state.
 */
export function useProcessing(onDone?: () => void) {
  const [active, setActive] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState<string | null>(null);

  async function run(
    fn: () => Promise<void>,
    opts: { pending?: string; delayMs?: number; after?: () => void } = {},
  ) {
    setError(null);
    setActive(true);
    setMessage(opts.pending ?? "Submitting your action…");
    try {
      await fn();
      setMessage("Action accepted. Waiting for the workflow to update…");
      await new Promise((r) => setTimeout(r, opts.delayMs ?? 2000));
      onDone?.();
      opts.after?.();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setActive(false);
    }
  }

  return { active, message, error, run, clearError: () => setError(null) };
}

export function ProcessingModal({ open, message }: { open: boolean; message: string }) {
  if (!open) return null;
  return (
    <div className="overlay">
      <div className="modal modal-processing">
        <div className="dot-spinner" aria-hidden />
        <p>{message}</p>
      </div>
    </div>
  );
}

export function Modal({
  title,
  children,
  onClose,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
}) {
  return (
    <div className="overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-head">
          <h3>{title}</h3>
          <button className="icon-btn" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="modal-body">{children}</div>
      </div>
    </div>
  );
}

export function Tabs({
  tabs,
  active,
  onChange,
}: {
  tabs: { id: string; label: string }[];
  active: string;
  onChange: (id: string) => void;
}) {
  return (
    <div className="tabs">
      {tabs.map((t) => (
        <button
          key={t.id}
          className={`tab ${active === t.id ? "active" : ""}`}
          onClick={() => onChange(t.id)}
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
