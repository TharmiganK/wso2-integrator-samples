import ballerina/messaging;

import ballerinax/sap.s4hana.api_sales_order_srv as salesOrder;
import wso2/solace;


final messaging:Store salesOrderStore = check new solace:MessageStore(salesOrderQueueName, salesOrderStoreConfig);

final messaging:Store deadLetterStore = check new solace:MessageStore(deadLetterQueueName, deadLetterStoreConfig);

final messaging:Store salesOrderResStore = check new solace:MessageStore(salesOrderResQueueName, salesOrderResStoreConfig);

// Mock client connection requires certificates. A small retry config absorbs
// transient SAP errors (5xx / connection blips) before a failure escalates to the
// human-review workflow.
final salesOrder:Client sapSalesOrderClient = check new ({
    auth: {
        username: sapS4hanaUserName,
        password: sapS4hanaPassword
    },
    retryConfig: {
        count: 3,
        interval: 2,
        backOffFactor: 2.0,
        maxWaitInterval: 20,
        statusCodes: [500, 502, 503, 504]
    },
    secureSocket: {
        cert: "../resources/public.crt"
    }
}, sapS4hanaHostName, sapS4hanaPort);

// Use this to connect to the direct SAP endpoint
// final salesOrder:Client sapSalesOrderClient = check new ({
//     auth: {
//         username: sapS4hanaUserName,
//         password: sapS4hanaPassword
//     },
// }, sapS4hanaHostName);
