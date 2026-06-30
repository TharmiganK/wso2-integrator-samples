import ballerina/messaging;

import ballerinax/sap.s4hana.api_sales_order_srv as salesOrder;
import wso2/solace;


final messaging:Store salesOrderStore = check new solace:MessageStore(salesOrderQueueName, salesOrderStoreConfig);

final messaging:Store deadLetterStore = check new solace:MessageStore(deadLetterQueueName, deadLetterStoreConfig);

final messaging:Store salesOrderResStore = check new solace:MessageStore(salesOrderResQueueName, salesOrderResStoreConfig);

// Mock client connection requires certificates
final salesOrder:Client sapSalesOrderClient = check new ({
    auth: {
        username: sapS4hanaUserName,
        password: sapS4hanaPassword
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
