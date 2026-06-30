import ballerinax/rabbitmq;

configurable rabbitmq:StoreClientConfiguration salesOrderStoreConfig = ?;
configurable string salesOrderQueueName = "sales-orders";
