// Request types - a permissive subset of the SAP `CreateA_SalesOrder` deep-insert
// payload. Only the fields the mock reads are declared; the rest are ignored.

# A single sales order line item, as sent in the SAP create payload.
public type SalesOrderItem record {
    # SAP line item number
    string SalesOrderItem?;
    # Material / product code
    string Material?;
    # Requested quantity
    string RequestedQuantity?;
    # Unit of measure for the quantity
    string RequestedQuantityUnit?;
    # Free-text item description
    string SalesOrderItemText?;
};

# Wrapper for the deep-inserted line items (`to_Item.results`).
public type SalesOrderItems record {
    # The line items
    SalesOrderItem[] results?;
};

# The subset of the SAP `CreateA_SalesOrder` deep-insert payload that the mock reads.
public type SalesOrderCreateRequest record {
    # SAP sales order type
    string SalesOrderType?;
    # Sales organization
    string SalesOrganization?;
    # Distribution channel
    string DistributionChannel?;
    # Organizational division
    string OrganizationDivision?;
    # Customer (sold-to party)
    string SoldToParty?;
    # Customer purchase order reference
    string PurchaseOrderByCustomer?;
    # Requested delivery date
    string RequestedDeliveryDate?;
    # Transaction currency
    string TransactionCurrency?;
    # Payment terms key
    string CustomerPaymentTerms?;
    # Deep-inserted line items
    SalesOrderItems to_Item?;
};

// Response types - shaped exactly like the connector's `A_SalesOrderWrapper` so
// the integration can deserialize them without changes.

# The created sales order, as returned in the OData `d` envelope.
public type SalesOrderData record {
    # The sales order id assigned by SAP
    string SalesOrder;
    # SAP sales order type
    string SalesOrderType?;
    # Sales organization
    string SalesOrganization?;
    # Distribution channel
    string DistributionChannel?;
    # Organizational division
    string OrganizationDivision?;
    # Customer (sold-to party)
    string SoldToParty?;
    # Customer purchase order reference
    string PurchaseOrderByCustomer?;
    # Transaction currency
    string TransactionCurrency?;
    # Total net amount of the order
    string TotalNetAmount?;
    # Creation date as an OData `/Date(...)/` literal
    string CreationDate?;
    # Overall sales & distribution process status
    string OverallSDProcessStatus?;
};

# OData v2 success envelope: `{ "d": { ... } }`.
public type SalesOrderWrapper record {
    # The created sales order
    SalesOrderData d;
};

// SAP OData v2 error response shape.

# Localized error message within an OData error.
public type ODataErrorMessage record {
    # Language code (e.g. `en`)
    string lang;
    # The message text
    string value;
};

# The `error` object within an OData v2 error response.
public type ODataError record {
    # SAP error code (e.g. `SY/530`)
    string code;
    # The localized error message
    ODataErrorMessage message;
};

# OData v2 error envelope: `{ "error": { ... } }`.
public type ODataErrorResponse record {
    # The error details
    ODataError 'error;
};
