# Mock SAP S/4HANA Endpoint

A stand-in for the SAP S/4HANA `API_SALES_ORDER_SRV` OData v2 service that the
[`sales_order_processor`](../sales_order_processor) calls through the
[`ballerinax/sap.s4hana.api_sales_order_srv`](https://central.ballerina.io/ballerinax/sap.s4hana.api_sales_order_srv)
connector. It lets you run the [sample](../README.md) end to end without a real SAP
system, and — crucially — **injects failures** so the review-and-replay path can be
exercised.

> Authentication is **not** verified. The mock exists only to drive the
> integration's success and failure paths.

## Endpoints

Served over **HTTPS on port `9090`** at
`/sap/opu/odata/sap/API_SALES_ORDER_SRV`, using the TLS cert/key in
`../resources/`:

| Method & path | Role |
|---|---|
| `HEAD /` | Returns the `X-CSRF-TOKEN` header that OData v2 clients fetch before a write (a fixed placeholder). |
| `POST /A_SalesOrder` | Creates a sales order. Returns `201 Created` with the created order wrapped as `{ "d": { ... } }`, or — for a configurable share of requests — a failure. |

### Failure shapes

A `failurePercentage` share of `POST` requests fail, cycling through realistic SAP
error conditions so the processor sees variety across runs:

- `500` internal server error (`SY/530`)
- `400` validation / business-rule rejection (`VV/305`)
- `503` service temporarily unavailable (`SY/001`)
- `200 OK` with an **empty body** (exercises the processor's "empty response" handling)

## Configuration

`Config.toml`:

```toml
port = 9090            # HTTPS listen port
failurePercentage = 30 # 0 = always succeed, 100 = always fail
```

Set `failurePercentage = 100` to force every order through the human-review
workflow, or `0` to make replays succeed — this is the main knob for the
end-to-end walkthrough in the [sample README](../README.md#trying-it-out).

## Source layout

| File | Role |
|---|---|
| `main.bal` | The HTTPS listener, the OData service, and the success / failure response builders. |
| `data_mappings.bal` / `types.bal` | SAP response shapes (`SalesOrderWrapper`, `ODataErrorResponse`). |
| `config.bal` / `Config.toml` | `port` and `failurePercentage`. |

## Running

```bash
bal run
```

No broker or Temporal needed for the mock itself. See the
[sample README](../README.md#running-the-sample) for where it fits in the overall
startup.
