# Failed Sales Order Console

A small Vite + React (TypeScript) single-page app where **managers review and
replay sales orders that failed processing** in the message-store-processor
samples. When the `sales_order_processor` cannot process (or parse) an order it
starts a durable `reviewFailedSalesOrderProcess` workflow; this console lists
those failures and lets a manager replay them — optionally with a corrected
payload — through the `ballerina/workflow.management` API.

The console is **broker-agnostic**: it talks to the management API (default
`:8234`), so the same UI works against whichever processor is running — the
[RabbitMQ](../rabbitmq-sap-s4hana) or the [Solace](../solace-sap-s4hana) variant.

## Why a BFF?

The management API identifies the caller via `x-user-id` / `x-user-roles`
headers. A browser must never set those itself (any user could then claim any
role). So a small Express server (`server/index.mjs`) is the trust boundary:

```
browser ──login──▶ BFF ──(validates against users.txt)──▶ issues bearer token
browser ──/api/wf/* + Bearer──▶ BFF ──injects x-user-id/x-user-roles──▶ :8234/workflow/*
```

The BFF authenticates against a **plain-text user store** (`users.txt`, demo
only) and proxies `/api/wf/*` to the management API, injecting the logged-in
user's id and roles. The review workflow assigns tasks to the **`manager`**
role.

## User store

`users.txt`, one user per line — `username:password:comma,roles`:

```
manager:manager123:manager
ops:ops123:manager
admin:admin123:manager,admin
```

## Views

All lists are **paginated** (cursor-based, via the API's `pageToken` /
`nextPageToken`).

1. **Failed Sales Orders** — a list of `reviewFailedSalesOrderProcess` instances
   showing status plus the count of **active review tasks** and **active failed
   replays**. Click a row to open the **workflow detail**, which shows the steps
   taken (from the activity tree), its review tasks, and its failed replays.
2. **Review Tasks** — review tasks for the logged-in manager, filterable by
   Pending / Completed / All. Open one to act on it. The detail is **tabbed**:
   - **Replay** — a form generated from the task schema (an optional corrected
     order — pre-filled with the original — and comments) plus a primary
     *Replay order* button. Completing the task replays the order through SAP.
   - **Discard** — *Discard to DLQ*, which opens a confirmation dialog with a
     reason and moves the message to the dead-letter queue instead of replaying.
3. **Failed Replays** — manual-retry tasks created when a replay fails again,
   filterable by status. Open one to see the failure and either **Retry**,
   **Retry with new input** (a corrected order), or **Fail** it (which moves the
   message to the dead-letter queue). Once actioned the detail shows the outcome
   (who decided and when).

### Processing indicator

Workflow actions (completing a task, retrying a replay) advance the workflow
asynchronously, so after each action the UI shows a processing overlay, waits
briefly, and then refreshes so the updated status is visible.

## Dynamic rendering

- **Task input** (the failed order + error) is rendered from the task `payload`
  one level deep (`KeyValues`), so new payload fields appear automatically.
- **Completion form** is generated from the task's `formSchema` (a JSON schema
  the runtime derives from the `SalesOrderReviewDecision` result type). If a task
  has no schema, a per-task config or a raw-JSON editor is used.
- **Retry-with-input** form is generated from the failed replay's recorded
  `activityArgs` (the original order), so the manager can correct and resubmit.

## Running

The console needs the management API backed by a real server, so run a
`sales_order_processor` in `LOCAL` mode against a Temporal dev server (see the
variant READMEs). Once `:8234` is up:

```bash
npm install
npm run dev      # starts the BFF (:3001) and Vite (:5173) together
```

Open http://localhost:5173 and sign in as `manager` / `manager123`.

### Configuration

| Env var      | Default                          | Purpose                         |
| ------------ | -------------------------------- | ------------------------------- |
| `PORT`       | `3001`                           | BFF port                        |
| `MGMT_URL`   | `http://localhost:8234/workflow` | Management API base URL         |
| `USERS_FILE` | `./users.txt`                    | Path to the plain-text store    |

## Layout

```
failed-message-console/
├── server/index.mjs     # BFF: login, sessions, header-injecting proxy
├── users.txt            # demo user store (plain text)
└── src/
    ├── api.ts           # typed calls to the BFF (incl. paginated list helpers)
    ├── auth.tsx         # auth context + token storage
    ├── dynamic.tsx      # dynamic value rendering + form generation
    ├── pagination.tsx   # usePagedList hook + Pager
    ├── processing.tsx   # processing overlay, modal, tabs
    ├── views/           # Login, Workflows(+Detail), Tasks(+Detail), FailedActivities(+Detail)
    └── styles.css       # white theme
```
