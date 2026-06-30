# Solace Message Store

A [Solace PubSub+](https://solace.com/products/event-broker/) backed implementation of the Ballerina [`ballerina/messaging`](https://central.ballerina.io/ballerina/messaging) `Store` abstraction. It lets a Ballerina program use a Solace queue as a guaranteed-delivery message store, with the same store/retrieve/acknowledge contract as any other `messaging:Store`.

## Overview

The package exposes a single client class, `MessageStore`, that implements `messaging:Store`:

- **`store`** publishes a message to a Solace queue through a `solace:MessageProducer`.
- **`retrieve`** reads the next message from the same queue through a transacted `solace:MessageConsumer`, without removing it from the queue.
- **`acknowledge`** commits the transacted receive on success (the message leaves the queue) or rolls it back on failure (the broker re-delivers the message).

Because the consumer session runs in `SESSION_TRANSACTED` mode, message removal is tied to an explicit acknowledgment. A message retrieved but not yet acknowledged stays on the queue, so an unexpected shutdown will not lose it.

## Configuration

`StoreClientConfiguration` describes how to connect to the Solace broker:

| Field          | Type                                                          | Description                                                                 |
|----------------|---------------------------------------------------------------|-----------------------------------------------------------------------------|
| `url`          | `string`                                                      | Broker URL, `<scheme>://[username:password@]<host>[:port]` (e.g. `tcp://localhost:45555`). |
| `messageVpn`   | `string`                                                      | The Solace message VPN to connect to (e.g. `default`).                      |
| `auth`         | `solace:BasicAuthConfig \| solace:KerberosConfig \| solace:OAuth2Config` | Authentication for both the producer and the consumer.          |
| `secureSocket` | `solace:SecureSocket`                                         | Optional. Secure socket configuration when the connection is secured (TLS). |

## Usage

Add this package as a dependency and create a `MessageStore` for a given queue. The constructor takes the queue name followed by the connection configuration:

```ballerina
import ballerina/messaging;
import wso2/solace;

configurable solace:StoreClientConfiguration storeConfig = ?;

public function main() returns error? {
    messaging:Store store = check new solace:MessageStore("sales-orders", storeConfig);

    // Store a message on the queue.
    check store->store({orderId: "ORD-001", amount: 250.00});

    // Retrieve the next message without removing it.
    messaging:Message? message = check store->retrieve();
    if message is messaging:Message {
        // Process the message, then acknowledge.
        boolean processed = process(message.payload);
        // success = true commits (removes); success = false rolls back (re-delivers).
        check store->acknowledge(message.id, processed);
    }
}
```

Provide the configuration in `Config.toml`:

```toml
[storeConfig]
url = "tcp://localhost:45555"
messageVpn = "default"

[storeConfig.auth]
username = "admin"
password = "admin"
```

## Running a local Solace broker

The sample's `../docker-compose.yml` starts a `solace/solace-pubsub-standard` broker and provisions the `sales-orders`, `sales-orders-dlq`, and `sales-orders-res` queues:

```bash
docker compose up -d
```

The broker's native SMF port `55555` is remapped to `45555` on the host (the Solace default falls inside the macOS ephemeral port range), and the SEMP management UI is on [http://localhost:8080](http://localhost:8080) (`admin`/`admin`).

## API reference

### `MessageStore`

| Member                                              | Description                                                                  |
|-----------------------------------------------------|------------------------------------------------------------------------------|
| `init(string queueName, *StoreClientConfiguration)` | Connects the producer and transacted consumer to the given queue.            |
| `store(anydata payload)`                            | Publishes a message to the queue.                                            |
| `retrieve()`                                        | Returns the next message (`messaging:Message`) without removing it, or `()`. |
| `acknowledge(string id, boolean success = true)`    | Commits (success) or rolls back (failure) the retrieved message.             |
| `close()`                                           | Closes the underlying producer and consumer connections.                     |
