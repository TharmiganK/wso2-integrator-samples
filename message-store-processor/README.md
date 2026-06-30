# Message Store and Message Processor

The **Message Store and Message Processor** is an enterprise integration pattern for reliable, asynchronous processing. Instead of calling a backend synchronously while the client waits, the integration first writes the incoming message to a durable **store** (a broker queue) and acknowledges the client immediately. A separate **processor** then consumes from the store at its own pace, calls the backend, and acknowledges each message only after it has been handled. Because a message stays on the store until it is successfully processed, nothing is lost when the backend is slow, unavailable, or the processor restarts — this is the pattern's **guaranteed delivery** property.

The samples in this directory implement the pattern with [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina), using its [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store` and `StoreListener` abstractions. They share a single use case — accepting **sales orders** over HTTP and creating them in **SAP S/4HANA** — and differ only in the message broker behind the store.

## The shared use case

```
   HTTP client ──▶ sales_order_store ──▶ [ broker: sales-orders ] ──▶ sales_order_processor ──▶ SAP S/4HANA
                                                                              │
                                       success ──▶ [ sales-orders-res ]   (audit)
                                       failure ──▶ review workflow ──▶ manager replays in console
                                                          └─ manager gives up ──▶ [ sales-orders-dlq ]
```

Each sample is built from the same packages:

- **`sales_order_store`** — an HTTP service that accepts a sales order and writes it to the `sales-orders` queue, returning `202 Accepted` as soon as the order is durably stored.
- **`sales_order_processor`** — a `messaging:StoreListener` that polls the queue, transforms each order into the SAP `CreateA_SalesOrder` shape, calls SAP S/4HANA, and records successful results on `sales-orders-res`. When an order fails to process or parse, instead of being retried in place it is handed to a durable **human-review workflow** (`ballerina/workflow`, backed by Temporal) so a manager can inspect and replay it. The `sales-orders-dlq` dead-letter queue is now the **terminal sink** — written only when the manager gives up on a message.
- **`mock_sap_endpoint`** — a stand-in SAP `API_SALES_ORDER_SRV` service that fails a configurable percentage of requests, so the review-and-replay path can be exercised without a real SAP system.

## Human-in-the-loop review and replay

A failed order no longer disappears into a dead-letter queue. The processor starts a durable `reviewFailedSalesOrderProcess` workflow and exposes it through the auto-started [`ballerina/workflow.management`](https://central.ballerina.io/ballerina/workflow) API (port `8234`). The separate **[`failed-message-console`](./failed-message-console)** — a React SPA + Express BFF, broker-agnostic — lets a manager:

- **Review** each failed order with its error and original payload,
- **Replay** it through SAP (optionally correcting the payload first), and
- if a replay fails again, **retry**, **retry with a corrected payload**, or **give up** — only a give-up moves the message to `sales-orders-dlq`.

Because the workflow runs on Temporal, this review/replay state is durable across restarts. A single-container Temporal dev server is included in each variant's `docker-compose.yml`, so it comes up with the broker; the processor's `Config.toml` selects `LOCAL` workflow mode to connect to it. See each variant README and the console README for the full run steps.

## The samples

| Sample | Broker | Store implementation | Management UI |
|---|---|---|---|
| [`rabbitmq-sap-s4hana`](./rabbitmq-sap-s4hana) | RabbitMQ | Built-in `rabbitmq:MessageStore` from `ballerinax/rabbitmq` | [http://localhost:15672](http://localhost:15672) (`guest`/`guest`) |
| [`solace-sap-s4hana`](./solace-sap-s4hana) | Solace PubSub+ | Custom `messaging:Store` in the bundled [`solace`](./solace-sap-s4hana/solace) package, over `ballerinax/solace` | [http://localhost:8080](http://localhost:8080) (`admin`/`admin`) |

Both samples expose the same HTTP API (`POST /api/sales-order` on port `9091`), the same mock SAP endpoint (HTTPS on port `9090`), and the same review/replay management API (port `8234`), so the application code (`sales_order_store`, `sales_order_processor`, `mock_sap_endpoint`) is nearly identical between them. The interesting difference is the store: RabbitMQ ships with a ready-made `messaging:Store`, while Solace shows how to build one yourself on top of a connector using transacted sessions for safe acknowledgments.

The **[`failed-message-console`](./failed-message-console)** is shared by both samples — point it at whichever processor is running.

| Port | Service |
|---|---|
| `9091` | `sales_order_store` HTTP API (`POST /api/sales-order`) |
| `9090` | `mock_sap_endpoint` (HTTPS) |
| `8234` | `workflow.management` review/replay API |
| `7233` · `8233` | Temporal dev server (gRPC · Web UI) — runs via `docker-compose.yml` |
| `5173` | Failed Sales Order Console (Vite) |
| `3001` | Console BFF (Express) |

## Replaying dead-lettered orders

Orders that end up on the `sales-orders-dlq` queue can be replayed back onto `sales-orders` **from the broker itself**, with no application code — the broker re-injects the message verbatim and `sales_order_processor` reprocesses it. See **[replaying-dead-lettered-orders.md](./replaying-dead-lettered-orders.md)** for the step-by-step runbook: the RabbitMQ Management UI (Shovel, or manual Get + Publish) and the Solace `copy-message` command (with the [`solace-sap-s4hana/replay-from-dlq.py`](./solace-sap-s4hana/replay-from-dlq.py) helper). The runbook also covers the feasibility of editing a message while replaying.

Pick the sample that matches your broker and follow its README — each is self-contained with full setup and run instructions.
