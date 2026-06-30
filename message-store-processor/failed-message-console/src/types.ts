// Mirrors the records returned by ballerina/workflow.management.

export interface Session {
  token: string;
  userId: string;
  roles: string[];
}

export interface HumanTaskSummary {
  taskId: string;
  taskName: string;
  parentWorkflowId: string;
  parentWorkflowType: string | null;
  status: string;
  startTime: string;
  closeTime: string | null;
  userRoles: string[];
  canComplete: boolean;
}

export interface HumanTaskInfo {
  taskId: string;
  taskName: string;
  parentWorkflowId: string;
  status: string;
  startTime: string;
  closeTime: string | null;
  title: string;
  description: string;
  userRoles: string[];
  payload: Record<string, unknown> | null;
  createdAt: string;
  formSchema: string | null;
  completedBy: string | null;
  completedAt: string | null;
  result: unknown;
}

export interface RetryTaskSummary {
  taskId: string;
  taskName: string;
  activityName: string;
  parentWorkflowId: string;
  status: string;
  startTime: string;
  closeTime: string | null;
}

export interface RetryTaskInfo extends RetryTaskSummary {
  userRoles: string[];
  errorMessage: string;
  activityArgs: Record<string, unknown> | null;
  createdAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
}

export interface WorkflowSummary {
  workflowId: string;
  workflowType: string;
  status: string;
  startTime?: string;
  closeTime?: string | null;
  [key: string]: unknown;
}

export interface WorkflowInfo {
  workflowId: string;
  workflowType: string;
  status: string;
  result: unknown;
  errorMessage: string | null;
  activityInvocations: unknown[];
}

export interface ActivityTreeNode {
  id: string;
  name: string;
  type: string; // HUMAN_TASK | ACTIVITY | RETRY_TASK | ...
  status: string;
  startTime: string | null;
  endTime: string | null;
  input: unknown;
  output: unknown;
  failure: { message?: string; type?: string; cause?: string } | null;
  attempt: number | null;
  children: ActivityTreeNode[] | null;
}

export interface Page<T> {
  items: T[];
  nextPageToken: string | null;
  hasMore: boolean;
}

// The status values reported by the runtime for "still waiting / open" work.
const PENDING_STATUSES = new Set(["RUNNING", "PENDING", "OPEN", "SCHEDULED", "STARTED"]);

export function isPending(status: string): boolean {
  return PENDING_STATUSES.has((status || "").toUpperCase());
}

export type StatusFilter = "PENDING" | "COMPLETED" | "ALL";

export function matchesFilter(status: string, filter: StatusFilter): boolean {
  if (filter === "ALL") return true;
  return filter === "PENDING" ? isPending(status) : !isPending(status);
}

// Strip the "<workflowType>." prefix the runtime adds to task names.
export function shortTaskName(name: string): string {
  const dot = name.indexOf(".");
  return dot >= 0 ? name.slice(dot + 1) : name;
}
