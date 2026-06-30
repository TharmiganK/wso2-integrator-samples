# Message Store and Processor: RabbitMQ → SAP S/4HANA

This sample implements the **Message Store and Message Processor** enterprise integration pattern with [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina). Incoming sales orders are accepted over HTTP, durably stored on a RabbitMQ queue, and then processed asynchronously into SAP S/4HANA. The pattern decouples the caller from the (slow, sometimes unavailable) backend and provides **guaranteed delivery**: an order is never lost, even if SAP is down or the processor restarts mid-flight.

This is the RabbitMQ variant. A functionally identical [Solace variant](../solace-sap-s4hana) lives alongside it; see the [pattern overview](../README.md) for how they compare.

## What it demonstrates

- Accepting work over HTTP and acknowledging it the instant it is durably stored, instead of blocking the caller on the backend call.
- Using Ballerina's [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `StoreListener` to consume from a store with automatic **retries** and **dead-lettering**.
- Driving an SAP S/4HANA `API_SALES_ORDER_SRV` OData service through the [`ballerinax/sap.s4hana.api_sales_order_srv`](https://central.ballerina.io/ballerinax/sap.s4hana.api_sales_order_srv) connector.
- Exercising the failure paths (retry, dead-letter) against a configurable mock SAP endpoint.

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
                         success ─────────────┐        └───────────── failure (after 2 retries)
                                              ▼                              ▼
                                  queue: sales-orders-res          queue: sales-orders-dlq
                                  (audit of created orders)        (dead-letter for analysis)
```

A message flows like this: the HTTP client posts a sales order; `sales_order_store` writes it to the `sales-orders` queue and immediately returns `202 Accepted`. `sales_order_processor` polls that queue, transforms each order into the SAP `CreateA_SalesOrder` shape, and calls SAP. On success the order id and totals are written to `sales-orders-res` for auditing and the message is acknowledged (removed). On failure the listener retries; once retries are exhausted, or if the payload cannot even be parsed, the message is moved to `sales-orders-dlq`.

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
├── sales_order_processor/     # Consumes orders, calls SAP, retries / dead-letters
└── mock_sap_endpoint/         # Stand-in SAP S/4HANA service with failure injection
```

## Components

| Package | Type | Port | Role |
|---|---|---|---|
| `sales_order_store` | HTTP service | `9091` | Accepts `POST /api/sales-order` and stores each order on the `sales-orders` queue. |
| `sales_order_processor` | `messaging:StoreListener` | — | Polls `sales-orders`, calls SAP, writes results to `sales-orders-res`, dead-letters failures to `sales-orders-dlq`. |
| `mock_sap_endpoint` | HTTPS service | `9090` | Mocks SAP `API_SALES_ORDER_SRV`; fails a configurable percentage of requests so retry / dead-letter handling can be observed. |

## Prerequisites

- [Ballerina](https://ballerina.io/downloads/) `2201.13.4` (Swan Lake) or later.
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose, to run the RabbitMQ broker.

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

The store and listener tuning knobs are set in code in `sales_order_processor/main.bal`: `pollingInterval` (10s), `maxRetries` (2) and `retryInterval` (2s). The mock failure rate is set with `failurePercentage` in `mock_sap_endpoint/Config.toml` (default `30`; use `0` to always succeed or `100` to always fail).

## Running the sample

**1. Start the RabbitMQ broker.** From this directory:

```bash
docker compose up -d
```

This starts RabbitMQ with the `sales-orders`, `sales-orders-dlq` and `sales-orders-res` queues already declared (loaded from `rabbitmq/definitions.json`). The management UI is at [http://localhost:15672](http://localhost:15672) (`guest`/`guest`).

**2. Start the mock SAP endpoint.** In a new terminal:

```bash
cd mock_sap_endpoint
bal run
```

**3. Start the processor.** In a new terminal:

```bash
cd sales_order_processor
bal run
```

**4. Start the store.** In a new terminal:

```bash
cd sales_order_store
bal run
```

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

You get back `202 Accepted` as soon as the order is stored. Watch the `sales_order_processor` logs to see it picked up, sent to SAP, and either succeeding (an order id is logged and a record lands on `sales-orders-res`) or failing and being retried.

To watch the guaranteed-delivery behaviour clearly, set `failurePercentage = 100` in `mock_sap_endpoint/Config.toml` and restart the mock: every order is retried twice and then ends up on `sales-orders-dlq`. You can inspect all three queues and their message counts in the [RabbitMQ management UI](http://localhost:15672).

## Cleaning up

```bash
docker compose down -v
```

The `-v` flag also removes the broker's data volume so the next run starts from a clean state.
