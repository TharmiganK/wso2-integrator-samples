import { useState } from "react";
import { Link, useParams } from "react-router-dom";
import * as api from "../api";
import { useAsync } from "../useAsync";
import { DynamicForm, fieldsFromObject, KeyValues } from "../dynamic";
import { Modal, ProcessingModal, useProcessing } from "../processing";
import { isPending, shortTaskName } from "../types";
import { Empty, ErrorBanner, formatTime, Spinner, StatusBadge } from "../ui";

export default function FailedActivityDetailView() {
  const { taskId = "" } = useParams();
  const task = useAsync(() => api.getRetryTask(taskId), [taskId]);
  const proc = useProcessing(() => task.reload());
  const [showEdit, setShowEdit] = useState(false);
  const [showFail, setShowFail] = useState(false);

  if (task.loading) return <Spinner />;
  if (task.error || !task.data) {
    return (
      <div>
        <Link className="back-link" to="/failed-activities">← Back to failed activities</Link>
        <ErrorBanner error={task.error ?? "Activity not found"} />
      </div>
    );
  }

  const t = task.data;
  const pending = isPending(t.status);
  const args = t.activityArgs ?? {};

  return (
    <div>
      <ProcessingModal open={proc.active} message={proc.message} />
      <Link className="back-link" to="/failed-activities">← Back to failed activities</Link>

      <div className="card">
        <div className="card-head">
          <h3>⚙️ {shortTaskName(t.activityName || t.taskName)}</h3>
          <StatusBadge status={pending ? "PENDING" : t.status} />
        </div>
        <div className="card-body">
          {t.errorMessage && (
            <div className="banner error" style={{ whiteSpace: "pre-wrap" }}>
              {t.errorMessage}
            </div>
          )}
          <KeyValues
            data={{
              "Activity": t.activityName,
              "Parent workflow": t.parentWorkflowId,
              "Created": formatTime(t.createdAt),
            }}
          />
          <Link className="muted small" to={`/workflows/${encodeURIComponent(t.parentWorkflowId)}`}>
            View workflow ↗
          </Link>
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Activity arguments</h3></div>
        <div className="card-body">
          <KeyValues data={args} />
        </div>
      </div>

      {proc.error && <div className="banner error">{proc.error}</div>}

      {pending ? (
        <div className="card">
          <div className="card-head"><h3>Resolve</h3></div>
          <div className="card-body">
            <div className="btn-row">
              <button
                className="btn primary"
                disabled={proc.active}
                onClick={() => proc.run(() => api.retryActivity(t.taskId), { pending: "Retrying activity…" })}
              >
                Retry (same input)
              </button>
              <button className="btn" disabled={proc.active} onClick={() => setShowEdit(true)}>
                Retry with new input…
              </button>
              <button className="btn danger" disabled={proc.active} onClick={() => setShowFail(true)}>
                Fail permanently…
              </button>
            </div>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="card-head"><h3>Action taken</h3></div>
          <div className="card-body">
            <KeyValues
              data={{
                "Outcome": t.status,
                "Decided by": t.decidedBy,
                "Decided at": formatTime(t.decidedAt),
              }}
            />
          </div>
        </div>
      )}

      {showEdit && (
        <Modal title="Retry with new input" onClose={() => setShowEdit(false)}>
          <DynamicForm
            fields={fieldsFromObject(args)}
            submitLabel="Retry with this input"
            busy={proc.active}
            onSubmit={(payload) => {
              setShowEdit(false);
              proc.run(() => api.retryActivityWithInput(t.taskId, payload), {
                pending: "Retrying with new input…",
              });
            }}
          />
        </Modal>
      )}

      {showFail && (
        <Modal title="Fail this activity?" onClose={() => setShowFail(false)}>
          <p className="muted">
            This permanently fails the activity; the workflow will proceed as if the retry was rejected. This cannot
            be undone.
          </p>
          <div className="btn-row">
            <button
              className="btn danger"
              disabled={proc.active}
              onClick={() => {
                setShowFail(false);
                proc.run(() => api.failActivity(t.taskId), { pending: "Failing activity…" });
              }}
            >
              Fail permanently
            </button>
          </div>
        </Modal>
      )}

      {!pending && !t.decidedBy && <Empty>No further action available.</Empty>}
    </div>
  );
}
