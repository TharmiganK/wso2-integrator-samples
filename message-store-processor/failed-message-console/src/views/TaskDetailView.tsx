import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api";
import { useAsync } from "../useAsync";
import { COMPLETION_FORMS, DynamicForm, fieldsFromJsonSchema, KeyValues, type FormField } from "../dynamic";
import { Modal, ProcessingModal, Tabs, useProcessing } from "../processing";
import { isPending, shortTaskName } from "../types";
import { Empty, ErrorBanner, formatTime, Spinner, StatusBadge } from "../ui";

export default function TaskDetailView() {
  const { taskId = "" } = useParams();
  const task = useAsync(() => api.getHumanTask(taskId), [taskId]);
  const proc = useProcessing(() => task.reload());
  const [tab, setTab] = useState("complete");
  const [showFail, setShowFail] = useState(false);

  if (task.loading) return <Spinner />;
  if (task.error || !task.data) {
    return (
      <div>
        <Link className="back-link" to="/tasks">← Back to tasks</Link>
        <ErrorBanner error={task.error ?? "Task not found"} />
      </div>
    );
  }

  const t = task.data;
  const shortName = shortTaskName(t.taskName);
  const pending = isPending(t.status);
  // Prefer the server-provided JSON schema; fall back to a known form config.
  // Pre-fill the editable replay payload with the original failed order.
  const formFields = withEditedPayloadDefault(
    fieldsFromJsonSchema(t.formSchema) ?? COMPLETION_FORMS[shortName],
    t.payload,
  );

  return (
    <div>
      <ProcessingModal open={proc.active} message={proc.message} />
      <Link className="back-link" to="/tasks">← Back to tasks</Link>

      <div className="card">
        <div className="card-head">
          <h3>{t.title || shortName}</h3>
          <StatusBadge status={t.status} />
        </div>
        <div className="card-body">
          {t.description && <p>{t.description}</p>}
          <Link className="muted small" to={`/workflows/${encodeURIComponent(t.parentWorkflowId)}`}>
            View workflow ↗
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Task input</h3></div>
        <div className="card-body">
          <KeyValues data={t.payload} />
        </div>
      </div>

      {proc.error && <div className="banner error">{proc.error}</div>}

      {pending ? (
        <div className="card">
          <div className="card-body">
            <Tabs
              active={tab}
              onChange={setTab}
              tabs={[
                { id: "complete", label: "Replay" },
                { id: "actions", label: "Discard" },
              ]}
            />

            {tab === "complete" &&
              (formFields ? (
                <DynamicForm
                  fields={formFields}
                  submitLabel="Replay order"
                  busy={proc.active}
                  onSubmit={(result) =>
                    proc.run(() => api.completeHumanTask(t.taskId, result), {
                      pending: "Replaying order…",
                    })
                  }
                />
              ) : (
                <RawResultForm
                  busy={proc.active}
                  onSubmit={(result) =>
                    proc.run(() => api.completeHumanTask(t.taskId, result), { pending: "Completing task…" })
                  }
                />
              ))}

            {tab === "actions" && (
              <div>
                <p className="muted">
                  Discard this order instead of replaying it. The message is moved to the dead-letter
                  queue for later analysis. This cannot be undone.
                </p>
                <button className="btn danger" onClick={() => setShowFail(true)}>
                  Discard to DLQ…
                </button>
              </div>
            )}
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head">
            <h3>Result</h3>
            <span className="muted small">
              {t.completedBy ? `by ${t.completedBy} · ` : ""}
              {formatTime(t.completedAt ?? t.closeTime)}
            </span>
          </div>
          <div className="card-body">
            {t.result ? <KeyValues data={t.result as Record<string, unknown>} /> : <Empty>No result recorded.</Empty>}
          </div>
        </div>
      )}

      {showFail && (
        <FailDialog
          busy={proc.active}
          onCancel={() => setShowFail(false)}
          onConfirm={(reason) => {
            setShowFail(false);
            proc.run(() => api.failHumanTask(t.taskId, reason), { pending: "Completing task with error…" });
          }}
        />
      )}
    </div>
  );
}

// Seeds the editable replay payload (`editedPayload`) with the original failed order,
// which the workflow surfaces on the task payload as `orderPayload`. This way the
// manager corrects the real order in place instead of starting from an empty `{}`.
function withEditedPayloadDefault(
  fields: FormField[] | undefined,
  payload: unknown,
): FormField[] | undefined {
  if (!fields) return fields;
  const original = (payload as Record<string, unknown> | null | undefined)?.orderPayload;
  if (original === undefined) return fields;
  return fields.map((f) => (f.name === "editedPayload" ? { ...f, default: original } : f));
}

function FailDialog({
  busy,
  onConfirm,
  onCancel,
}: {
  busy: boolean;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}) {
  const [reason, setReason] = useState("");
  return (
    <Modal title="Discard to the dead-letter queue?" onClose={onCancel}>
      <div className="form">
        <div className="field">
          <label>Reason *</label>
          <textarea
            rows={3}
            value={reason}
            autoFocus
            onChange={(e) => setReason(e.target.value)}
            placeholder="Why is this order being discarded?"
          />
        </div>
        <div className="btn-row">
          <button className="btn danger" disabled={busy || !reason.trim()} onClick={() => onConfirm(reason.trim())}>
            Discard order
          </button>
        </div>
      </div>
    </Modal>
  );
}

function RawResultForm({ busy, onSubmit }: { busy: boolean; onSubmit: (result: unknown) => void }) {
  const [text, setText] = useState("{\n  \n}");
  const [error, setError] = useState<string | null>(null);
  return (
    <div className="form">
      <div className="field">
        <label>Result (JSON)</label>
        <textarea className="mono" rows={6} value={text} onChange={(e) => setText(e.target.value)} />
      </div>
      {error && <p className="error">{error}</p>}
      <button
        className="btn primary"
        disabled={busy}
        onClick={() => {
          try {
            onSubmit(JSON.parse(text));
            setError(null);
          } catch (e) {
            setError(`Invalid JSON: ${(e as Error).message}`);
          }
        }}
      >
        Complete Task
      </button>
    </div>
  );
}
