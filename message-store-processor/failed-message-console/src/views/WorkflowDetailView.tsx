import { Link, useParams } from "react-router-dom";
import * as api from "../api";
import { useAsync } from "../useAsync";
import { KeyValues } from "../dynamic";
import { isPending, shortTaskName, type ActivityTreeNode } from "../types";
import { Empty, ErrorBanner, formatTime, Spinner, StatusBadge } from "../ui";

const STEP_ICON: Record<string, string> = {
  HUMAN_TASK: "👤",
  ACTIVITY: "⚙️",
  RETRY_TASK: "🔁",
};

export default function WorkflowDetailView() {
  const { workflowId = "" } = useParams();
  const info = useAsync(() => api.getWorkflow(workflowId), [workflowId]);
  const tree = useAsync(() => api.getActivityTree(workflowId), [workflowId]);
  const tasks = useAsync(() => api.listHumanTasks({ parentWorkflowId: workflowId }), [workflowId]);
  const retries = useAsync(() => api.listRetryTasks({ parentWorkflowId: workflowId }), [workflowId]);

  return (
    <div>
      <Link className="back-link" to="/workflows">← Back to failed orders</Link>

      <ErrorBanner error={info.error} />

      <div className="card">
        <div className="card-head">
          <h3>Workflow</h3>
          {info.data && <StatusBadge status={info.data.status} />}
        </div>
        <div className="card-body">
          {info.loading ? (
            <Spinner />
          ) : info.data ? (
            <KeyValues
              data={{
                "Workflow ID": info.data.workflowId,
                "Type": info.data.workflowType,
                "Status": info.data.status,
                ...(info.data.errorMessage ? { "Error": info.data.errorMessage } : {}),
                ...(info.data.result ? { "Result": info.data.result } : {}),
              }}
            />
          ) : (
            <Empty>Not found.</Empty>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head"><h3>Steps</h3></div>
        <div className="card-body">
          {tree.loading ? (
            <Spinner />
          ) : (tree.data ?? []).length === 0 ? (
            <Empty>No steps recorded yet.</Empty>
          ) : (
            <ul className="steps">
              {(tree.data ?? []).map((n) => (
                <Step key={n.id} node={n} />
              ))}
            </ul>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Human tasks</h3>
          <span className="pill-count">{(tasks.data ?? []).length}</span>
        </div>
        <div className="card-body">
          {tasks.loading ? (
            <Spinner />
          ) : (tasks.data ?? []).length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table>
              <tbody>
                {(tasks.data ?? []).map((t) => (
                  <tr key={t.taskId}>
                    <td>
                      <Link to={`/tasks/${encodeURIComponent(t.taskId)}`}>{shortTaskName(t.taskName)}</Link>
                    </td>
                    <td><StatusBadge status={t.status} /></td>
                    <td className="muted small">{formatTime(t.startTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      <div className="card">
        <div className="card-head">
          <h3>Failed activities</h3>
          <span className="pill-count">{(retries.data ?? []).length}</span>
        </div>
        <div className="card-body">
          {retries.loading ? (
            <Spinner />
          ) : (retries.data ?? []).length === 0 ? (
            <Empty>None.</Empty>
          ) : (
            <table>
              <tbody>
                {(retries.data ?? []).map((r) => (
                  <tr key={r.taskId}>
                    <td>
                      <Link to={`/failed-activities/${encodeURIComponent(r.taskId)}`}>
                        {r.activityName ? shortTaskName(r.activityName) : shortTaskName(r.taskName)}
                      </Link>
                    </td>
                    <td>
                      <StatusBadge status={isPending(r.status) ? "PENDING" : r.status} />
                    </td>
                    <td className="muted small">{formatTime(r.startTime)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}

function Step({ node }: { node: ActivityTreeNode }) {
  const icon = STEP_ICON[node.type] ?? "•";
  return (
    <li className="step">
      <span className="icon">{icon}</span>
      <div>
        <div className="step-name">{shortTaskName(node.name)}</div>
        <div className="step-meta">
          {node.type}
          {node.attempt && node.attempt > 1 ? ` · attempt ${node.attempt}` : ""} ·{" "}
          {formatTime(node.startTime)}
          {node.endTime ? ` → ${formatTime(node.endTime)}` : ""}
        </div>
        {node.failure?.message && (
          <div className="step-fail">
            {node.failure.message}
            {node.failure.cause ? `\n${node.failure.cause}` : ""}
          </div>
        )}
      </div>
      <StatusBadge status={node.status} />
    </li>
  );
}
