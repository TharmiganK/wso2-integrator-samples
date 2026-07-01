import type {
  ActivityTreeNode,
  HumanTaskInfo,
  HumanTaskSummary,
  Page,
  RetryTaskInfo,
  RetryTaskSummary,
  Session,
  WorkflowInfo,
  WorkflowSummary,
} from "./types";

// The workflow type started by the processor when a sales order fails
// (see sales_order_processor/workflow.bal).
export const REVIEW_WORKFLOW_TYPE = "reviewFailedSalesOrderProcess";

let token: string | null = localStorage.getItem("ht_token");

export function setToken(value: string | null) {
  token = value;
  if (value) localStorage.setItem("ht_token", value);
  else localStorage.removeItem("ht_token");
}

export function getToken(): string | null {
  return token;
}

class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
    },
    ...(body !== undefined ? { body: JSON.stringify(body) } : {}),
  });
  const text = await res.text();
  const data = text ? safeParse(text) : null;
  if (!res.ok) {
    throw new ApiError(res.status, errorMessage(data) || `${res.status} ${res.statusText}`);
  }
  return data as T;
}

// Pull a human-readable string out of an error body. The workflow management API
// nests it as {error: {message}}, but plain {error: "..."} / {message: "..."}
// shapes are handled too, so the banner never renders "[object Object]".
function errorMessage(data: any): string | null {
  const field = data && (data.error ?? data.message);
  if (typeof field === "string") return field;
  if (field && typeof field === "object" && typeof field.message === "string") {
    return field.message;
  }
  return null;
}

function safeParse(text: string): any {
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

// List endpoints may return a {items: [...]} page envelope or a bare array.
function items<T>(data: any): T[] {
  if (Array.isArray(data)) return data as T[];
  if (data && Array.isArray(data.items)) return data.items as T[];
  return [];
}

function page<T>(data: any): Page<T> {
  return {
    items: items<T>(data),
    nextPageToken: (data && data.nextPageToken) || null,
    hasMore: Boolean(data && data.hasMore),
  };
}

function qs(params: Record<string, string | number | boolean | undefined>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v !== undefined && v !== "") sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : "";
}

// ---- Auth -----------------------------------------------------------------

export async function login(username: string, password: string): Promise<Session> {
  return request<Session>("POST", "/api/login", { username, password });
}

export async function logout(): Promise<void> {
  try {
    await request("POST", "/api/logout");
  } catch {
    /* ignore */
  }
}

// ---- Workflows ------------------------------------------------------------

export async function listWorkflows(
  params: { workflowType?: string; status?: string; limit?: number } = {},
): Promise<WorkflowSummary[]> {
  const data = await request<any>("GET", `/api/wf/workflows${qs({ limit: 100, ...params })}`);
  return items<WorkflowSummary>(data);
}

export async function listWorkflowsPage(
  params: {
    workflowType?: string;
    status?: string;
    limit?: number;
    pageToken?: string;
  } = {},
): Promise<Page<WorkflowSummary>> {
  const data = await request<any>("GET", `/api/wf/workflows${qs({ limit: 20, ...params })}`);
  return page<WorkflowSummary>(data);
}

export async function getWorkflow(workflowId: string): Promise<WorkflowInfo> {
  return request<WorkflowInfo>("GET", `/api/wf/workflows/${encodeURIComponent(workflowId)}`);
}

export async function getActivityTree(workflowId: string): Promise<ActivityTreeNode[]> {
  const data = await request<any>(
    "GET",
    `/api/wf/workflows/${encodeURIComponent(workflowId)}/activity-tree`,
  );
  return (data && Array.isArray(data.nodes) ? data.nodes : []) as ActivityTreeNode[];
}

// ---- Human tasks ----------------------------------------------------------

export async function listHumanTasks(
  params: {
    status?: string;
    parentWorkflowId?: string;
    onlyMyTasks?: boolean;
    limit?: number;
  } = {},
): Promise<HumanTaskSummary[]> {
  const data = await request<any>("GET", `/api/wf/human-tasks${qs({ limit: 100, ...params })}`);
  return items<HumanTaskSummary>(data);
}

export async function listHumanTasksPage(
  params: {
    status?: string;
    parentWorkflowId?: string;
    onlyMyTasks?: boolean;
    limit?: number;
    pageToken?: string;
  } = {},
): Promise<Page<HumanTaskSummary>> {
  const data = await request<any>("GET", `/api/wf/human-tasks${qs({ limit: 20, ...params })}`);
  return page<HumanTaskSummary>(data);
}

export async function getHumanTask(taskId: string): Promise<HumanTaskInfo> {
  return request<HumanTaskInfo>("GET", `/api/wf/human-tasks/${encodeURIComponent(taskId)}`);
}

export async function completeHumanTask(taskId: string, result: unknown): Promise<void> {
  await request("POST", `/api/wf/human-tasks/${encodeURIComponent(taskId)}/complete`, { result });
}

export async function failHumanTask(
  taskId: string,
  reason: string,
  details?: Record<string, unknown>,
): Promise<void> {
  await request("POST", `/api/wf/human-tasks/${encodeURIComponent(taskId)}/fail`, {
    reason,
    ...(details ? { details } : {}),
  });
}

// ---- Retry tasks (failed activities) --------------------------------------

export async function listRetryTasks(
  params: { status?: string; parentWorkflowId?: string; limit?: number } = {},
): Promise<RetryTaskSummary[]> {
  const data = await request<any>("GET", `/api/wf/retry-tasks${qs({ limit: 100, ...params })}`);
  return items<RetryTaskSummary>(data);
}

export async function listRetryTasksPage(
  params: { status?: string; parentWorkflowId?: string; limit?: number; pageToken?: string } = {},
): Promise<Page<RetryTaskSummary>> {
  const data = await request<any>("GET", `/api/wf/retry-tasks${qs({ limit: 20, ...params })}`);
  return page<RetryTaskSummary>(data);
}

export async function getRetryTask(taskId: string): Promise<RetryTaskInfo> {
  return request<RetryTaskInfo>("GET", `/api/wf/retry-tasks/${encodeURIComponent(taskId)}`);
}

export async function retryActivity(taskId: string): Promise<void> {
  await request("POST", `/api/wf/retry-tasks/${encodeURIComponent(taskId)}/retry`);
}

export async function retryActivityWithInput(
  taskId: string,
  input: Record<string, unknown>,
): Promise<void> {
  await request("POST", `/api/wf/retry-tasks/${encodeURIComponent(taskId)}/retry-with-input`, {
    input,
  });
}

export async function failActivity(taskId: string): Promise<void> {
  await request("POST", `/api/wf/retry-tasks/${encodeURIComponent(taskId)}/fail`);
}
