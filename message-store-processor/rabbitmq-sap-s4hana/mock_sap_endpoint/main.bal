import ballerina/http;
import ballerina/log;
import ballerina/random;
import ballerina/time;

import ballerinax/sap.s4hana.api_sales_order_srv as salesOrder;

// Mock SAP S/4HANA Sales Order (OData) service.
//
// It mimics the `API_SALES_ORDER_SRV` service that the `sales_order_processor`
// integration talks to via the `ballerinax/sap.s4hana.api_sales_order_srv`
// connector. Authentication is NOT verified - the goal is only to exercise the
// success path of the integration; every create request succeeds.

# Port the mock listens on.
configurable int port = 9090;

listener http:Listener securedEP = new (port,
    secureSocket = {
        key: {
            certFile: "../resources/public.crt",
            keyFile: "../resources/private.key"
        }
    }
);


# Mock of the SAP S/4HANA `API_SALES_ORDER_SRV` OData v2 service. Exposes just the
# operations the `sales_order_processor` uses: a CSRF-token `HEAD` probe and the
# `POST /A_SalesOrder` create operation.
service /sap/opu/odata/sap/API_SALES_ORDER_SRV on securedEP {

    # Returns the CSRF token expected by OData v2 clients before a write. The real
    # service issues a fetch token here; the mock returns a fixed placeholder.
    #
    # + return - `200 OK` carrying the `X-CSRF-TOKEN` header
    resource function head .() returns http:Response {
        http:Response res = new;
        res.statusCode = 200;
        res.setHeader("X-CSRF-TOKEN", "SAP-InfoRecord-Process");
        return res;
    }

    # Creates a sales order. Mirrors `POST /A_SalesOrder` of the real service.
    #
    # + payload - The SAP `CreateA_SalesOrder` deep-insert payload
    # + return - A `201 Created` with the created sales order
    resource function post A_SalesOrder(@http:Payload salesOrder:CreateA_SalesOrder payload)
            returns http:Created {

        log:printInfo("sales order create request received",
                orderType = payload?.SalesOrderType,
                soldToParty = payload?.SoldToParty,
                itemCount = (payload.to_Item?.results ?: []).length());

        return buildSuccessResponse(payload);
    }
}

// Builds a realistic successful sales order response wrapped exactly the way the
// connector expects: `{ "d": { ... } }`.
isolated function buildSuccessResponse(salesOrder:CreateA_SalesOrder payload) returns http:Created {
    string salesOrderId = generateSalesOrderId();
    string totalNetAmount = calculateNetAmount(payload);
    string currency = payload?.TransactionCurrency ?: "USD";

    SalesOrderWrapper wrapper = {
        d: {
            SalesOrder: salesOrderId,
            SalesOrderType: payload?.SalesOrderType ?: "OR",
            SalesOrganization: payload?.SalesOrganization,
            DistributionChannel: payload?.DistributionChannel,
            OrganizationDivision: payload?.OrganizationDivision,
            SoldToParty: payload?.SoldToParty,
            PurchaseOrderByCustomer: payload?.PurchaseOrderByCustomer,
            TransactionCurrency: currency,
            TotalNetAmount: totalNetAmount,
            CreationDate: sapDate(),
            OverallSDProcessStatus: "A"
        }
    };

    log:printInfo("sales order created successfully", salesOrderId = salesOrderId, totalNetAmount = totalNetAmount, currency = currency);
    return {body: wrapper};
}

// Generates a 10-digit numeric sales order id (SAP `SalesOrder` is max length 10).
isolated function generateSalesOrderId() returns string => string `${randomInt(1000000000, 2000000000)}`;

// Derives a plausible net amount from the requested quantities, falling back to a
// random value when quantities are absent.
isolated function calculateNetAmount(salesOrder:CreateA_SalesOrder payload) returns string {
    salesOrder:CreateA_SalesOrderItem[] items = payload.to_Item?.results ?: [];
    decimal total = 0;
    foreach salesOrder:CreateA_SalesOrderItem item in items {
        decimal qty = parseDecimal(item?.RequestedQuantity, 1);
        decimal unitPrice = <decimal>randomInt(1000, 50000) / 100; // 10.00 - 500.00
        total += qty * unitPrice;
    }
    if total == 0d {
        total = <decimal>randomInt(10000, 1000000) / 100; // 100.00 - 10000.00
    }
    return total.toString();
}

isolated function parseDecimal(string? value, decimal default) returns decimal {
    if value is () {
        return default;
    }
    decimal|error parsed = decimal:fromString(value);
    return parsed is decimal ? parsed : default;
}

// Returns the current date as an SAP OData v2 `/Date(epochMillis)/` literal.
isolated function sapDate() returns string {
    [int, decimal] [seconds, _] = time:utcNow();
    return string `/Date(${seconds * 1000})/`;
}

// Random int in [min, max). Falls back to `min` if the range is invalid.
isolated function randomInt(int min, int max) returns int {
    int|error value = random:createIntInRange(min, max);
    return value is int ? value : min;
}
