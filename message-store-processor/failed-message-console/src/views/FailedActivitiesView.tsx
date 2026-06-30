import { useState } from "react";
import { Link } from "react-router-dom";
import * as api from "../api";
import { usePagedList, Pager } from "../pagination";
import { isPending, matchesFilter, shortTaskName, type RetryTaskSummary, type StatusFilter } from "../types";
import { Empty, ErrorBanner, formatTime, Spinner, StatusBadge } from "../ui";
import { StatusFilterBar } from "../ui";

export default function FailedActivitiesView() {
  const [filter, setFilter] = useState<StatusFilter>("PENDING");
  const list = usePagedList<RetryTaskSummary>((pageToken) => api.listRetryTasksPage({ pageToken }), []);

  const tasks = list.items.filter((t) => matchesFilter(t.status, filter));

  return (
    <div>
      <h1 className="page-title">Failed Activities</h1>
      <p className="page-sub">
        Activities that failed under a manual-retry policy. Open one to see the failure and retry, edit input, or
        fail it.
      </p>

      <div className="toolbar">
        <StatusFilterBar value={filter} onChange={setFilter} />
        <span className="spacer" />
        <Pager
          pageIndex={list.pageIndex}
          canPrev={list.canPrev}
          canNext={list.canNext}
          onPrev={list.prev}
          onNext={list.next}
          count={tasks.length}
        />
      </div>

      <ErrorBanner error={list.error} />

      <div className="card">
        {list.loading ? (
          <Spinner />
        ) : tasks.length === 0 ? (
          <Empty>No {filter.toLowerCase()} failed activities on this page.</Empty>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Activity</th>
                <th>Workflow</th>
                <th>Status</th>
                <th>Started</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {tasks.map((t) => (
                <tr key={t.taskId}>
                  <td>
                    <Link to={`/failed-activities/${encodeURIComponent(t.taskId)}`}>
                      {t.activityName ? shortTaskName(t.activityName) : shortTaskName(t.taskName)}
                    </Link>
                  </td>
                  <td className="muted small mono">{t.parentWorkflowId}</td>
                  <td>
                    <StatusBadge status={isPending(t.status) ? "PENDING" : t.status} />
                  </td>
                  <td className="muted small">{formatTime(t.startTime)}</td>
                  <td className="row-actions">
                    <Link className="btn small" to={`/failed-activities/${encodeURIComponent(t.taskId)}`}>
                      Open
                    </Link>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
