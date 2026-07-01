// Copyright (c) 2025 WSO2 LLC. (http://www.wso2.org).
//
// WSO2 LLC. licenses this file to you under the Apache License,
// Version 2.0 (the "License"); you may not use this file except
// in compliance with the License.
// You may obtain a copy of the License at
//
// http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing,
// software distributed under the License is distributed on an
// "AS IS" BASIS, WITHOUT WARRANTIES OR CONDITIONS OF ANY
// KIND, either express or implied.  See the License for the
// specific language governing permissions and limitations
// under the License.

import ballerina/log;
import ballerina/messaging;
import ballerina/uuid;
import ballerinax/solace;

# Represents the Solace store client configuration.
public type StoreClientConfiguration record {|
    # The Solace broker URL in the form `<scheme>://[username:password@]<host>[:port]`
    string url;
    # The Solace message VPN to connect to
    string messageVpn;
    # The authentication used for both the producer and the consumer
    solace:BasicAuthConfig|solace:KerberosConfig|solace:OAuth2Config auth;
    # The secure socket configuration, if the connection is secured. Optional
    solace:SecureSocket secureSocket?;
|};

# Represents a Solace message store implementation.
#
# Messages are published to the configured queue through a `solace:MessageProducer`
# and consumed from the same queue through a transacted `solace:MessageConsumer`.
# A transacted session provides the acknowledgment semantics of the store: a
# successful acknowledgment commits the receive (the message leaves the queue),
# while a failed acknowledgment rolls it back (the broker re-delivers the message).
public isolated client class MessageStore {
    *messaging:Store;

    private final solace:MessageProducer producer;
    private final solace:MessageConsumer consumer;
    private final string queueName;
    // IDs of messages that have been retrieved but not yet acknowledged.
    private map<boolean> consumedMessageIds = {};

    # Initializes a new instance of the Solace `MessageStore` class.
    #
    # + queueName - The name of the Solace queue to use for storing messages
    # + clientConfig - The Solace store client configuration
    public isolated function init(string queueName, *StoreClientConfiguration clientConfig) returns error? {
        self.queueName = queueName;
        self.producer = check new (clientConfig.url, {
            destination: {queueName},
            messageVpn: clientConfig.messageVpn,
            auth: clientConfig.auth,
            secureSocket: clientConfig?.secureSocket,
            // Use guaranteed (persistent) delivery so messages are spooled to the queue.
            directTransport: false
        });
        self.consumer = check new (clientConfig.url, {
            subscriptionConfig: {
                queueName,
                sessionAckMode: solace:SESSION_TRANSACTED
            },
            messageVpn: clientConfig.messageVpn,
            auth: clientConfig.auth,
            secureSocket: clientConfig?.secureSocket,
            transacted: true,
            // Transacted sessions require guaranteed transport; direct transport is unsupported.
            directTransport: false
        });
        self.consumedMessageIds = {};
    }

    # Stores a message in the Solace message store.
    #
    # + payload - The message payload to be stored
    # + return - An error if the message could not be stored, or `()`
    isolated remote function store(anydata payload) returns error? {
        error? result = self.producer->send({payload: payload});
        if result is error {
            return error("Failed to store message in Solace", cause = result);
        }
        log:printInfo("message stored");
    }

    # Retrieves the top message from the Solace message store without removing it. The message
    # remains on the queue until it is acknowledged; retrieving without acknowledgment will return
    # the next message in the queue.
    #
    # + return - The retrieved message, or `()` if the store is empty, or an error if an error occurs
    isolated remote function retrieve() returns messaging:Message|error? {
        lock {
            solace:Message|error? message = self.consumer->receiveNoWait();
            if message is error {
                return error("Failed to retrieve message from Solace", cause = message);
            }
            if message is () {
                return; // No messages available in the queue
            }

            string id = uuid:createType1AsString();
            self.consumedMessageIds[id] = true;
            anydata payload = message.payload;
            return {id, payload: payload.clone()};
        }
    }

    # Acknowledges the processing of a message. When acknowledged with success, the message is
    # removed from the store; otherwise the message is made available for re-delivery.
    #
    # + id - The unique identifier of the message to acknowledge
    # + success - Indicates whether the message was processed successfully
    # + return - An error if the acknowledgment could not be processed, or `()`
    isolated remote function acknowledge(string id, boolean success = true) returns error? {
        lock {
            if !self.consumedMessageIds.hasKey(id) {
                return error("Message with the given ID is not consumed or does not exist");
            }
            error? result;
            if success {
                // Commit the transacted receive: the message leaves the queue.
                result = self.consumer->'commit();
            } else {
                // Roll back the transacted receive: the broker re-delivers the message.
                result = self.consumer->'rollback();
            }
            _ = self.consumedMessageIds.remove(id);
            if result is error {
                return error("Failed to acknowledge message from Solace", cause = result);
            }
        }
    }

    # Closes the underlying producer and consumer connections.
    #
    # + return - An error if either connection fails to close, or `()`
    public isolated function close() returns error? {
        check self.producer->close();
        check self.consumer->close();
    }
}
