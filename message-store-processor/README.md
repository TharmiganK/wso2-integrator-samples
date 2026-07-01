# Message Store and Message Processor

The **Message Store and Message Processor** is an enterprise integration pattern for reliable, asynchronous processing. Instead of calling a backend synchronously while the client waits, the integration first writes the incoming message to a durable **store** (a broker queue) and acknowledges the client immediately. A separate **processor** then consumes from the store at its own pace, calls the backend, and acknowledges each message only after it has been handled. Because a message stays on the store until it is successfully processed, nothing is lost when the backend is slow, unavailable, or the processor restarts — this is the pattern's **guaranteed delivery** property.

The samples in this directory implement the pattern with [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina), using its [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store` and `StoreListener` abstractions. They share a single use case — accepting **sales orders** over HTTP and creating them in **SAP S/4HANA** — and differ only in the message broker behind the store.

## The shared use case

```
   HTTP client ──▶ sales_order_store ──▶ [ broker: sales-orders ] ──▶ sales_order_processor ──▶ SAP S/4HANA
                                                                              │
                                                   success ──▶ [ sales-orders-res ]   (audit)
                                                   failure ──▶ [ sales-orders-dlq ]   (dead-letter)
```

Each sample is built from the same packages:

- **`sales_order_store`** — an HTTP service that accepts a sales order and writes it to the `sales-orders` queue, returning `202 Accepted` as soon as the order is durably stored.
- **`sales_order_processor`** — a `messaging:StoreListener` that polls the queue, transforms each order into the SAP `CreateA_SalesOrder` shape, calls SAP S/4HANA, records successful results on `sales-orders-res`, and dead-letters failures to `sales-orders-dlq` after retries are exhausted.
- **`mock_sap_endpoint`** — a stand-in SAP `API_SALES_ORDER_SRV` service that fails a configurable percentage of requests, so the retry and dead-letter paths can be exercised without a real SAP system.

## The samples

| Sample | Broker | Store implementation | Management UI |
|---|---|---|---|
| [`rabbitmq-sap-s4hana`](./rabbitmq-sap-s4hana) | RabbitMQ | Built-in `rabbitmq:MessageStore` from `ballerinax/rabbitmq` | [http://localhost:15672](http://localhost:15672) (`guest`/`guest`) |
| [`solace-sap-s4hana`](./solace-sap-s4hana) | Solace PubSub+ | Custom `messaging:Store` in the bundled [`solace`](./solace-sap-s4hana/solace) package, over `ballerinax/solace` | [http://localhost:8080](http://localhost:8080) (`admin`/`admin`) |

Both samples expose the same HTTP API (`POST /api/sales-order` on port `9091`) and the same mock SAP endpoint (HTTPS on port `9090`), so the application code (`sales_order_store`, `sales_order_processor`, `mock_sap_endpoint`) is nearly identical between them. The interesting difference is the store: RabbitMQ ships with a ready-made `messaging:Store`, while Solace shows how to build one yourself on top of a connector using transacted sessions for safe acknowledgments.

## Replaying dead-lettered orders

Orders that end up on the `sales-orders-dlq` queue can be replayed back onto `sales-orders` **from the broker itself**, with no application code — the broker re-injects the message verbatim and `sales_order_processor` reprocesses it. See **[replaying-dead-lettered-orders.md](./replaying-dead-lettered-orders.md)** for the step-by-step runbook: the RabbitMQ Management UI (Shovel, or manual Get + Publish) and the Solace `copy-message` command (with the [`solace-sap-s4hana/replay-from-dlq.py`](./solace-sap-s4hana/replay-from-dlq.py) helper). The runbook also covers the feasibility of editing a message while replaying.

## Observability

Both samples can publish metrics (Prometheus), distributed traces (OpenTelemetry) and
JSON logs to [Datadog](https://www.datadoghq.com/) via a Docker-based Datadog Agent that
runs alongside the broker (behind an opt-in `observability` Compose profile). See the
**Observability with Datadog** section in each sample's README for setup.

Pick the sample that matches your broker and follow its README — each is self-contained with full setup and run instructions.
