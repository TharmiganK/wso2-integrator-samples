import ballerina/messaging;
import wso2/solace;

final messaging:Store salesOrderStore = check new solace:MessageStore(salesOrderQueueName, salesOrderStoreConfig);
