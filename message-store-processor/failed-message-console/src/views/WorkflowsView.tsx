import { useNavigate } from "react-router-dom";
import * as api from "../api";
import { REVIEW_WORKFLOW_TYPE } from "../api";
import { useAsync } from "../useAsync";
import { usePagedList, Pager } from "../pagination";
import { isPending, type WorkflowSummary } from "../types";
import { Empty, ErrorBanner, formatTime, Spinner, StatusBadge } from "../ui";

export default function WorkflowsView() {
  const list = usePagedList<WorkflowSummary>(
    (pageToken) => api.listWorkflowsPage({ workflowType: REVIEW_WORKFLOW_TYPE, pageToken }),
    [],
  );

  return (
    <div>
      <h1 className="page-title">Failed Sales Orders</h1>
      <p className="page-sub">
        Each <code>{REVIEW_WORKFLOW_TYPE}</code> instance — a sales order that failed processing and is awaiting
        review. Open one to see its steps, review tasks and failed replays.
      </p>

      <div className="toolbar">
        <span className="spacer" />
        <Pager
          pageIndex={list.pageIndex}
          canPrev={list.canPrev}
          canNext={list.canNext}
          onPrev={list.prev}
          onNext={list.next}
          count={list.items.length}
        />
      </div>

      <ErrorBanner error={list.error} />

      <div className="card">
        {list.loading ? (
          <Spinner />
        ) : list.items.length === 0 ? (
          <Empty>No failed sales orders yet. Submit an order that fails in SAP to create one.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Workflow</th>
                <th>Status</th>
                <th>Active human tasks</th>
                <th>Active failed activities</th>
                <th>Started</th>
              </tr>
            </thead>
            <tbody>
              {list.items.map((w) => (
                <WorkflowRow key={w.workflowId} wf={w} />
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}

function WorkflowRow({ wf }: { wf: WorkflowSummary }) {
  const navigate = useNavigate();
  // Counts are fetched per visible row (fine for a page of ~20).
  const counts = useAsync(async () => {
    const [tasks, retries] = await Promise.all([
      api.listHumanTasks({ parentWorkflowId: wf.workflowId }),
      api.listRetryTasks({ parentWorkflowId: wf.workflowId }),
    ]);
    return {
      activeTasks: tasks.filter((t) => isPending(t.status)).length,
      activeFailed: retries.filter((r) => isPending(r.status)).length,
    };
  }, [wf.workflowId]);

  const open = () => navigate(`/workflows/${encodeURIComponent(wf.workflowId)}`);

  return (
    <tr className="clickable" onClick={open}>
      <td>
        <a onClick={(e) => { e.preventDefault(); open(); }} href={`/workflows/${wf.workflowId}`}>
          {wf.workflowType}
        </a>
        <div className="muted small mono">{wf.workflowId}</div>
      </td>
      <td>
        <StatusBadge status={wf.status} />
      </td>
      <td>{counts.loading ? "…" : <span className="pill-count">{counts.data?.activeTasks ?? 0}</span>}</td>
      <td>{counts.loading ? "…" : <span className="pill-count">{counts.data?.activeFailed ?? 0}</span>}</td>
      <td className="muted small">{formatTime(wf.startTime)}</td>
    </tr>
  );
}
