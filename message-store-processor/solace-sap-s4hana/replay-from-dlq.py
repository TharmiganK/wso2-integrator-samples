#!/usr/bin/env python3
"""Replay dead-lettered sales orders on Solace using the broker's copy-message command.

For every message currently on the sales-orders-dlq queue, this copies it back onto
the sales-orders queue using the broker's own `copy-message` admin command, so
`sales_order_processor` reprocesses it with no application change.

Two facts about the Solace path worth knowing (they differ from RabbitMQ's shovel):

  * copy-message COPIES, it does not move - the original stays on sales-orders-dlq
    (the DLQ keeps an audit copy). Set DELETE_AFTER_COPY=1 to remove the originals
    once every copy has succeeded (see below).
  * The broker CLI needs a TTY, so commands cannot simply be piped into
    `docker exec -i ... cli`. This script drives the CLI over a pseudo-terminal.

How it works:
  1. List the DLQ messages via the SEMPv2 monitor API, reading each message's
     replicationGroupMsgId (the id copy-message needs) and numeric msgId (the id
     delete-messages needs - the two commands take different id formats).
  2. Drive the container's CLI over a PTY: enable -> admin -> message-spool, then
     one `copy-message` per id.
  3. If DELETE_AFTER_COPY is set, and only if the copy transcript is free of
     errors, run a second CLI pass deleting each original by msgId. This is
     all-or-nothing on purpose: if any copy failed, nothing is deleted, so a
     dead-lettered order can never be lost without a confirmed copy first.
     (delete-messages prompts "y/n" per message; the script answers "y".)

Prerequisites:
  * The broker is running:  docker compose up -d   (container: demo-solace)
  * Fix the root cause first (e.g. mock_sap_endpoint failurePercentage = 0),
    otherwise a replayed order just fails again and returns to the DLQ.

Usage:    ./replay-from-dlq.py                 # copy only, keep DLQ audit copies
          DELETE_AFTER_COPY=1 ./replay-from-dlq.py   # copy, then clear the DLQ
Override via env vars: SOLACE_CONTAINER, SOLACE_VPN, SOLACE_SEMP_URL,
SOLACE_ADMIN_USER, SOLACE_ADMIN_PASS, SRC_QUEUE, DST_QUEUE, DELETE_AFTER_COPY.
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
DELETE_AFTER_COPY = os.environ.get("DELETE_AFTER_COPY", "").lower() in (
    "1", "true", "yes", "on")

# Substrings the broker CLI prints when a command is rejected. If any appears in
# the copy transcript we treat the copy pass as failed and delete nothing.
COPY_ERROR_MARKERS = ("invalid command input", "parse error", "error",
                      "fail", "not found", "does not exist")


def list_messages():
    """Return [{"msg_id": int, "rgmid": str}, ...] for every message on SRC_QUEUE.

    copy-message needs the replicationGroupMsgId; delete-messages needs the
    numeric msgId - so we fetch both.
    """
    url = (f"{SEMP_URL}/SEMP/v2/monitor/msgVpns/{VPN}/queues/{SRC_QUEUE}"
           f"/msgs?select=msgId,replicationGroupMsgId&count=100")
    req = urllib.request.Request(url)
    token = base64.b64encode(f"{ADMIN_USER}:{ADMIN_PASS}".encode()).decode()
    req.add_header("Authorization", f"Basic {token}")
    with urllib.request.urlopen(req, timeout=15) as resp:
        body = json.load(resp)
    return [{"msg_id": m["msgId"], "rgmid": m["replicationGroupMsgId"]}
            for m in body.get("data", [])]


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


def echo_transcript(transcript):
    """Print the CLI transcript, skipping the legal login banner."""
    for line in transcript.splitlines():
        if line.strip() and not line.lstrip().startswith(("Solace", "This Solace", "Solace Corporation",
                "you are agreeing", "located at", "Copyright", "To purchase", "https://", "Operating Mode")):
            print("  " + line)


def main():
    print(f"Listing messages on '{SRC_QUEUE}' (VPN '{VPN}') ...")
    msgs = list_messages()
    if not msgs:
        print(f"No messages on '{SRC_QUEUE}'. Nothing to replay.")
        return 0

    print(f"Found {len(msgs)} message(s). Copying '{SRC_QUEUE}' -> '{DST_QUEUE}' via copy-message ...")
    commands = ["enable", "admin", f"message-spool message-vpn {VPN}"]
    commands += [
        f"copy-message source queue {SRC_QUEUE} destination queue {DST_QUEUE} message {m['rgmid']}"
        for m in msgs
    ]
    commands += ["exit", "exit", "exit"]

    transcript = run_cli(commands)
    echo_transcript(transcript)

    if not DELETE_AFTER_COPY:
        print(f"\nDone. copy-message copies (it does not move): the originals remain on "
              f"'{SRC_QUEUE}'.\n(Set DELETE_AFTER_COPY=1 to clear them once every copy succeeds.)"
              f"\nWatch the sales_order_processor logs and the '{DST_QUEUE}' / "
              f"sales-orders-res depths.")
        return 0

    # DELETE_AFTER_COPY: only delete if every copy landed cleanly, so a
    # dead-lettered order is never removed without a confirmed copy first.
    low = transcript.lower()
    if any(marker in low for marker in COPY_ERROR_MARKERS):
        print(f"\nAt least one copy-message reported an error (see transcript above).\n"
              f"Deleting nothing from '{SRC_QUEUE}' - fix the cause and re-run.")
        return 1

    print(f"\nAll copies succeeded. Deleting the {len(msgs)} original(s) from '{SRC_QUEUE}' ...")
    del_commands = ["enable", "admin", f"message-spool message-vpn {VPN}"]
    for m in msgs:
        # delete-messages prompts "Do you want to continue (y/n)?"; answer "y".
        del_commands.append(f"delete-messages queue {SRC_QUEUE} message {m['msg_id']}")
        del_commands.append("y")
    del_commands += ["exit", "exit", "exit"]

    del_transcript = run_cli(del_commands)
    echo_transcript(del_transcript)

    print(f"\nDone. Copied {len(msgs)} message(s) to '{DST_QUEUE}' and cleared them from "
          f"'{SRC_QUEUE}'.\nWatch the sales_order_processor logs and the '{DST_QUEUE}' / "
          f"sales-orders-res depths.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
