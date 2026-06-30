# A sales order consumed from the store, before it is transformed into the SAP
# S/4HANA `CreateA_SalesOrder` representation.
public type SalesOrderRequest record {|
    # Caller-supplied reference id, used to correlate the order across logs
    string refId;
    # SAP sales order type (e.g. `OR` for a standard order)
    string orderType;
    # SAP sales organization that owns the order
    string salesOrganization;
    # Distribution channel (e.g. direct, wholesale). Optional
    string distributionChannel?;
    # SAP organizational division. Optional
    string division?;
    # Customer (sold-to party) the order is raised for
    string soldToParty;
    # Customer's own purchase order reference. Optional
    string customerPurchaseOrder?;
    # Requested delivery date in `YYYY-MM-DD` form. Optional
    string requestedDeliveryDate?;
    # Transaction currency (ISO 4217, e.g. `USD`). Optional
    string currency?;
    # SAP payment terms key. Optional
    string paymentTerms?;
    # The order line items
    SalesOrderLineItem[] items;
|};

# A single line item within a `SalesOrderRequest`.
public type SalesOrderLineItem record {|
    # Line item number
    string itemNumber;
    # Material / product code being ordered
    string materialCode;
    # Requested quantity. Optional
    string quantity?;
    # Unit of measure for the quantity. Optional
    string quantityUnit?;
    # Free-text description of the line item. Optional
    string description?;
    # SAP item category. Optional
    string itemCategory?;
    # Plant that fulfils the line item. Optional
    string plant?;
|};

# The outcome of a successful SAP S/4HANA sales order creation, stored on the
# response queue for auditing.
public type SalesOrderResponse record {|
    # The sales order id assigned by SAP S/4HANA
    string salesOrderId?;
    # Total net amount of the created order
    string totalNetAmount?;
    # Transaction currency of the created order
    string currency?;
|};
