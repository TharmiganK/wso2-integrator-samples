#!/usr/bin/env python3
"""Replay dead-lettered sales orders on Solace using the broker's copy-message command.

For every message currently on the sales-orders-dlq queue, this copies it back onto
the sales-orders queue using the broker's own `copy-message` admin command, so
`sales_order_processor` reprocesses it with no application change.

Two facts about the Solace path worth knowing (they differ from RabbitMQ's shovel):

  * copy-message COPIES, it does not move - the original stays on sales-orders-dlq
    (the DLQ keeps an audit copy). Clear it separately if you don't want it.
  * The broker CLI needs a TTY, so commands cannot simply be piped into
    `docker exec -i ... cli`. This script drives the CLI over a pseudo-terminal.

How it works:
  1. List the DLQ messages via the SEMPv2 monitor API, reading each message's
     replicationGroupMsgId (the id copy-message needs).
  2. Drive the container's CLI over a PTY: enable -> admin -> message-spool, then
     one `copy-message` per id.

Prerequisites:
  * The broker is running:  docker compose up -d   (container: demo-solace)
  * Fix the root cause first (e.g. mock_sap_endpoint failurePercentage = 0),
    otherwise a replayed order just fails again and returns to the DLQ.

Usage:    ./replay-from-dlq.py
Override via env vars: SOLACE_CONTAINER, SOLACE_VPN, SOLACE_SEMP_URL,
SOLACE_ADMIN_USER, SOLACE_ADMIN_PASS, SRC_QUEUE, DST_QUEUE.
"""

import base64
import json
import os
import pty
import select
import sys
import time
import urllib.request

CONTAINER = os.environ.get("SOLACE_CONTAINER", "demo-solace")
VPN = os.environ.get("SOLACE_VPN", "default")
SEMP_URL = os.environ.get("SOLACE_SEMP_URL", "http://localhost:8080")
ADMIN_USER = os.environ.get("SOLACE_ADMIN_USER", "admin")
ADMIN_PASS = os.environ.get("SOLACE_ADMIN_PASS", "admin")
SRC_QUEUE = os.environ.get("SRC_QUEUE", "sales-orders-dlq")
DST_QUEUE = os.environ.get("DST_QUEUE", "sales-orders")


def list_message_ids():
    url = (f"{SEMP_URL}/SEMP/v2/monitor/msgVpns/{VPN}/queues/{SRC_QUEUE}"
           f"/msgs?select=replicationGroupMsgId&count=100")
    req = urllib.request.Request(url)
    token = base64.b64encode(f"{ADMIN_USER}:{ADMIN_PASS}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.load(resp)
    return [m["replicationGroupMsgId"] for m in body.get("data", [])]


def run_cli(commands):
    """Drive `docker exec -it <container> cli` over a PTY and return the transcript."""
    pid, fd = pty.fork()
    if pid == 0:
        os.execvp("docker", ["docker", "exec", "-it", CONTAINER, "cli"])
    transcript = b""

    def drain(quiet=0.6):
        nonlocal transcript
        end = time.time() + quiet
        while time.time() < end:
            r, _, _ = select.select([fd], [], [], 0.1)
            if r:
                try:
                    data = os.read(fd, 4096)
                except OSError:
                    return
                if data:
                    transcript += data
                    end = time.time() + quiet

    drain(2.0)  # wait past the login banner
    for cmd in commands:
        os.write(fd, (cmd + "\n").encode())
        drain(0.8)
    drain(1.5)
    try:
        os.close(fd)
    except OSError:
        pass
    os.waitpid(pid, 0)
    return transcript.decode(errors="replace")


def main():
    print(f"Listing messages on '{SRC_QUEUE}' (VPN '{VPN}') ...")
    ids = list_message_ids()
    if not ids:
        print(f"No messages on '{SRC_QUEUE}'. Nothing to replay.")
        return 0

    print(f"Found {len(ids)} message(s). Copying '{SRC_QUEUE}' -> '{DST_QUEUE}' via copy-message ...")
    commands = ["enable", "admin", f"message-spool message-vpn {VPN}"]
    commands += [
        f"copy-message source queue {SRC_QUEUE} destination queue {DST_QUEUE} message {mid}"
        for mid in ids
    ]
    commands += ["exit", "exit", "exit"]

    transcript = run_cli(commands)
    # Echo just the command/response lines (skip the legal banner).
    for line in transcript.splitlines():
        if line.strip() and not line.lstrip().startswith(("Solace", "This Solace", "Solace Corporation",
                "you are agreeing", "located at", "Copyright", "To purchase", "https://", "Operating Mode")):
            print("  " + line)

    print(f"\nDone. copy-message copies (it does not move): the originals remain on "
          f"'{SRC_QUEUE}'.\nWatch the sales_order_processor logs and the '{DST_QUEUE}' / "
          f"sales-orders-res depths.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
