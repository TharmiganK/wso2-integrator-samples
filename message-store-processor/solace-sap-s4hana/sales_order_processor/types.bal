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

# Input handed to the human-review workflow when a sales order fails to process or
# parse. The whole record is passed to `workflow:run` and rehydrated as the workflow
# function's input parameter.
public type FailedSalesOrderReview record {|
    # The parsed sales order, or `()` when the payload could not be parsed
    SalesOrderRequest? salesOrder = ();
    # The original message payload, surfaced to the manager and used for replay
    json rawPayload;
    # The failure message shown to the reviewing manager
    string errorMessage;
    # Failure category: `PARSE_ERROR` (unparseable payload) or `PROCESSING_ERROR`
    string errorCode;
|};

# Decision captured from the reviewing manager and delivered back to the workflow via
# the management API. Only the two declared fields drive the auto-generated completion
# form used by the console's "replay" action. The record is intentionally **open** (and
# deliberately declares no extra fields): the console's "Discard to DLQ" action fails the
# task, which the management API delivers as a rejection *result*
# (`{approved: false, __rejected: true, reason}`) rather than an error. Those fields must
# bind somewhere for the workflow to detect the discard, so they land in the rest fields
# and are read by key (`decision["approved"]`) instead of adding form inputs to replay.
public type SalesOrderReviewDecision record {
    # An optional corrected order to replay instead of the original payload
    SalesOrderRequest? editedPayload = ();
    # Optional free-text reviewer comments
    string? comments = ();
};
