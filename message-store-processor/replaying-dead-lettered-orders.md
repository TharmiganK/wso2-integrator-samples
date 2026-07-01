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

## Solace — from the `solace-msg-utility` web UI

Solace PubSub+ **Broker Manager (http://localhost:8080) does not browse, copy, or move spooled messages** — its only message tool is *Try Me!*, which publishes to a topic (and `sales-orders` has no topic subscription, since the store writes straight to the queue). So the broker-side replay path on Solace needs a tool that can browse and move queued messages over SEMP/SMF.

This sample's `docker-compose.yml` runs [SolaceLabs' `solace-msg-utility`](https://github.com/SolaceLabs/solace-msg-utility) — a browser-based Queue Browser / Queue Copy tool — as the `solace-msg-utility` service, so replaying never needs the broker CLI. (A companion `solace-msg-utility-init` job downloads the tool's two vendor scripts, `solclient.js` and `jszip.min.js`, on first `docker compose up` — the published image ships without them, so this must complete before the UI can connect. It runs automatically; you only notice it on a cold start.)

### Recommended — Queue Copy

1. Open **https://localhost:9444**. The gateway uses a self-signed certificate, so accept the browser's "not secure" warning (**Proceed anyway**) — expected, not a misconfiguration.
2. **Connections** — the container reverse-proxies to the broker, so use the broker's Docker network alias and its **plaintext** ports:
   - Broker Host `solace`, SMF port `8008` (**TLS off**), SEMP host `solace` port `8080` (**TLS off**), VPN `default`, user `admin` / `admin` → **Connect**.
   - `solace` resolves because the gateway runs on the same Docker network as the broker. TLS must stay off for both: the broker's exposed SEMP/SMF ports are plaintext — the gateway supplies the HTTPS the browser sees.
3. Open **Queue Copy**: Source Queue `sales-orders-dlq`, Destination Queue `sales-orders`, mode **Move** (clears the DLQ once every message lands) or **Copy** (keeps an audit copy on the DLQ).
4. Review the **Confirm Queue Copy** pre-flight summary (message count, size, destination quota) and click **Copy**/**Move**.

Queue Copy snapshots the source queue before starting (a bounded run) and halts on the first error, so a failed run never leaves messages half-moved — matching the "never lose an order" guarantee this flow needs. It moves/copies messages verbatim and cannot edit a body in transit (see the editing table below).

### Manual — broker CLI (fallback, no UI)

`copy-message` copies a **single** message identified by its `replicationGroupMsgId` (available on PubSub+ ≥ 10.0.0, which the `:latest` image satisfies); it copies rather than moves, so clearing the DLQ needs a separate `delete-messages` call by numeric `msgId`. The broker CLI also needs a TTY — commands cannot simply be piped into `docker exec -i … cli`, that prints the banner and silently ignores the input.

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
- Queue depths confirm it: `sales-orders` spikes then drains as the processor consumes it. On **RabbitMQ** the shovel *moves*, so `sales-orders-dlq` drops to 0; on **Solace**, the DLQ keeps its copy unless you used Queue Copy's **Move** mode (or `copy-message` + a manual `delete-messages`). Check depths in the [RabbitMQ Management UI](http://localhost:15672) (**Queues**), the [Solace Broker Manager](http://localhost:8080) (**Queues** → select the queue → **Messages Queued**), or the `solace-msg-utility` Queue Browser (https://localhost:9444).

> On Solace, the live **Messages Queued** browse is authoritative; the queue's `spooledMsgCount` summary metric can lag and read high.

---

## Editing a message while replaying — feasibility

| Broker | Replay verbatim | Edit-then-replay from the console |
|---|---|---|
| **RabbitMQ** | Shovel, or manual Get + Publish | ✅ Native — edit the payload in the **Publish message** dialog (Option B). |
| **Solace** | Queue Copy (`solace-msg-utility`) / `copy-message` (CLI) | ❌ Not cleanly. Both Queue Copy and `copy-message` move/copy verbatim and cannot edit a body in transit. *Try Me!* can publish an edited payload, but only to a **topic**, so `sales-orders` would first need a topic subscription (a configuration change). |

If uniform edit-then-replay from the console becomes a requirement, the design change that unlocks it is to have the store publish to a **topic** that `sales-orders` subscribes to, instead of writing directly to the queue — then both brokers' console publishers become first-class edit-and-replay tools.
