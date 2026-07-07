import ballerina/http;
import ballerina/log;
import ballerinax/jaeger as _;
import ballerinax/metrics.logs as _;

// Observability: expose Prometheus metrics on /metrics and push OpenTelemetry
// traces to the Datadog Agent's OTLP receiver. See ../datadog and Config.toml.
import ballerinax/prometheus as _;

import wso2/icp.runtime.bridge as _;

# HTTP API that accepts sales orders and hands them to the message store for
# asynchronous, guaranteed processing. This is the entry point of the integration:
# it does not call SAP S/4HANA directly, it only durably stores the order.
service /api on new http:Listener(9091) {

    # Accepts a sales order and stores it on the broker for later processing.
    # The order is acknowledged with `202 Accepted` as soon as it is durably stored;
    # the SAP S/4HANA call happens later in the `sales_order_processor`.
    #
    # + salesOrder - The sales order to accept
    # + return - `202 Accepted` once the order is stored, or an `InternalError` if it
    # could not be stored on the broker
    resource function post sales\-order(@http:Payload SalesOrderRequest salesOrder) returns http:Accepted|InternalError {
        do {
            check salesOrderStore->store(salesOrder);
            log:printInfo("sales-order stored successfully", orderType = salesOrder.orderType, refId = salesOrder.refId);
            return http:ACCEPTED;
        } on fail error err {
            log:printError("failed to accept the sales order", err, orderType = salesOrder.orderType, refId = salesOrder.refId);
            InternalError internalError = {
                body: {
                    code: "ERR1001",
                    message: "failed to accept the sales order",
                    cause: err.message()
                }
            };
            return internalError;
        }
    }

}

# Structured error payload returned when a request cannot be served.
public type ErrorBody record {|
    # Application-specific error code (e.g. `ERR1001`)
    string code;
    # Human-readable error message
    string message;
    # The underlying cause, when available
    string cause?;
|};

# `500 Internal Server Error` response carrying a structured error body.
public type InternalError record {|
    *http:InternalServerError;
    # The error details
    ErrorBody body;
|};
