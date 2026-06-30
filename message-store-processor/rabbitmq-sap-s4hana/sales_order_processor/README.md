# Sales Order Processor (RabbitMQ)

The **consumer** of the [RabbitMQ → SAP S/4HANA](../README.md) sample. A
[`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging)
`StoreListener` polls the `sales-orders` queue, transforms each order into the SAP
`CreateA_SalesOrder` shape, and creates it in SAP S/4HANA. Successful results are
audited to `sales-orders-res`.

When an order **fails to process or parse**, it is not retried in place — the
processor starts a durable **human-review workflow**
([`ballerina/workflow`](https://central.ballerina.io/ballerina/workflow), backed
by Temporal) and acknowledges the message off the queue. A manager then reviews
and **replays** it from the [Failed Sales Order Console](../../failed-message-console).
The `sales-orders-dlq` dead-letter queue is the **terminal sink** — written only
when the manager gives up.

## Flow

```
[ sales-orders ] ──poll──▶ onMessage ──ok──▶ SAP ──▶ [ sales-orders-res ] (audit)
                               │
                  parse / processing failure
                               ▼
                  workflow:run(reviewFailedSalesOrderProcess)   ── management API :8234 ──┐
                               │ awaitHumanTask("manager")                                ▼
                               │                                       Failed Sales Order Console
                  replay ─▶ SAP (ManualRetry)                              (manager reviews / replays)
                   ok ─▶ done            fail ─▶ retry-task ─▶ give up ─▶ [ sales-orders-dlq ]
```

Importing `ballerina/workflow.management` auto-starts the management REST API on
`:8234` (base path `/workflow`), which the console consumes.

## Source layout

| File | Role |
|---|---|
| `main.bal` | The `StoreListener` (`maxRetries: 0`) and `onMessage`, which starts a review workflow on parse/processing failures. Imports `workflow.management` to expose the API. |
| `workflow.bal` | The `reviewFailedSalesOrderProcess` workflow plus the `replaySalesOrder` and `deadLetterActivity` activities. Replay uses `workflow:ManualRetry`; a give-up routes to the dead-letter store. Workflow-body logs are guarded by `isReplaying()`. |
| `functions.bal` | `processSalesOrder` — maps the order to SAP, calls `API_SALES_ORDER_SRV`, and audits the result. Reused by the replay activity. |
| `data_mappings.bal` | Order → SAP `CreateA_SalesOrder` transforms. |
| `connections.bal` | The three stores (`rabbitmq:MessageStore`) and the SAP client (with a small `retryConfig` for transient errors). |
| `types.bal` | `SalesOrderRequest` / `SalesOrderResponse` plus the `FailedSalesOrderReview` and `SalesOrderReviewDecision` workflow records. |
| `config.bal` / `Config.toml` | Store configs, queue names, SAP credentials, and the workflow runtime (`LOCAL` mode + management API). |

## Configuration

`Config.toml` holds the three store connections (RabbitMQ on `localhost:5672`,
`guest`/`guest`), the queue names, and the SAP endpoint (the local
[`mock_sap_endpoint`](../mock_sap_endpoint) on `9090`). The listener knobs are in
`main.bal`: `pollingInterval` (10s) and `maxRetries` (`0`).

The same `Config.toml` also wires the review workflow to Temporal:

```toml
[ballerina.workflow]
mode = "LOCAL"
url = "localhost:7233"
namespace = "default"

[ballerina.workflow.management]
enableManagementApi = true
enableBasicAuth = false   # the console's BFF is the trust boundary
```

## Running

Needs the RabbitMQ broker and Temporal (both come up with `docker compose up -d`)
and the [`mock_sap_endpoint`](../mock_sap_endpoint) running first (see the
[sample README](../README.md#running-the-sample)). Then:

```bash
bal run
```

The review/replay UI is the shared
[`failed-message-console`](../../failed-message-console).
