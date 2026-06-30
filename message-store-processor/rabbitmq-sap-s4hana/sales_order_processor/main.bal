import ballerina/messaging;
import ballerina/log;

# Polls the sales-order store and drives each message through processing. Transient
# failures are retried (`maxRetries` times, `retryInterval` seconds apart) and a
# message that still fails is moved to the dead-letter store, giving the pattern its
# guaranteed-delivery behaviour.
listener messaging:StoreListener msgStoreListener = new (salesOrderStore, {
    pollingInterval: 10,
    maxRetries: 2,
    retryInterval: 2,
    deadLetterStore: deadLetterStore
});

service on msgStoreListener {

    # Processes a single sales order retrieved from the store.
    #
    # On success the message is acknowledged and removed from the store. A processing
    # error is returned so the listener retries and, once retries are exhausted, moves
    # the message to the dead-letter store. A payload that cannot be parsed into a
    # `SalesOrderRequest` is itself stored on the dead-letter store for later analysis.
    #
    # + payload - The raw message payload retrieved from the store
    # + return - An error to trigger a retry / dead-letter, or `()` on success
    isolated remote function onMessage(anydata payload) returns error? {
        do {
            SalesOrderRequest salesOrder = check payload.cloneWithType();

            do {
                log:printInfo("sales order received", orderType = salesOrder.orderType, refId = salesOrder.refId);
                check processSalesOrder(salesOrder);
                log:printInfo("sales order processed successfully", orderType = salesOrder.orderType, refId = salesOrder.refId);
            } on fail error err {
                log:printInfo("failed to procees the sales order", err);
                // Returning error here which will trigger retry and on failure after all retries
                // it will be stored in DLQ
                return err;
            }
        } on fail error err {
            log:printError("failed to parse the sales order and adding to DLQ", err);

            // The message has been corruptted hence storing it in DLQ for further
            // Analysis
            check deadLetterStore->store(payload);
            log:printInfo("corrupted message stored successfully");
        }
    }
}