import ballerina/log;

import ballerinax/sap.s4hana.api_sales_order_srv as salesOrder;

# Processes a sales order by creating it in SAP S/4HANA and recording the result.
#
# Transforms the order to the SAP `CreateA_SalesOrder` payload, calls the
# `API_SALES_ORDER_SRV` service, and stores the returned sales order id and totals on
# the response store for auditing. An empty SAP response is treated as a failure so
# the message is retried / dead-lettered by the listener.
#
# + salesOrder - The sales order to create in SAP S/4HANA
# + return - An error if the order could not be created or the response stored, or `()`
public isolated function processSalesOrder(SalesOrderRequest salesOrder) returns error? {
    salesOrder:CreateA_SalesOrderItem[] items = toSapLineItem(salesOrder.items);
    salesOrder:CreateA_SalesOrder salesOrderReq = toSapCreateRequest(salesOrder, items);

    salesOrder:A_SalesOrderWrapper result = check sapSalesOrderClient->createA_SalesOrder(salesOrderReq);
    salesOrder:A_SalesOrder? salesOrderRes = result.d;
    if salesOrderRes is () {
        log:printError("failed to create sales order", reason = "empty response from the sap server", orderType = salesOrder.orderType, refId = salesOrder.refId);
        return error("Error occurred while creating the sales order. Empty response received from the server");
    }

    string salesOrderId = salesOrderRes.SalesOrder ?: "";
    log:printInfo("successfully created the sales order", salesOrderId = salesOrderId, orderType = salesOrder.orderType, refId = salesOrder.refId);
    SalesOrderResponse salesOrderResponse = {
        salesOrderId: salesOrderId,
        totalNetAmount: salesOrderRes?.TotalNetAmount,
        currency: salesOrderRes?.TransactionCurrency
    };
    // Storing the sales order response for auditing purposes
    check salesOrderResStore->store(salesOrderResponse);
    log:printInfo("sales order response successfully stored", salesOrderId = salesOrderId, orderType = salesOrder.orderType, refId = salesOrder.refId);
}

# Parses a raw store payload into a `SalesOrderRequest`.
#
# The Solace store delivers the payload as a `byte[]`; it is decoded from JSON when
# needed and otherwise converted directly.
#
# + payload - The raw payload retrieved from the store
# + return - The parsed sales order, or an error if the payload is not a valid order
public isolated function parseSalesOrderReq(anydata payload) returns SalesOrderRequest|error {
    if payload is byte[] {
        string fromBytes = check string:fromBytes(payload);
        return fromBytes.fromJsonStringWithType();
    }
    return payload.cloneWithType();
}
