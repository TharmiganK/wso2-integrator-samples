# WSO2 Integrator Samples

A collection of runnable samples for [WSO2 Integrator: BI](https://wso2.com/integrator/) (Ballerina), each demonstrating an enterprise integration pattern or connector end to end. Every sample is self-contained: it ships with the code, a `docker-compose.yml` for any infrastructure it needs, configuration with sensible local defaults, and a README with step-by-step run instructions.

## Samples

Samples are grouped by the integration pattern they demonstrate.

### [Message Store and Message Processor](./message-store-processor)

Reliable, asynchronous processing with guaranteed delivery: accept work over HTTP, store it durably on a broker, and process it into a backend with automatic retries and dead-lettering. Both samples implement the same sales-order → SAP S/4HANA use case over different brokers.

| Sample | Broker | Backend |
|---|---|---|
| [`message-store-processor/rabbitmq-sap-s4hana`](./message-store-processor/rabbitmq-sap-s4hana) | RabbitMQ | SAP S/4HANA |
| [`message-store-processor/solace-sap-s4hana`](./message-store-processor/solace-sap-s4hana) | Solace PubSub+ | SAP S/4HANA |

## Prerequisites

Most samples need:

- [Ballerina](https://ballerina.io/downloads/) `2201.13.4` (Swan Lake) or later.
- [Docker](https://docs.docker.com/get-docker/) and Docker Compose, for any broker or backend a sample runs locally.

Individual samples list anything extra in their own README.

## Repository layout

```
wso2-integrator-samples/
├── README.md                     # This index
└── message-store-processor/      # One pattern, one directory
    ├── README.md                 # Pattern overview + comparison of the samples
    ├── rabbitmq-sap-s4hana/
    └── solace-sap-s4hana/
```

Each pattern lives in its own top-level directory with a README that introduces the pattern and links to the concrete samples under it. New patterns are added as sibling directories.

## Getting started

1. Browse the [samples](#samples) above and pick one.
2. Open its directory and follow the README — it covers prerequisites, configuration, and how to run and try the sample.
