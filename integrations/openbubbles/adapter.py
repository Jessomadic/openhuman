"""Single-chat OpenBubbles to OpenHuman pilot, using only Python's standard library."""

from __future__ import annotations

import argparse
import contextlib
import json
import logging
import os
import re
import time
import urllib.error
import urllib.parse
import urllib.request
import uuid
from pathlib import Path

from config import Config
from store import Store

LOG = logging.getLogger("openbubbles_pilot")
PAGE_SIZE = 1000
MAX_SSE_LINE = 2 * 1024 * 1024


class ManualReview(RuntimeError):
    """A message may already have been processed or delivered."""


class Http:
    def __init__(self):
        # Do not let a machine-wide proxy observe either local bearer token.
        self.opener = urllib.request.build_opener(urllib.request.ProxyHandler({}))

    def json_request(
        self, origin: str, path: str, token: str, *, payload: dict | None = None,
        timeout: float = 20,
    ) -> dict:
        body = None if payload is None else json.dumps(payload, ensure_ascii=False).encode("utf-8")
        request = urllib.request.Request(
            origin + path,
            data=body,
            headers={
                "Authorization": f"Bearer {token}",
                "Accept": "application/json",
                **({"Content-Type": "application/json"} if body is not None else {}),
            },
            method="POST" if body is not None else "GET",
        )
        try:
            with self.opener.open(request, timeout=timeout) as response:
                parsed = json.load(response)
        except urllib.error.HTTPError as error:
            raise ValueError(f"service returned HTTP {error.code}") from error
        if not isinstance(parsed, dict):
            raise ValueError("service returned a non-object JSON response")
        return parsed

    def open_events(self, config: Config):
        query = urllib.parse.urlencode({"client_id": config.client_id})
        request = urllib.request.Request(
            f"{config.core_url}/events?{query}",
            headers={
                "Authorization": f"Bearer {config.core_token}",
                "Accept": "text/event-stream",
            },
        )
        try:
            return self.opener.open(request, timeout=config.turn_timeout_seconds)
        except urllib.error.HTTPError as error:
            raise ValueError(f"core events returned HTTP {error.code}") from error


def terminal_event(stream, request_id: str, thread_id: str, deadline: float) -> dict:
    data_lines: list[str] = []
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise ManualReview("OpenHuman turn exceeded the wall-clock deadline")
        # HTTPResponse.readline uses a socket timeout; cap each blocking read by
        # the remaining turn budget, not merely by time since the last ping.
        socket = getattr(getattr(getattr(stream, "fp", None), "raw", None), "_sock", None)
        if socket is not None:
            socket.settimeout(remaining)
        raw = stream.readline(MAX_SSE_LINE + 1)
        if time.monotonic() >= deadline:
            raise ManualReview("OpenHuman turn exceeded the wall-clock deadline")
        if not raw:
            raise ManualReview("core event stream ended before a terminal reply")
        if len(raw) > MAX_SSE_LINE:
            raise ManualReview("core event exceeded the pilot size limit")
        line = raw.decode("utf-8").rstrip("\r\n")
        if line.startswith("data:"):
            data_lines.append(line[5:].lstrip(" "))
            continue
        if line or not data_lines:
            continue
        value = json.loads("\n".join(data_lines))
        data_lines.clear()
        if not isinstance(value, dict):
            continue
        if value.get("request_id") != request_id or value.get("thread_id") != thread_id:
            continue
        if value.get("event") in {"chat_done", "chat_error"}:
            return value


@contextlib.contextmanager
def single_instance(db_path: Path):
    lock_path = db_path.with_name(db_path.name + ".lock")
    lock_path.parent.mkdir(parents=True, exist_ok=True)
    with lock_path.open("a+b") as file:
        if os.name == "nt":
            import msvcrt

            file.seek(0)
            if not file.read(1):
                file.write(b"\0")
                file.flush()
            file.seek(0)
            try:
                msvcrt.locking(file.fileno(), msvcrt.LK_NBLCK, 1)
            except OSError as error:
                raise ManualReview("another adapter instance owns this state database") from error
            try:
                yield
            finally:
                file.seek(0)
                msvcrt.locking(file.fileno(), msvcrt.LK_UNLCK, 1)
        else:
            import fcntl

            try:
                fcntl.flock(file.fileno(), fcntl.LOCK_EX | fcntl.LOCK_NB)
            except OSError as error:
                raise ManualReview("another adapter instance owns this state database") from error
            try:
                yield
            finally:
                fcntl.flock(file.fileno(), fcntl.LOCK_UN)


class Adapter:
    def __init__(self, config: Config, store: Store, http: Http | None = None):
        self.config = config
        self.store = store
        self.http = http or Http()
        self._next_history_audit = 0.0

    def bridge_events(self, after: int = 0) -> list[dict]:
        result: list[dict] = []
        while True:
            query = urllib.parse.urlencode({"after": after, "limit": PAGE_SIZE})
            response = self.http.json_request(
                self.config.bridge_url, f"/api/v1/events?{query}", self.config.bridge_token
            )
            page = response.get("data")
            if not isinstance(page, list) or any(not isinstance(row, dict) for row in page):
                raise ValueError("bridge event feed has an invalid data shape")
            if not page:
                break
            for row in page:
                sequence = row.get("sequence")
                if type(sequence) is not int or sequence <= after:
                    raise ValueError("bridge event feed is not strictly increasing")
                after = sequence
                result.append(row)
            if len(page) < PAGE_SIZE:
                break
        return result

    def eligible(self, event: dict) -> bool:
        config = self.config
        if (
            event.get("chat_guid") != config.chat_guid
            or event.get("kind") != "text"
            or event.get("is_from_me") is not False
            or event.get("source") != "runtime"
            or event.get("sender") != config.owner_handle
        ):
            return False
        guid = event.get("guid")
        text = event.get("text")
        if not isinstance(guid, str) or not isinstance(text, str) or not text.strip():
            return False
        try:
            uuid.UUID(guid)
        except ValueError:
            return False
        participants = event.get("participants")
        if not isinstance(participants, list) or config.owner_handle not in participants or any(
            not isinstance(item, str) or item not in {config.owner_handle, config.bot_handle}
            for item in participants
        ):
            return False
        return True

    def verify_target(self) -> None:
        response = self.http.json_request(
            self.config.bridge_url,
            "/api/v1/chat/" + urllib.parse.quote(self.config.chat_guid, safe=""),
            self.config.bridge_token,
        )
        chat = response.get("data")
        owner_address = (
            self.config.owner_handle[4:]
            if self.config.owner_handle.startswith("tel:")
            else self.config.owner_handle[7:]
        )
        if (
            not isinstance(chat, dict)
            or chat.get("guid") != self.config.chat_guid
            or chat.get("isGroup") is not False
            or chat.get("service") != "iMessage"
            or chat.get("participants") != [{"address": owner_address}]
        ):
            raise ManualReview("bridge chat no longer matches the single-owner direct-chat target")

    def initialize(self) -> int:
        self.verify_target()
        events = self.bridge_events()
        high = events[-1]["sequence"] if events else 0
        self.store.initialize(high)
        return high

    def poll(self) -> int:
        cursor = self.store.cursor()
        if cursor is None:
            raise ValueError("state is uninitialized; run init once before run")
        now = time.monotonic()
        if now >= self._next_history_audit:
            retained = self.bridge_events()
            if (retained[-1]["sequence"] if retained else 0) < cursor:
                raise ManualReview("bridge ledger sequence appears to have reset")
            self._next_history_audit = now + 60
        events = self.bridge_events(cursor)
        added = self.store.ingest(events, self.eligible)
        if events:
            LOG.info("Ingested %d owner message(s); bridge cursor=%d", added, events[-1]["sequence"])
        return added

    def reconcile_sending(self) -> None:
        item = self.store.next_inbox()
        if item is None or item["state"] != "ready_to_send":
            return
        part = self.store.next_outbox(item["sequence"])
        if part is None or part["state"] != "sending":
            return
        matches = [
            event for event in self.bridge_events()
            if event.get("source") == "api"
            and event.get("is_from_me") is True
            and event.get("chat_guid") == self.config.chat_guid
            and event.get("kind") == "text"
            and event.get("sender") == self.config.bot_handle
            and event.get("temp_guid") == part["temp_guid"]
        ]
        if len(matches) == 1 and matches[0].get("text") == part["body"]:
            guid = matches[0].get("guid")
            if isinstance(guid, str) and guid:
                self.store.set_sent(item["sequence"], part["part"], guid)
                LOG.info("Reconciled an uncertain outbound part from bridge ledger")
                return
        raise ManualReview(
            "outbound send is uncertain and absent from the retained bridge ledger; "
            "check the phone before making any manual decision"
        )

    def run_core(self, item) -> None:
        config = self.config
        # A headless core can boot with its approval gate disabled by an env
        # override. Never deliver owner instructions to such a core: tools
        # with external effects would otherwise run without a decision.
        try:
            gate_response = self.http.json_request(
                config.core_url,
                "/rpc",
                config.core_token,
                payload={
                    "jsonrpc": "2.0", "id": 0,
                    "method": "openhuman.approval_get_gate_state",
                    "params": {},
                },
            )
        except (OSError, TimeoutError, ValueError, urllib.error.URLError) as error:
            raise ManualReview("OpenHuman approval gate state is unavailable") from error
        # This RPC has no audit logs, so RpcOutcome serializes its value
        # directly in JSON-RPC's result (not under result.result).
        gate = gate_response.get("result")
        if (
            gate_response.get("error") is not None
            or not isinstance(gate, dict)
            or gate.get("installed") is not True
            or gate.get("disabledByEnv") is not False
        ):
            raise ManualReview("OpenHuman approval gate is not confirmed active")
        status = self.http.json_request(
            config.core_url,
            "/rpc",
            config.core_token,
            payload={
                "jsonrpc": "2.0", "id": 1,
                "method": "openhuman.channel_web_queue_status",
                "params": {"thread_id": config.thread_id},
            },
        )
        if status.get("error") or status.get("result", {}).get("result", {}).get("active") is not False:
            raise ManualReview("OpenHuman thread is already active or queue status is unavailable")
        # The stream must be subscribed before the turn is submitted.
        with self.http.open_events(config) as stream:
            deadline = time.monotonic() + config.turn_timeout_seconds
            self.store.set_core_uncertain(item["sequence"])
            request = {
                "jsonrpc": "2.0", "id": 2,
                "method": "openhuman.channel_web_chat",
                "params": {
                    "client_id": config.client_id,
                    "thread_id": config.thread_id,
                    "message": item["body"],
                    "source": "openbubbles_pilot",
                },
            }
            try:
                ack = self.http.json_request(
                    config.core_url, "/rpc", config.core_token, payload=request, timeout=30
                )
                result = ack.get("result", {}).get("result", {})
                if ack.get("error") or result.get("accepted") is not True:
                    raise ManualReview("OpenHuman did not acknowledge the chat turn")
                request_id = result.get("request_id")
                if not isinstance(request_id, str) or not request_id:
                    raise ManualReview("OpenHuman acknowledgment has no request ID")
                self.store.set_core_uncertain(item["sequence"], request_id)
                terminal = terminal_event(stream, request_id, config.thread_id, deadline)
            except (OSError, TimeoutError, ValueError, urllib.error.URLError) as error:
                raise ManualReview("OpenHuman turn outcome is uncertain") from error
        if terminal["event"] == "chat_error":
            issue = terminal.get("error_type")
            if not isinstance(issue, str) or not re.fullmatch(r"[A-Za-z0-9_.-]{1,80}", issue):
                issue = "chat_error"
            self.store.set_failed(item["sequence"], issue)
            LOG.warning("OpenHuman reported a failed turn (type=%s)", issue)
            return
        reply = terminal.get("full_response")
        if not isinstance(reply, str) or not reply.strip():
            raise ManualReview("OpenHuman completed without a usable reply")
        self.store.prepare_reply(item["sequence"], item["guid"], reply, config.chat_guid)

    def send_parts(self, sequence: int) -> None:
        while (part := self.store.next_outbox(sequence)) is not None:
            if part["state"] == "sending":
                self.reconcile_sending()
                continue
            if part["state"] != "pending":
                raise ManualReview("outbound part has an unknown state")
            self.store.set_sending(sequence, part["part"])
            try:
                response = self.http.json_request(
                    self.config.bridge_url,
                    "/api/v1/message/text",
                    self.config.bridge_token,
                    payload={
                        "chatGuid": self.config.chat_guid,
                        "message": part["body"],
                        "tempGuid": part["temp_guid"],
                    },
                    timeout=550,
                )
                data = response.get("data")
                if not isinstance(data, dict) or data.get("accepted") is not True:
                    raise ValueError("bridge did not confirm recipient APNs acceptance")
                guid = data.get("guid")
                if not isinstance(guid, str) or not guid:
                    raise ValueError("bridge send response had no GUID")
                self.store.set_sent(sequence, part["part"], guid)
            except (OSError, TimeoutError, ValueError, urllib.error.URLError) as error:
                raise ManualReview("outbound send is uncertain; inspect bridge ledger and phone") from error

    def step(self) -> None:
        self.poll()
        self.verify_target()
        self.reconcile_sending()
        item = self.store.next_inbox()
        if item is None:
            return
        if item["state"] == "core_uncertain":
            raise ManualReview("OpenHuman turn is uncertain; inspect its thread before resuming")
        if item["state"] == "pending":
            self.run_core(item)
            item = self.store.next_inbox()
        if item is not None and item["state"] == "ready_to_send":
            self.send_parts(item["sequence"])


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("command", choices=["init", "run", "status"])
    parser.add_argument("--config", required=True, type=Path)
    args = parser.parse_args()
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")
    try:
        config = Config.load(args.config)
        with single_instance(config.state_db):
            store = Store(config.state_db)
            try:
                adapter = Adapter(config, store)
                if args.command == "init":
                    print(f"Initialized at bridge sequence {adapter.initialize()}; send a new message to test.")
                elif args.command == "status":
                    print(json.dumps({"cursor": store.cursor(), "inbox": store.counts()}, sort_keys=True))
                else:
                    if store.cursor() is None:
                        raise ValueError("run init once before run")
                    while True:
                        adapter.step()
                        time.sleep(config.poll_seconds)
            finally:
                store.close()
    except urllib.error.URLError:
        LOG.error("Pilot stopped: local service connection failed")
        return 1
    except (ManualReview, ValueError) as error:
        LOG.error("Pilot stopped: %s", error)
        return 1
    except KeyboardInterrupt:
        LOG.info("Pilot stopped by operator")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
