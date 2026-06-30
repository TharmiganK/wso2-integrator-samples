import wso2/solace;

configurable solace:StoreClientConfiguration salesOrderStoreConfig = ?;
configurable string salesOrderQueueName = "sales-orders";

configurable solace:StoreClientConfiguration deadLetterStoreConfig = ?;
configurable string deadLetterQueueName = "sales-orders-dlq";

configurable solace:StoreClientConfiguration salesOrderResStoreConfig = ?;
configurable string salesOrderResQueueName = "sales-orders-res";

configurable string sapS4hanaUserName = ?;
configurable string sapS4hanaPassword = ?;
configurable string sapS4hanaHostName = ?;
configurable int sapS4hanaPort = 443;
