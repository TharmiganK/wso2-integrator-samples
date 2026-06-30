# Message Store and Processor: RabbitMQ → SAP S/4HANA

This sample implements the **Message Store and Message Processor** enterprise integration pattern with [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina). Incoming sales orders are accepted over HTTP, durably stored on a RabbitMQ queue, and then processed asynchronously into SAP S/4HANA. The pattern decouples the caller from the (slow, sometimes unavailable) backend and provides **guaranteed delivery**: an order is never lost, even if SAP is down or the processor restarts mid-flight.

This is the RabbitMQ variant. A functionally identical [Solace variant](../solace-sap-s4hana) lives alongside it; see the [pattern overview](../README.md) for how they compare.

## What it demonstrates

- Accepting work over HTTP and acknowledging it the instant it is durably stored, instead of blocking the caller on the backend call.
- Using Ballerina's [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `StoreListener` to consume from a store.
- Driving an SAP S/4HANA `API_SALES_ORDER_SRV` OData service through the [`ballerinax/sap.s4hana.api_sales_order_srv`](https://central.ballerina.io/ballerinax/sap.s4hana.api_sales_order_srv) connector.
- Routing failed orders to a durable **human-in-the-loop review workflow** ([`ballerina/workflow`](https://central.ballerina.io/ballerina/workflow)) that a manager replays from the [Failed Sales Order Console](../failed-message-console), with `sales-orders-dlq` as the terminal sink.

## Architecture

```
                POST /api/sales-order (9091)
   HTTP client ───────────────────────────────▶ sales_order_store
                                                       │ store()
                                                       ▼
                                          ┌─────────────────────────┐
                                          │  RabbitMQ               │
                                          │  queue: sales-orders    │
                                          └─────────────────────────┘
                                                       │ retrieve() (poll every 10s)
                                                       ▼
                                                sales_order_processor
                                                       │ createA_SalesOrder()
                                                       ▼
                                          mock_sap_endpoint (HTTPS 9090)
                                          70% success · 30% failure
                                                       │
                         success ─────────────┐        └───────────── failure / parse error
                                              ▼                              ▼
                                  queue: sales-orders-res        reviewFailedSalesOrderProcess (workflow)
                                  (audit of created orders)               │ awaitHumanTask("manager")
                                                                          ▼
                                                       Failed Sales Order Console (5173 ◀ 8234)
                                                            replay ─▶ SAP   ·   give up ─▶ sales-orders-dlq
```

A message flows like this: the HTTP client posts a sales order; `sales_order_store` writes it to the `sales-orders` queue and immediately returns `202 Accepted`. `sales_order_processor` polls that queue, transforms each order into the SAP `CreateA_SalesOrder` shape, and calls SAP. On success the order id and totals are written to `sales-orders-res` for auditing and the message is acknowledged (removed). On failure — or if the payload cannot be parsed — the processor starts a durable `reviewFailedSalesOrderProcess` workflow and acknowledges the message off the queue; the workflow now owns it. A manager opens the [Failed Sales Order Console](../failed-message-console), reviews the failure, and **replays** the order (optionally correcting the payload). A replay that fails again becomes a manual retry-task; only when the manager **gives up** is the message moved to `sales-orders-dlq`.

## Project structure

```
rabbitmq-sap-s4hana/
├── Ballerina.toml             # Workspace tying the three packages together
├── docker-compose.yml         # RabbitMQ broker (with management UI)
├── rabbitmq/
│   ├── rabbitmq.conf          # Loads definitions.json on broker startup
│   └── definitions.json       # Declares the sales-orders, -dlq and -res queues
├── resources/                 # TLS cert/key used by the mock SAP HTTPS endpoint
├── sales_order_store/         # HTTP API → stores orders on the broker
├── sales_order_processor/     # Consumes orders, calls SAP, starts review workflows
│                              #   (workflow.bal) and exposes the management API (8234)
└── mock_sap_endpoint/         # Stand-in SAP S/4HANA service with failure injection
```

The [`failed-message-console`](../failed-message-console) (the review/replay UI) is a sibling project shared by both broker variants.

## Components

| Package | Type | Port | Role |
|---|---|---|---|
| `sales_order_store` | HTTP service | `9091` | Accepts `POST /api/sales-order` and stores each order on the `sales-orders` queue. |
| `sales_order_processor` | `messaging:StoreListener` + `workflow` | `8234` | Polls `sales-orders`, calls SAP, writes results to `sales-orders-res`. Starts a review workflow for failures and exposes the `workflow.management` API on `8234`. |
| `mock_sap_endpoint` | HTTPS service | `9090` | Mocks SAP `API_SALES_ORDER_SRV`; fails a configurable percentage of requests so the review / replay path can be observed. |

## Prerequisites

- [Ballerina](https://ballerina.io/downloads/) `2201.13.4` (Swan Lake) or later.
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose, to run the RabbitMQ broker and the Temporal dev server (both are in `docker-compose.yml` — no separate Temporal install needed).
- [Node.js](https://nodejs.org/) 18+, to run the [Failed Sales Order Console](../failed-message-console).

## Configuration

Connection details live in each package's `Config.toml` and point at the local Docker broker and the local mock SAP endpoint out of the box.

`sales_order_processor/Config.toml`:

```toml
salesOrderQueueName    = "sales-orders"
deadLetterQueueName    = "sales-orders-dlq"
salesOrderResQueueName = "sales-orders-res"

sapS4hanaUserName = "sap-user"
sapS4hanaPassword = "sap-password"
sapS4hanaHostName = "localhost"
sapS4hanaPort     = 9090

[salesOrderStoreConfig]
host = "localhost"
port = 5672

[salesOrderStoreConfig.connectionData]
username    = "guest"
password    = "guest"
virtualHost = "/"
# deadLetterStoreConfig and salesOrderResStoreConfig follow the same shape.
```

The store and listener tuning knobs are set in code in `sales_order_processor/main.bal`: `pollingInterval` (10s) and `maxRetries` (`0` — in-place retry is disabled because failures are handed to the review workflow instead). The mock failure rate is set with `failurePercentage` in `mock_sap_endpoint/Config.toml` (default `30`; use `0` to always succeed or `100` to always fail).

The review workflow needs the management API backed by a real server, so `sales_order_processor/Config.toml` also selects `LOCAL` workflow mode against the Temporal dev server and enables the management API:

```toml
# sales_order_processor/Config.toml (workflow section)
[ballerina.workflow]
mode = "LOCAL"
url = "localhost:7233"
namespace = "default"

[ballerina.workflow.management]
enableManagementApi = true
enableBasicAuth = false   # the console's BFF is the trust boundary
```

## Running the sample

**1. Start the broker and Temporal.** From this directory:

```bash
docker compose up -d
```

This starts RabbitMQ — with the `sales-orders`, `sales-orders-dlq` and `sales-orders-res` queues already declared (loaded from `rabbitmq/definitions.json`); management UI at [http://localhost:15672](http://localhost:15672) (`guest`/`guest`) — and a single-container **Temporal** dev server that backs the durable review workflows (gRPC on `:7233`, Web UI at [http://localhost:8233](http://localhost:8233)).

**2. Start the mock SAP endpoint.** In a new terminal:

```bash
cd mock_sap_endpoint
bal run
```

**3. Start the processor** (its `Config.toml` enables `LOCAL` mode and the management API on `:8234`). In a new terminal:

```bash
cd sales_order_processor
bal run
```

**4. Start the store.** In a new terminal:

```bash
cd sales_order_store
bal run
```

**5. Start the Failed Sales Order Console.** In a new terminal:

```bash
cd ../failed-message-console
npm install
npm run dev      # BFF on :3001, UI on :5173
```

Open [http://localhost:5173](http://localhost:5173) and sign in as `manager` / `manager123`.

## Trying it out

Post a sales order to the store:

```bash
curl -X POST http://localhost:9091/api/sales-order \
  -H "Content-Type: application/json" \
  -d '{
    "refId": "REQ-1001",
    "orderType": "OR",
    "salesOrganization": "1710",
    "distributionChannel": "10",
    "division": "00",
    "soldToParty": "17100001",
    "customerPurchaseOrder": "PO-55231",
    "requestedDeliveryDate": "2026-07-15",
    "currency": "USD",
    "paymentTerms": "0001",
    "items": [
      {
        "itemNumber": "10",
        "materialCode": "TG11",
        "quantity": "5",
        "quantityUnit": "EA",
        "description": "Wireless mouse",
        "itemCategory": "TAN",
        "plant": "1710"
      }
    ]
  }'
```

You get back `202 Accepted` as soon as the order is stored. Watch the `sales_order_processor` logs to see it picked up, sent to SAP, and either succeeding (an order id is logged and a record lands on `sales-orders-res`) or failing and starting a review workflow.

To watch the human-in-the-loop path clearly, set `failurePercentage = 100` in `mock_sap_endpoint/Config.toml` and restart the mock: every order fails and appears under **Failed Sales Orders** in the [console](http://localhost:5173). Open one, lower `failurePercentage` back to `0`, and **replay** it — it now succeeds and a record lands on `sales-orders-res`. To see the terminal sink, keep `failurePercentage = 100`, replay, let the replay fail, then **give up** on the resulting failed replay — the message is moved to `sales-orders-dlq`, which you can inspect in the [RabbitMQ management UI](http://localhost:15672). Posting a malformed payload instead exercises the parse-error path, where you can fix the order via **retry with new input**.

## Cleaning up

```bash
docker compose down -v
```

The `-v` flag also removes the broker's data volume so the next run starts from a clean state.
