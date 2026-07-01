import ballerina/log;
import ballerina/messaging;
import ballerina/workflow;
// Importing the management module auto-starts its HTTP API (default :8234, base path
// /workflow), which the failed-message console consumes to list and act on tasks.
import ballerina/workflow.management as _;

// Observability: expose Prometheus metrics on /metrics and push OpenTelemetry
// traces to the Datadog Agent's OTLP receiver. See ../datadog and Config.toml.
import ballerinax/prometheus as _;
import ballerinax/jaeger as _;

# Polls the sales-order store and drives each message through processing. Instead of
# the listener's in-place retry / dead-letter behaviour, a message that fails to
# process or parse is handed to a durable human-review workflow so a manager can
# inspect and replay it from the console. The dead-letter store is written only when
# the manager gives up on a message (see `workflow.bal`).
listener messaging:StoreListener msgStoreListener = new (salesOrderStore, {
    pollingInterval: 10,
    maxRetries: 0
});

service on msgStoreListener {

    # Processes a single sales order retrieved from the store.
    #
    # On success the message is acknowledged and removed from the store. On a parse or
    # processing failure a durable review workflow is started — `workflow:run` persists
    # it durably before we return — and the message is then acknowledged off the main
    # queue, since the workflow now owns its fate.
    #
    # + payload - The raw message payload retrieved from the store
    # + return - An error only if the review workflow could not be started, else `()`
    isolated remote function onMessage(anydata payload) returns error? {
        SalesOrderRequest|error salesOrder = parseSalesOrderReq(payload);
        if salesOrder is error {
            log:printError("failed to parse the sales order; starting review workflow", salesOrder);
            string workflowId = check workflow:run(reviewFailedSalesOrderProcess, {
                rawPayload: toRawJson(payload),
                errorMessage: salesOrder.message(),
                errorCode: "PARSE_ERROR"
            });
            log:printInfo("review workflow started for unparseable message", workflowId = workflowId);
            return;
        }

        log:printInfo("sales order received", orderType = salesOrder.orderType, refId = salesOrder.refId);
        error? processResult = processSalesOrder(salesOrder);
        if processResult is error {
            log:printError("failed to process the sales order; starting review workflow", processResult,
                    orderType = salesOrder.orderType, refId = salesOrder.refId);
            string workflowId = check workflow:run(reviewFailedSalesOrderProcess, {
                salesOrder: salesOrder,
                rawPayload: salesOrder.toJson(),
                errorMessage: processResult.message(),
                errorCode: "PROCESSING_ERROR"
            });
            log:printInfo("review workflow started for failed sales order", workflowId = workflowId,
                    refId = salesOrder.refId);
            return;
        }
        log:printInfo("sales order processed successfully", orderType = salesOrder.orderType, refId = salesOrder.refId);
    }
}

# Best-effort conversion of a raw store payload to readable JSON for the console.
# Solace delivers payloads as `byte[]`; decode them to text and parse if possible so
# the manager sees the original order rather than a byte array.
#
# + payload - The raw message payload
# + return - The payload as JSON (parsed object, decoded text, or the value itself)
isolated function toRawJson(anydata payload) returns json {
    if payload is byte[] {
        string|error text = string:fromBytes(payload);
        if text is string {
            json|error parsed = text.fromJsonString();
            return parsed is json ? parsed : text;
        }
    }
    return payload.toJson();
}
