import ballerina/messaging;
import ballerinax/rabbitmq;

final messaging:Store salesOrderStore = check new rabbitmq:MessageStore(salesOrderQueueName, salesOrderStoreConfig);
