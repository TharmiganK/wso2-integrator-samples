# Builds mock_sap_endpoint from within the solace-sap-s4hana Ballerina workspace.
# Build context must be the workspace root (message-store-processor/solace-sap-s4hana),
# not this directory.
#
# resources/public.crt and resources/private.key are preserved at /workspace/resources
# so the listener's relative `../resources/...` paths (see main.bal) resolve the
# same way they do when run locally with `bal run` from this directory.
FROM ballerina/ballerina:2201.13.4
WORKDIR /workspace
COPY . .
WORKDIR /workspace/mock_sap_endpoint
RUN bal build
EXPOSE 9090
ENTRYPOINT ["java", "-jar", "target/bin/mock_sap_endpoint.jar"]
