# Sales Order Store (Solace)

The **entry point** of the [Solace → SAP S/4HANA](../README.md) sample. An HTTP
service that accepts sales orders and durably stores them on a Solace PubSub+
queue, returning `202 Accepted` immediately — it never calls SAP S/4HANA itself.
The [`sales_order_processor`](../sales_order_processor) consumes the queue and
does the SAP work asynchronously, which is what gives the pattern its
**guaranteed-delivery** property.

## What it does

```
POST /api/sales-order (9091)
   HTTP client ───────────────▶ sales_order_store ──store()──▶ [ Solace: sales-orders ]
                                        └── 202 Accepted ──▶ client
```

The service writes the order to the `sales-orders` queue via a
[`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store`
backed by the bundled [`solace`](../solace) package's `MessageStore` (a custom
store over the `ballerinax/solace` connector), then acknowledges the caller. If
the store write fails it returns `500` with a structured error body.

## API

| Method & path | Request | Response |
|---|---|---|
| `POST /api/sales-order` | `SalesOrderRequest` JSON | `202 Accepted`, or `500` with an `ErrorBody` (`code` / `message` / `cause`) |

## Source layout

| File | Role |
|---|---|
| `main.bal` | HTTP service on `:9091`, the `sales-order` resource, and the `ErrorBody` / `InternalError` response types. |
| `connections.bal` | Declares the `salesOrderStore` (`solace:MessageStore` from the bundled `wso2/solace` package). |
| `config.bal` | `configurable` store config and queue name. |
| `Config.toml` | Solace connection details (SMF URL `tcp://localhost:45555`, VPN `default`, `admin`/`admin`). |

## Configuration

```toml
salesOrderQueueName = "sales-orders"

[salesOrderStoreConfig]
url = "tcp://localhost:45555"
messageVpn = "default"

[salesOrderStoreConfig.auth]
username = "admin"
password = "admin"
```

Note the SMF port `45555`: the Solace default is `55555`, but that falls inside
the macOS ephemeral port range, so `../docker-compose.yml` remaps it to `45555`.

## Running

The Solace broker must be up and its queues provisioned (`docker compose up -d`
from the [sample root](../README.md)). Then:

```bash
bal run
```

See the [sample README](../README.md#running-the-sample) for the full multi-service
startup and an end-to-end walkthrough.
