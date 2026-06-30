import ballerinax/sap.s4hana.api_sales_order_srv as salesOrder;

# Maps the API line items to SAP `CreateA_SalesOrderItem` records.
#
# + items - The line items from the incoming sales order
# + return - The SAP representation of the line items
isolated function toSapLineItem(SalesOrderLineItem[] items) returns salesOrder:CreateA_SalesOrderItem[] => from var item in items
    select {
        SalesOrderItem: item.itemNumber,
        Material: item.materialCode,
        SalesOrderItemText: item.description,
        RequestedQuantity: item.quantity,
        RequestedQuantityUnit: item.quantityUnit,
        SalesOrderItemCategory: item.itemCategory,
        ProductionPlant: item.plant
    };

# Maps an incoming `SalesOrderRequest` to the SAP `CreateA_SalesOrder` deep-insert
# payload expected by the `API_SALES_ORDER_SRV` service.
#
# + req - The incoming sales order
# + items - The already-mapped SAP line items
# + return - The SAP `CreateA_SalesOrder` request
isolated function toSapCreateRequest(SalesOrderRequest req, salesOrder:CreateA_SalesOrderItem[] items) returns salesOrder:CreateA_SalesOrder => {
    SalesOrder: "",
    SalesOrderType: req.orderType,
    SalesOrganization: req.salesOrganization,
    DistributionChannel: req.distributionChannel,
    OrganizationDivision: req.division,
    SoldToParty: req.soldToParty,
    PurchaseOrderByCustomer: req.customerPurchaseOrder,
    RequestedDeliveryDate: req.requestedDeliveryDate,
    TransactionCurrency: req.currency,
    CustomerPaymentTerms: req.paymentTerms,
    to_Item: {
        results: items
    }
};
