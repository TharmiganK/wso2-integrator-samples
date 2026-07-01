# Message Store and Processor: Solace → SAP S/4HANA

This sample implements the **Message Store and Message Processor** enterprise integration pattern with [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina). Incoming sales orders are accepted over HTTP, durably stored on a Solace PubSub+ queue, and then processed asynchronously into SAP S/4HANA. The pattern decouples the caller from the (slow, sometimes unavailable) backend and provides **guaranteed delivery**: an order is never lost, even if SAP is down or the processor restarts mid-flight.

This is the Solace variant. A functionally identical [RabbitMQ variant](../rabbitmq-sap-s4hana) lives alongside it; see the [pattern overview](../README.md) for how they compare. The key difference is that Solace is not yet a built-in `messaging:Store` provider, so this sample includes a small reusable [`solace`](./solace) package that implements the store contract on top of the [`ballerinax/solace`](https://central.ballerina.io/ballerinax/solace) connector.

## What it demonstrates

- Accepting work over HTTP and acknowledging it the instant it is durably stored, instead of blocking the caller on the backend call.
- Implementing a custom [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store` over Solace using transacted sessions for safe, re-deliverable acknowledgments — see [`solace/README.md`](./solace/README.md).
- Using a `messaging:StoreListener` to consume from that store with automatic **retries** and **dead-lettering**.
- Driving an SAP S/4HANA `API_SALES_ORDER_SRV` OData service through the [`ballerinax/sap.s4hana.api_sales_order_srv`](https://central.ballerina.io/ballerinax/sap.s4hana.api_sales_order_srv) connector.

## Architecture

```
                POST /api/sales-order (9091)
   HTTP client ───────────────────────────────▶ sales_order_store
                                                       │ store()  (via wso2/solace)
                                                       ▼
                                          ┌─────────────────────────┐
                                          │  Solace PubSub+         │
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

A message flows like this: the HTTP client posts a sales order; `sales_order_store` writes it to the `sales-orders` queue and immediately returns `202 Accepted`. `sales_order_processor` polls that queue, transforms each order into the SAP `CreateA_SalesOrder` shape, and calls SAP. On success the order id and totals are written to `sales-orders-res` for auditing and the message is acknowledged (the transacted receive is committed and the message leaves the queue). On failure the listener retries; once retries are exhausted, or if the payload cannot even be parsed, the message is moved to `sales-orders-dlq`.

## Project structure

```
solace-sap-s4hana/
├── Ballerina.toml             # Workspace tying the four packages together
├── docker-compose.yml         # Solace broker + one-shot queue provisioning job + message utility UI
├── resources/                 # TLS cert/key used by the mock SAP HTTPS endpoint
├── solace/                    # Reusable messaging:Store implementation over Solace
├── sales_order_store/         # HTTP API → stores orders on the broker
├── sales_order_processor/     # Consumes orders, calls SAP, retries / dead-letters
└── mock_sap_endpoint/         # Stand-in SAP S/4HANA service with failure injection
```

## Components

| Package | Type | Port | Role |
|---|---|---|---|
| `solace` | Library | — | Implements `messaging:Store` over the `ballerinax/solace` connector using transacted producer/consumer sessions. See its [README](./solace/README.md). |
| `sales_order_store` | HTTP service | `9091` | Accepts `POST /api/sales-order` and stores each order on the `sales-orders` queue. |
| `sales_order_processor` | `messaging:StoreListener` | — | Polls `sales-orders`, calls SAP, writes results to `sales-orders-res`, dead-letters failures to `sales-orders-dlq`. |
| `mock_sap_endpoint` | HTTPS service | `9090` | Mocks SAP `API_SALES_ORDER_SRV`; fails a configurable percentage of requests so retry / dead-letter handling can be observed. |

## Prerequisites

- [Ballerina](https://ballerina.io/downloads/) `2201.13.4` (Swan Lake) or later.
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose, to run the Solace broker.

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
url        = "tcp://localhost:45555"
messageVpn = "default"

[salesOrderStoreConfig.auth]
username = "admin"
password = "admin"
# deadLetterStoreConfig and salesOrderResStoreConfig follow the same shape.
```

Note the SMF port `45555`: the Solace default is `55555`, but that falls inside the macOS ephemeral port range, so `docker-compose.yml` remaps it to `45555` on the host. The store and listener tuning knobs (`pollingInterval`, `maxRetries`, `retryInterval`) are set in code in `sales_order_processor/main.bal`. The mock failure rate is set with `failurePercentage` in `mock_sap_endpoint/Config.toml` (default `30`; use `0` to always succeed or `100` to always fail).

## Running the sample

**1. Start the Solace broker.** From this directory:

```bash
docker compose up -d
```

This starts Solace PubSub+, runs a one-shot `solace-init` container that provisions the `sales-orders`, `sales-orders-dlq` and `sales-orders-res` queues via the SEMP API once the broker is healthy, and starts the [`solace-msg-utility`](https://github.com/SolaceLabs/solace-msg-utility) browser UI for browsing/copying/moving queued messages (a one-shot `solace-msg-utility-init` job first downloads the UI's `solclient.js`/`jszip.min.js` vendor scripts, which the published image does not bundle). The SEMP management UI is at [http://localhost:8080](http://localhost:8080) (`admin`/`admin`); the message utility UI is at [https://localhost:9444](https://localhost:9444) (self-signed cert — accept the browser warning). The broker can take up to a minute to become healthy on first start. See [replaying dead-lettered orders](../replaying-dead-lettered-orders.md) for using the UI to replay the DLQ.

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

To watch the guaranteed-delivery behaviour clearly, set `failurePercentage = 100` in `mock_sap_endpoint/Config.toml` and restart the mock: every order is retried twice and then ends up on `sales-orders-dlq`. You can inspect all three queues and their message counts under **Queues** in the [Solace SEMP UI](http://localhost:8080).

## Replaying dead-lettered orders

Once the root cause is fixed (e.g. set `failurePercentage = 0` and restart the mock), the orders sitting on `sales-orders-dlq` can be replayed back onto `sales-orders` **from the broker itself**, with no application change — `sales_order_processor` then reprocesses them normally.

The quickest way is the [`solace-msg-utility`](https://github.com/SolaceLabs/solace-msg-utility) web UI that `docker compose up` already started at [https://localhost:9444](https://localhost:9444):

1. **Connections** → Broker Host `solace`, SMF port `8008` (TLS off), SEMP port `8080` (TLS off), VPN `default`, user `admin` / `admin` → **Connect** (both status dots green).
2. **Queue Copy** → Source `sales-orders-dlq`, Destination `sales-orders`, mode **Move** (clears the DLQ) or **Copy** (keeps an audit copy) → confirm → **Copy**/**Move**.

The broker CLI's `copy-message` command is a UI-free fallback. See the [DLQ replay runbook](../replaying-dead-lettered-orders.md) for the full walkthrough (including the connection and TLS details) and the RabbitMQ equivalent.

## Observability with Datadog

The two integration services publish **metrics** (Prometheus) and **distributed traces**
(OpenTelemetry) that can be viewed in [Datadog](https://www.datadoghq.com/). A Datadog
Agent runs in Docker alongside the broker: it **scrapes** the services' `/metrics`
endpoints and receives **OTLP traces** the services push to it.

```
  sales_order_store (host :9797 /metrics) ─┐  scrape
  sales_order_processor (host :9798 /metrics) ─┴──────▶ Datadog Agent ──▶ Datadog
  sales_order_store / processor  ──OTLP gRPC push──▶  (localhost:4317)
```

| Service | Metrics endpoint | Traces |
|---|---|---|
| `sales_order_store` | `http://localhost:9797/metrics` | → Agent `localhost:4317` (OTLP/gRPC) |
| `sales_order_processor` | `http://localhost:9798/metrics` | → Agent `localhost:4317` (OTLP/gRPC) |

The extensions are imported in each `main.bal` and `remoteManagement = true` is set in
each `Ballerina.toml` — both committed. The runtime toggle lives in each package's
`Config.toml`, which is **git-ignored** (it holds local dev config), so add the block
below to your local `Config.toml` if it isn't already there — using **port `9797` for
`sales_order_store`** and **`9798` for `sales_order_processor`** so the two `/metrics`
endpoints don't collide:

```toml
[ballerina.observe]
tracingEnabled = true
tracingProvider = "jaeger"
metricsEnabled = true
metricsReporter = "prometheus"

[ballerinax.prometheus]
port = 9797            # sales_order_store; use 9798 for sales_order_processor
host = "0.0.0.0"       # bind all interfaces so the Dockerised Agent can scrape via host.docker.internal

[ballerinax.jaeger]
agentHostname = "localhost"   # the Agent's OTLP port is published to the host
agentPort = 4317
samplerType = "const"
samplerParam = 1.0
reporterFlushInterval = 2000
reporterBufferSize = 1000
```

**Prerequisites**

- A [Datadog account](https://www.datadoghq.com/) and an API key
  (**Organization Settings → API Keys**).
- Add the **OpenMetrics** integration to your Datadog account (Integrations tab).

**1. Provide your API key.** From this directory:

```bash
cp datadog/.env.example .env
# edit .env and set DD_API_KEY=<your-key>
```

`.env` is gitignored. `.env.example` also sets `DD_SITE` (default
`datadoghq.com`) and `DD_SERVICE`; change `DD_SITE` in your `.env` if your
account is on another site (e.g. `datadoghq.eu`).

**2. Start the broker together with the Datadog Agent.** The Agent is behind an
`observability` Compose profile, so enable it explicitly:

```bash
docker compose --profile observability up -d
```

(Without the profile, `docker compose up -d` still starts just the broker and its
queue-provisioning init container.) Verify the Agent picked up the OpenMetrics check and
OTLP receiver:

```bash
docker exec demo-datadog-agent agent status | grep -A5 -iE "openmetrics|otlp|apm"
```

**3. Run the services** as in [Running the sample](#running-the-sample) and send a few
orders. The Agent scrapes host ports `9797`/`9798` (via `host.docker.internal`) and the
services push traces to `localhost:4317`.

**4. View in Datadog.**

- **Metrics** → *Metrics Explorer*: search for `ballerina.*`. Ballerina ships a ready-made
  dashboard you can import under *Dashboards → New → Import*:
  [`ballerina_metrics_dashboard.json`](https://raw.githubusercontent.com/ballerina-platform/module-ballerinax-prometheus/refs/heads/main/metrics-dashboards/datadog/ballerina_metrics_dashboard.json).
- **APM → Traces**: filter by service (`sales_order_store`, `sales_order_processor`) to
  inspect spans and tags.
- **Logs → Log Explorer**: filter `source:ballerina` (and `env:dev` or a `service:`) — see
  the *Logs* note below to enable shipping.

### Logs

The services run on the host via `bal run`, so the Dockerised Agent can't grab their
stdout directly. Instead each service writes **JSON logs to a file** under the sample-root
`logs/` directory, and the Agent tails those files (`DD_LOGS_ENABLED=true` +
`datadog/conf.d/ballerina.d/conf.yaml`, both already in the compose setup).

Enabling this is a one-line-per-service addition to your local `Config.toml` (git-ignored),
alongside the observability block above — `sales_order_store` writes
`../logs/sales_order_store.log`, `sales_order_processor` writes
`../logs/sales_order_processor.log`:

```toml
[ballerina.log]
format = "json"
keyValues = { service = "sales_order_store", env = "dev" }   # service = "sales_order_processor" for the processor

[[ballerina.log.destinations]]
type = "stdout"                               # keep console output visible

[[ballerina.log.destinations]]
path = "../logs/sales_order_store.log"        # ../logs/sales_order_processor.log for the processor
```

The relative path resolves against the sample root because you start each service with
`cd <package> && bal run`. Bring the stack up with `docker compose --profile observability
up -d`, run the services, post a few orders, and the lines appear under **Logs → Log
Explorer** (`source:ballerina`), parsed as JSON. Because `service` matches the APM service
name, logs and traces correlate. Confirm the Agent is tailing them with:

```bash
docker exec demo-datadog-agent agent status | grep -A15 -i "logs agent"
```

## Cleaning up

```bash
docker compose --profile observability down -v
```

The `-v` flag also removes the broker's data volume so the next run starts from a clean
state. (Omit `--profile observability` if you started the broker without the Agent.)
