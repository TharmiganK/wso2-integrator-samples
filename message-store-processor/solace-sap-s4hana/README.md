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
- A [Datadog account](https://www.datadoghq.com/) and an API key (**Organization Settings →
  API Keys**), with the **OpenMetrics** integration added (Integrations tab). The services
  publish metrics (Prometheus) and traces (OpenTelemetry), and a Datadog Agent runs in
  Docker alongside the broker to collect them.
- Optional: a running [ICP](https://wso2.com/integration-platform/monitoring-and-management/)
  server, to monitor and manage the runtimes and view their logs/metrics from the ICP
  console. See [Viewing observability in ICP](#viewing-observability-in-icp).

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

### Observability

Each package must enable metrics and tracing for the Datadog Agent to collect telemetry.
`Config.toml` is **git-ignored**, so add the block below to each package's `Config.toml` —
using **port `9797` for `sales_order_store`** and **`9798` for `sales_order_processor`** so
the two `/metrics` endpoints don't collide:

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

## Running the sample

**1. Provide your Datadog API key.** From this directory:

```bash
cp datadog/.env.example .env
# edit .env and set DD_API_KEY=<your-key>
```

`.env` is gitignored. `.env.example` also sets `DD_SITE` (default `datadoghq.com`) and
`DD_SERVICE`; change `DD_SITE` in your `.env` if your account is on another site (e.g.
`datadoghq.eu`).

**2. Start the Solace broker and Datadog Agent.** From this directory:

```bash
docker compose up -d
```

This starts Solace PubSub+, runs a one-shot `solace-init` container that provisions the `sales-orders`, `sales-orders-dlq` and `sales-orders-res` queues via the SEMP API once the broker is healthy, and starts the [`solace-msg-utility`](https://github.com/SolaceLabs/solace-msg-utility) browser UI for browsing/copying/moving queued messages (a one-shot `solace-msg-utility-init` job first downloads the UI's `solclient.js`/`jszip.min.js` vendor scripts, which the published image does not bundle). The SEMP management UI is at [http://localhost:8080](http://localhost:8080) (`admin`/`admin`); the message utility UI is at [https://localhost:9444](https://localhost:9444) (self-signed cert — accept the browser warning). The broker can take up to a minute to become healthy on first start. See [replaying dead-lettered orders](../replaying-dead-lettered-orders.md) for using the UI to replay the DLQ. The Datadog Agent starts alongside the broker; verify it picked up the OpenMetrics check and OTLP receiver:

```bash
docker exec demo-datadog-agent agent status | grep -A5 -iE "openmetrics|otlp|apm"
```

**3. Start the mock SAP endpoint.** In a new terminal:

```bash
cd mock_sap_endpoint
bal run
```

**4. Start the processor.** In a new terminal:

```bash
cd sales_order_processor
bal run
```

**5. Start the store.** In a new terminal:

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

## Viewing telemetry in Datadog

With the services running and a few orders posted (see [Trying it out](#trying-it-out)), the
Datadog Agent scrapes the services' `/metrics` endpoints on host ports `9797`/`9798` (via
`host.docker.internal`) and receives the OTLP traces they push to `localhost:4317`.

| Service | Metrics endpoint | Traces |
|---|---|---|
| `sales_order_store` | `http://localhost:9797/metrics` | → Agent `localhost:4317` (OTLP/gRPC) |
| `sales_order_processor` | `http://localhost:9798/metrics` | → Agent `localhost:4317` (OTLP/gRPC) |

- **Metrics** → *Metrics Explorer*: search for `ballerina.*`.
- **APM → Traces**: filter by service (`sales_order_store`, `sales_order_processor`) to
  inspect spans and tags.
- **Logs → Log Explorer**: filter `source:ballerina` (and `env:dev` or a `service:`) — see
  below to enable shipping.

### Logs

The services run on the host via `bal run`, so the Dockerised Agent can't grab their stdout
directly. Instead each service writes **logfmt logs to a file** under the sample-root `logs/`
directory, and the Agent tails those files (`DD_LOGS_ENABLED=true` +
`datadog/conf.d/ballerina.d/conf.yaml`, both already in the compose setup). The same file is
also tailed by Fluent Bit for the [ICP observability pipeline](#viewing-observability-in-icp),
so there is one log file per service rather than a separate one per consumer.

To enable it, add the block below to each package's `Config.toml` — `sales_order_store`
writes `../logs/sales_order_store/app.log`, `sales_order_processor` writes
`../logs/sales_order_processor/app.log`:

```toml
[ballerina.log]
format = "logfmt"
keyValues = { service = "sales_order_store", env = "dev" }   # service = "sales_order_processor" for the processor

[[ballerina.log.destinations]]
type = "stdout"                                     # keep console output visible

[[ballerina.log.destinations]]
path = "../logs/sales_order_store/app.log"          # ../logs/sales_order_processor/app.log for the processor
```

Because `service` matches the APM service name, logs and traces correlate. Confirm the Agent
is tailing them with:

```bash
docker exec demo-datadog-agent agent status | grep -A15 -i "logs agent"
```

> **Note:** The format is `logfmt`, not JSON. Ballerina's log format is a single global
> setting, so it can't be JSON for Datadog and `logfmt` for ICP's Fluent Bit parser at the
> same time — see [Viewing observability in ICP](#viewing-observability-in-icp) for why ICP
> needs `logfmt`. Datadog still tails and indexes these lines fine as plain text; it just
> no longer auto-extracts top-level JSON attributes as facets.

## Viewing observability in ICP

Both `sales_order_store` and `sales_order_processor` are already wired up to connect to a
[WSO2 Integrator: ICP](https://wso2.com/integration-platform/monitoring-and-management/)
server as runtimes — `Ballerina.toml` sets `remoteManagement`/`observabilityIncluded`,
`main.bal` imports `wso2/icp.runtime.bridge` and `ballerinax/metrics.logs`, and each
`Config.toml` needs a `[wso2.icp.runtime.bridge]` block with a secret generated from the
ICP console ("Connect an integration to ICP" in the ICP docs — not part of this sample,
since the secret is unique per ICP installation).

ICP itself runs natively (`./bin/icp.sh`), not in this `docker-compose.yml` — see the
"Install ICP" doc. This sample's compose file provides the observability *backend* ICP
needs to show the **Logs**
and **Metrics** pages: OpenSearch, plus Fluent Bit to ship the services' log files into it.

### 1. Enable per-request metrics logging

Add to each package's `Config.toml`, alongside the `[ballerina.observe]` block from
[Observability](#observability):

```toml
[ballerina.observe]
metricsLogsEnabled = true

[ballerinax.metrics.logs]
logFilePath = "../logs/sales_order_store/metrics.log"   # ../logs/sales_order_processor/metrics.log for the processor
```

This is in addition to the `format = "logfmt"` / `path = "../logs/<service>/app.log"`
settings already shown under [Logs](#logs) — Fluent Bit tails both `app.log` (application
logs) and `metrics.log` (per-request metrics) for each service.

### 2. Start OpenSearch and Fluent Bit

Already part of `docker compose up -d` (see [Running the sample](#running-the-sample)):
`opensearch` (single-node, security plugin **enabled** — HTTPS on 9200 with the image's
bundled self-signed demo cert and an `admin` password), a one-shot `opensearch-init` job
that creates the two index templates ICP's dashboards expect, and `fluent-bit` (config in
[`fluent-bit/`](./fluent-bit)), which tails `../logs/<service>/{app,metrics}.log` and ships
enriched records to OpenSearch over HTTPS.

The demo admin password defaults to `YourStrong@Pass2026` (matches the password ICP itself
suggests as a placeholder in `deployment.toml`). Override it by setting `OPENSEARCH_PASSWORD`
in `.env` — it's picked up by the `opensearch`, `opensearch-init`, and `fluent-bit` services.

Verify OpenSearch received data once the services have handled some traffic (see
[Trying it out](#trying-it-out)):

```bash
curl -sk -u admin:YourStrong@Pass2026 'https://localhost:9200/_cat/indices/ballerina-*?v'
```

You should see `ballerina-application-logs-*` and `ballerina-metrics-logs-*` indices with a
non-zero `docs.count`.

### 3. Point the ICP server at OpenSearch

On the machine running the ICP server, add to `conf/deployment.toml` (before the first
`[section]` header) and restart ICP:

```toml
opensearchUrl      = "https://localhost:9200"
opensearchUsername = "admin"
opensearchPassword = "YourStrong@Pass2026"   # or your OPENSEARCH_PASSWORD override
```

The demo cert is self-signed; ICP's OpenSearch adapter connects to it without needing a
separate trust-store entry. Use a properly signed cert and non-default credentials before
using this setup beyond local evaluation.

### 4. Check the ICP console

Sign in at `https://<icp-host>:9446`, open **Projects** > **default-project** >
**Integrations** > **Sales Order Store** / **Sales Order Processor**, and check
**Runtimes** (should show status **RUNNING**), **Logs**, and **Metrics**.

## Cleaning up

```bash
docker compose down -v
```

The `-v` flag also removes the broker's data volume so the next run starts from a clean
state.
