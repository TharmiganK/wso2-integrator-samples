# Replaying dead-lettered orders from the broker

When the review workflow gives up on a failed sales order, the message ends up on the **`sales-orders-dlq`** queue as a terminal sink. Once the underlying problem is fixed (SAP back up, a bug deployed, bad reference data corrected), you often want those orders to flow again — **without** writing or running any extra application code. This guide shows how to replay a dead-lettered order **back onto the `sales-orders` queue using the broker itself**, so `sales_order_processor` picks it up and reprocesses it normally.

This works because a broker-side move/copy is **verbatim**: the message placed back on `sales-orders` is byte-identical to the one the message store originally wrote, so the `messaging:StoreListener` consumes and reprocesses it with no change to the integration. A successful replay lands a record on `sales-orders-res`; a replay that fails again simply re-enters the review flow and can return to the DLQ.

> **Fix the root cause first.** If the condition that failed the order is still present, a replayed order just fails again and comes straight back to the DLQ. For a clean demo, set `failurePercentage = 0` in `mock_sap_endpoint/Config.toml` and restart the mock before replaying, so every replayed order succeeds.

---

## RabbitMQ — from the Management UI (http://localhost:15672)

The RabbitMQ web console can replay messages directly. Two approaches are shown: the **Shovel** (clean, verbatim, recommended) and a **manual Get + Publish** (no plugin, and the way to *edit* a message while replaying).

### Option A — Shovel Management (recommended)

The `rabbitmq_shovel` and `rabbitmq_shovel_management` plugins are enabled by this sample's `docker-compose.yml` (via `rabbitmq/enabled_plugins`). If you run RabbitMQ some other way, enable them once with:

```bash
docker exec demo-rabbitmq rabbitmq-plugins enable rabbitmq_shovel rabbitmq_shovel_management
```

Then, in the Management UI:

1. Open **Admin** → **Shovel Management** (right-hand menu) → **Add a new shovel**.
2. **Name**: `replay-dlq`.
3. **Source**: protocol `AMQP 0.9.1`, **Queue** = `sales-orders-dlq`.
4. **Delete after**: `Queue length` — the shovel drains the messages present when it starts, then removes itself (a one-shot replay).
5. **Destination**: protocol `AMQP 0.9.1`, **Queue** = `sales-orders`.
6. Click **Add shovel**.

The shovel moves every dead-lettered order onto `sales-orders` and disappears. Watch the **Queues** tab: `sales-orders-dlq` drops to 0, `sales-orders` briefly rises, then drains as the processor consumes it.

The same thing from the CLI (handy for scripting):

```bash
docker exec demo-rabbitmq rabbitmqctl set_parameter shovel replay-dlq \
  '{"src-protocol":"amqp091","src-uri":"amqp://guest:guest@localhost","src-queue":"sales-orders-dlq","src-delete-after":"queue-length",
    "dest-protocol":"amqp091","dest-uri":"amqp://guest:guest@localhost","dest-queue":"sales-orders"}'
```

### Option B — manual Get + Publish (and editing)

Pure built-in UI, no plugin — and this is where you can **edit** a message before replaying it.

1. **Queues and Streams** → `sales-orders-dlq` → **Get messages**. Set **Ack Mode** to `Reject requeue true` so the message stays on the DLQ while you copy it. Copy the **Payload**.
2. Go to the `sales-orders` queue → **Publish message** panel (this publishes to the default exchange with the routing key set to the queue name). Paste the payload — **edit it here if you want to correct the order** — and click **Publish message**.
3. Return to `sales-orders-dlq` → **Get messages** with **Ack Mode** `Automatic ack` to remove the original now that the replay is published.

> Order matters: publish the replay *before* removing the original, so a mistake never loses the order.

---

## Solace — from the broker's `copy-message` command

Solace PubSub+ **Broker Manager (http://localhost:8080) does not browse, copy, or move spooled messages** — its only message tool is *Try Me!*, which publishes to a topic (and `sales-orders` has no topic subscription, since the store writes straight to the queue). So the broker-side replay path on Solace is the **`copy-message` admin command** on the broker CLI (`copy-message` is available on PubSub+ ≥ 10.0.0, which the `:latest` image satisfies), not the web console.

Two things to know, both different from RabbitMQ's shovel:

- **`copy-message` copies, it does not move.** The original message stays on `sales-orders-dlq` (the DLQ keeps an audit copy). If you also want to clear the DLQ, delete that message afterwards with `delete-messages queue sales-orders-dlq message <msg-id>` (the numeric `msgId` from the SEMPv2 monitor, not the `replicationGroupMsgId`).
- **The broker CLI needs a TTY.** Commands cannot simply be piped into `docker exec -i … cli`; that prints the banner and silently ignores the input. Run it interactively (`docker exec -it`), or use the helper script below, which drives the CLI over a pseudo-terminal.

`copy-message` copies a **single** message identified by its `replicationGroupMsgId`, so the flow is: discover the id(s), then copy each one.

### Scripted (recommended)

This sample ships a helper that does both steps for every message on the DLQ:

```bash
cd solace-sap-s4hana
./replay-from-dlq.py
```

It lists the DLQ messages via the SEMPv2 monitor API and drives one `copy-message` per id into the broker CLI over a pseudo-terminal (Python 3, standard library only). Override defaults with env vars (`SRC_QUEUE`, `DST_QUEUE`, `SOLACE_CONTAINER`, …) if needed.

### Manual

1. **List the message ids** on the DLQ via the SEMPv2 monitor API:

   ```bash
   curl -su admin:admin \
     "http://localhost:8080/SEMP/v2/monitor/msgVpns/default/queues/sales-orders-dlq/msgs?select=replicationGroupMsgId" \
     | jq -r '.data[].replicationGroupMsgId'
   # e.g. rmid1:1cc48-55f51da1eea-00000000-08d7537f
   ```

2. **Copy each id** back to `sales-orders` from the broker CLI (run it interactively — it needs a TTY):

   ```bash
   docker exec -it demo-solace cli
   ```
   ```
   demo-solace> enable
   demo-solace# admin
   demo-solace(admin)# message-spool message-vpn default
   demo-solace(admin/message-spool)# copy-message source queue sales-orders-dlq destination queue sales-orders message rmid1:1cc48-55f51da1eea-00000000-08d7537f
   ```

   (If `cli` is not on the container's PATH, use the full path `/usr/sw/loads/currentload/bin/cli`.)

> Not the same as Solace **Message Replay**. Message Replay re-delivers messages from a topic *replay log* to subscriptions by time / message-id; it is not a queue-to-queue move and is not what this flow uses.

---

## Verifying a replay

Regardless of broker, after replaying:

- The **`sales_order_processor` logs** show the order received and processed again.
- A successful order writes a record to **`sales-orders-res`**.
- Queue depths confirm it: `sales-orders` spikes then drains as the processor consumes it. On **RabbitMQ** the shovel *moves*, so `sales-orders-dlq` drops to 0; on **Solace** `copy-message` *copies*, so the DLQ keeps its copy until you delete it. Check depths in the [RabbitMQ Management UI](http://localhost:15672) (**Queues**) or the [Solace Broker Manager](http://localhost:8080) (**Queues** → select the queue → **Messages Queued**).

> On Solace, the live **Messages Queued** browse is authoritative; the queue's `spooledMsgCount` summary metric can lag and read high.

---

## Editing a message while replaying — feasibility

| Broker | Replay verbatim | Edit-then-replay from the console |
|---|---|---|
| **RabbitMQ** | Shovel, or manual Get + Publish | ✅ Native — edit the payload in the **Publish message** dialog (Option B). |
| **Solace** | `copy-message` (CLI / SEMP) | ❌ Not cleanly. `copy-message` copies verbatim and cannot edit. *Try Me!* can publish an edited payload, but only to a **topic**, so `sales-orders` would first need a topic subscription (a configuration change), or you would use an external tool such as the [SolaceLabs `solace-msg-utility`](https://github.com/SolaceLabs/solace-msg-utility). |

If uniform edit-then-replay from the console becomes a requirement, the design change that unlocks it is to have the store publish to a **topic** that `sales-orders` subscribes to, instead of writing directly to the queue — then both brokers' console publishers become first-class edit-and-replay tools.
