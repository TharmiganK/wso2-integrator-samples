# Sales Order Store (RabbitMQ)

The **entry point** of the [RabbitMQ → SAP S/4HANA](../README.md) sample. An HTTP
service that accepts sales orders and durably stores them on a RabbitMQ queue,
returning `202 Accepted` immediately — it never calls SAP S/4HANA itself. The
[`sales_order_processor`](../sales_order_processor) consumes the queue and does
the SAP work asynchronously, which is what gives the pattern its
**guaranteed-delivery** property.

## What it does

```
POST /api/sales-order (9091)
   HTTP client ───────────────▶ sales_order_store ──store()──▶ [ RabbitMQ: sales-orders ]
                                        └── 202 Accepted ──▶ client
```

The service writes the order to the `sales-orders` queue via a
[`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store`
backed by the built-in `rabbitmq:MessageStore`, then acknowledges the caller. If
the store write fails it returns `500` with a structured error body.

## API

| Method & path | Request | Response |
|---|---|---|
| `POST /api/sales-order` | `SalesOrderRequest` JSON | `202 Accepted`, or `500` with an `ErrorBody` (`code` / `message` / `cause`) |

## Source layout

| File | Role |
|---|---|
| `main.bal` | HTTP service on `:9091`, the `sales-order` resource, and the `ErrorBody` / `InternalError` response types. |
| `connections.bal` | Declares the `salesOrderStore` (`rabbitmq:MessageStore`). |
| `config.bal` | `configurable` store config and queue name. |
| `Config.toml` | RabbitMQ connection details (host `localhost`, port `5672`, `guest`/`guest`). |

## Configuration

```toml
salesOrderQueueName = "sales-orders"

[salesOrderStoreConfig]
host = "localhost"
port = 5672

[salesOrderStoreConfig.connectionData]
username = "guest"
password = "guest"
virtualHost = "/"
```

## Running

The RabbitMQ broker must be up (`docker compose up -d` from the
[sample root](../README.md)). Then:

```bash
bal run
```

See the [sample README](../README.md#running-the-sample) for the full multi-service
startup and an end-to-end walkthrough.
