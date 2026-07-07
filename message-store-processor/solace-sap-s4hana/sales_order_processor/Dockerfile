# Builds sales_order_processor from within the solace-sap-s4hana Ballerina workspace,
# so the local wso2/solace package (a workspace member, not a Central package)
# resolves correctly. Build context must be the workspace root
# (message-store-processor/solace-sap-s4hana), not this directory.
#
# resources/public.crt is preserved at /workspace/resources so the connector's
# relative `../resources/public.crt` path (see connections.bal) resolves the
# same way it does when run locally with `bal run` from this directory.
FROM ballerina/ballerina:2201.13.4
WORKDIR /workspace
COPY . .
WORKDIR /workspace/sales_order_processor
RUN bal build
ENTRYPOINT ["java", "-jar", "target/bin/sales_order_processor.jar"]
