import ballerinax/rabbitmq;

configurable rabbitmq:StoreClientConfiguration salesOrderStoreConfig = ?;
configurable string salesOrderQueueName = "sales-orders";

configurable rabbitmq:StoreClientConfiguration deadLetterStoreConfig = ?;
configurable string deadLetterQueueName = "sales-orders-dlq";

configurable rabbitmq:StoreClientConfiguration salesOrderResStoreConfig = ?;
configurable string salesOrderResQueueName = "sales-orders-res";

configurable string sapS4hanaUserName = ?;
configurable string sapS4hanaPassword = ?;
configurable string sapS4hanaHostName = ?;
configurable int sapS4hanaPort = 443;
