import ballerina/log;
import ballerina/workflow;

# Durable review workflow started when a sales order fails to process or parse.
#
# It surfaces the failure to a manager as a human task and blocks at `awaitHumanTask`
# until the manager acts. Completing the task replays the order through SAP as a
# durable activity with a `workflow:ManualRetry` policy, so a replay that fails again
# resurfaces in the console as a manual retry-task. Failing the task (or letting it
# time out) discards the message to the dead-letter store, as does a manager who gives
# up on the manual retry-task.
#
# + ctx - The durable workflow context
# + input - The failed order, its raw payload, and the failure details
# + return - The terminal outcome (`PROCESSED`, `DEAD_LETTERED`, or `DISCARDED`)
@workflow:Workflow
function reviewFailedSalesOrderProcess(workflow:Context ctx, FailedSalesOrderReview input)
        returns string|error {

    string workflowId = check ctx.getWorkflowId();
    string refId = input.salesOrder?.refId ?: "(unparsed)";

    logStep(ctx, "review workflow started", {
        workflowId,
        refId,
        errorCode: input.errorCode,
        errorMessage: input.errorMessage
    });

    // Surface the failure context to the manager as the human-task payload.
    map<json> taskPayload = {
        refId,
        orderType: input.salesOrder?.orderType ?: "(unparsed)",
        errorCode: input.errorCode,
        errorMessage: input.errorMessage,
        orderPayload: input.rawPayload
    };

    // Completing the task means "replay"; failing it (the console's "Fail task"
    // action) — or a timeout — surfaces as an error here and discards the message.
    logStep(ctx, "awaiting manager review", {workflowId, refId});
    SalesOrderReviewDecision|error decision = ctx->awaitHumanTask(
        "reviewFailedSalesOrder",
        "manager",
        payload = taskPayload,
        title = string `Review failed sales order ${refId}`,
        description = input.errorMessage
    );
    if decision is error {
        // Manager rejected the review task (or it timed out) — discard to the DLQ.
        logStep(ctx, "review rejected; moving message to the dead-letter store",
                {workflowId, refId, cause: decision.message()});
        _ = check ctx->callActivity(deadLetterActivity, {payload: input.rawPayload}, string);
        return "DISCARDED";
    }
    logStep(ctx, "manager approved replay", {
        workflowId,
        refId,
        editedPayloadProvided: decision.editedPayload is SalesOrderRequest
    });

    // Replay the corrected order if one was supplied, otherwise the original. A parse
    // failure with no corrected payload cannot be replayed, so it is dead-lettered.
    SalesOrderRequest? replayOrder = decision.editedPayload ?: input.salesOrder;
    if replayOrder is () {
        logStep(ctx, "no order available to replay; moving message to the dead-letter store", {workflowId, refId});
        _ = check ctx->callActivity(deadLetterActivity, {payload: input.rawPayload}, string);
        return "DEAD_LETTERED";
    }

    logStep(ctx, "replaying sales order through SAP", {workflowId, refId: replayOrder.refId});
    string|error replayResult =
        ctx->callActivity(replaySalesOrder, {salesOrder: replayOrder}, string, workflow:ManualRetry);
    if replayResult is error {
        // The manager gave up on the manual retry-task — terminal dead-letter.
        logStep(ctx, "replay abandoned by manager; moving message to the dead-letter store",
                {workflowId, refId: replayOrder.refId, cause: replayResult.message()});
        _ = check ctx->callActivity(deadLetterActivity, {payload: replayOrder.toJson()}, string);
        return "DEAD_LETTERED";
    }

    logStep(ctx, "sales order replayed successfully", {workflowId, refId: replayOrder.refId});
    return "PROCESSED";
}

# Replays a reviewed sales order through SAP S/4HANA by re-running the standard
# processing path (which also records the audit response on the response store).
# Runs as a durable activity (exactly once), so it logs directly.
#
# + salesOrder - The order to replay
# + return - A replay marker, or an error to trigger the manual retry-task
@workflow:Activity
function replaySalesOrder(SalesOrderRequest salesOrder) returns string|error {
    log:printInfo("replay activity invoked", refId = salesOrder.refId, orderType = salesOrder.orderType);
    check processSalesOrder(salesOrder);
    return string `REPLAYED:${salesOrder.refId}`;
}

# Moves a message that failed even after human review to the dead-letter store.
# Runs as a durable activity (exactly once), so it logs directly.
#
# + payload - The original (or corrected) message payload
# + return - A marker, or an error if the store write failed
@workflow:Activity
function deadLetterActivity(json payload) returns string|error {
    check deadLetterStore->store(payload);
    log:printWarn("message moved to the dead-letter store after human review");
    return "DLQ";
}

# Logs a workflow-step message once on first execution. Logs from inside the workflow
# body are suppressed while the engine is replaying recorded history (isReplaying),
# so each step is reported exactly once rather than on every replay.
#
# + ctx - The workflow context
# + message - The step message
# + fields - Structured key-values to attach
function logStep(workflow:Context ctx, string message, map<anydata> fields) {
    if !ctx.isReplaying() {
        log:printInfo(message, fields = fields);
    }
}
