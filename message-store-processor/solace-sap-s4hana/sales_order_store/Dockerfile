# Builds sales_order_store from within the solace-sap-s4hana Ballerina workspace,
# so the local wso2/solace package (a workspace member, not a Central package)
# resolves correctly. Build context must be the workspace root
# (message-store-processor/solace-sap-s4hana), not this directory.
FROM ballerina/ballerina:2201.13.4
WORKDIR /workspace
COPY . .
WORKDIR /workspace/sales_order_store
RUN bal build
EXPOSE 9091
ENTRYPOINT ["java", "-jar", "target/bin/sales_order_store.jar"]
