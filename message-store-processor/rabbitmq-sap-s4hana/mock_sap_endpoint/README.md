# Mock SAP S/4HANA Endpoint

A stand-in for the SAP S/4HANA `API_SALES_ORDER_SRV` OData v2 service that the
[`sales_order_processor`](../sales_order_processor) calls through the
[`ballerinax/sap.s4hana.api_sales_order_srv`](https://central.ballerina.io/ballerinax/sap.s4hana.api_sales_order_srv)
connector. It lets you run the [sample](../README.md) end to end without a real SAP
system. Every create request succeeds, so orders flow straight through to SAP.

> Authentication is **not** verified. The mock exists only to drive the
> integration's success path.

## Endpoints

Served over **HTTPS on port `9090`** at
`/sap/opu/odata/sap/API_SALES_ORDER_SRV`, using the TLS cert/key in
`../resources/`:

| Method & path | Role |
|---|---|
| `HEAD /` | Returns the `X-CSRF-TOKEN` header that OData v2 clients fetch before a write (a fixed placeholder). |
| `POST /A_SalesOrder` | Creates a sales order. Returns `201 Created` with the created order wrapped as `{ "d": { ... } }`. |

## Configuration

`Config.toml`:

```toml
port = 9090            # HTTPS listen port
```

## Source layout

| File | Role |
|---|---|
| `main.bal` | The HTTPS listener, the OData service, and the success response builder. |
| `data_mappings.bal` / `types.bal` | SAP response shapes (`SalesOrderWrapper`). |
| `config.bal` / `Config.toml` | `port`. |

## Running

```bash
bal run
```

No broker or Temporal needed for the mock itself. See the
[sample README](../README.md#running-the-sample) for where it fits in the overall
startup.
