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
// success and failure paths of the integration.
//
// A configurable percentage of requests fail (cycling through several realistic
// SAP failure shapes) so the processor's retry / dead-letter handling can be
// observed.

# Port the mock listens on.
configurable int port = 9090;

# Percentage (0-100) of requests that should fail. Defaults to ~30% so failures
# happen "intermittently". Set to 0 to always succeed or 100 to always fail.
configurable int failurePercentage = 30;

listener http:Listener securedEP = new (9090,
    secureSocket = {
        key: {
            certFile: certFile,
            keyFile: keyFile
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
    # + return - A `201 Created` with the created sales order, or one of several
    #            intermittent failure responses
    resource function post A_SalesOrder(@http:Payload salesOrder:CreateA_SalesOrder payload)
            returns http:Created|http:Ok|http:InternalServerError|http:BadRequest|http:ServiceUnavailable {

        log:printInfo("sales order create request received",
                orderType = payload?.SalesOrderType,
                soldToParty = payload?.SoldToParty,
                itemCount = (payload.to_Item?.results ?: []).length());

        if randomInt(1, 101) <= failurePercentage {
            return buildFailureResponse(payload);
        }

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

// Picks one of several failure shapes so the integration sees a variety of error
// conditions across runs.
isolated function buildFailureResponse(salesOrder:CreateA_SalesOrder payload)
        returns http:Ok|http:InternalServerError|http:BadRequest|http:ServiceUnavailable {

    int failureType = randomInt(0, 4);

    match failureType {
        0 => {
            // Backend processing error.
            log:printError("simulated failure: internal server error");
            http:InternalServerError res = {
                body: odataError("SY/530", "Sales order could not be created due to an internal SAP error")
            };
            return res;
        }
        1 => {
            // Validation / business rule rejection.
            log:printError("simulated failure: bad request");
            http:BadRequest res = {
                body: odataError("VV/305", string `Mandatory data missing for sold-to party '${payload?.SoldToParty ?: ""}'`)
            };
            return res;
        }
        2 => {
            // SAP system temporarily unavailable.
            log:printError("simulated failure: service unavailable");
            http:ServiceUnavailable res = {
                body: odataError("SY/001", "SAP system is temporarily unavailable. Please retry later")
            };
            return res;
        }
        _ => {
            // 200 OK but with an empty body - exercises the processor's
            // "empty response from the sap server" handling.
            log:printError("simulated failure: empty response body");
            http:Ok res = {body: {}};
            return res;
        }
    }
}

// Builds an SAP-style OData v2 error body.
isolated function odataError(string code, string message) returns ODataErrorResponse => {
    'error: {
        code: code,
        message: {lang: "en", value: message}
    }
};

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
