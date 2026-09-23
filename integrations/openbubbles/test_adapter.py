"""Offline behavior tests for the pilot's actual bridge/core wire shapes."""

from __future__ import annotations

import io
import tempfile
import unittest
import urllib.parse
from pathlib import Path
from unittest.mock import patch

from adapter import Adapter, ManualReview, terminal_event
from config import Config
from store import Store, split_reply

OWNER = "tel:+15555550123"
BOT = "mailto:bot@example.invalid"
CHAT = "example-allowlisted-chat"


def inbound(sequence: int, guid: str, text: str = "hello") -> dict:
    return {
        "sequence": sequence,
        "chat_guid": CHAT,
        "guid": guid,
        "kind": "text",
        "text": text,
        "is_from_me": False,
        "source": "runtime",
        "sender": OWNER,
        "participants": [OWNER, BOT],
    }


class FakeStream(io.BytesIO):
    def __enter__(self):
        return self

    def __exit__(self, *_):
        self.close()


class HeartbeatStream:
    def __init__(self):
        self.reads = 0

    def readline(self, _limit):
        self.reads += 1
        return b": keepalive\n"


class FakeHttp:
    def __init__(self):
        self.events: list[dict] = []
        self.sends: list[dict] = []
        self.chat_calls = 0
        self.send_timeout = False
        self.stream_eof = False
        self.stream_error = False
        self.gate_response = {"result": {
            "installed": True, "disabledByEnv": False,
            "overrideIgnored": False, "host": "cli",
        }}
        self.gate_error = None
        self.rpc_methods: list[str] = []

    def json_request(self, origin, path, token, *, payload=None, timeout=20):
        if path.startswith("/api/v1/events?"):
            query = urllib.parse.parse_qs(urllib.parse.urlsplit(path).query)
            after = int(query["after"][0])
            limit = int(query["limit"][0])
            return {"data": [row for row in self.events if row["sequence"] > after][:limit]}
        if path == "/rpc":
            self.rpc_methods.append(payload["method"])
        if path == "/rpc" and payload["method"] == "openhuman.approval_get_gate_state":
            if self.gate_error is not None:
                raise self.gate_error
            return self.gate_response
        if path == "/rpc" and payload["method"] == "openhuman.channel_web_queue_status":
            return {"result": {"result": {"active": False}}}
        if path == "/rpc" and payload["method"] == "openhuman.channel_web_chat":
            self.chat_calls += 1
            return {"result": {"result": {"accepted": True, "request_id": "request-1"}}}
        if path == "/api/v1/message/text":
            self.sends.append(payload)
            if self.send_timeout:
                raise TimeoutError("mock send reply lost")
            self.events.append({
                "sequence": self.events[-1]["sequence"] + 1,
                "chat_guid": CHAT, "guid": "outbound-guid", "kind": "text",
                "text": payload["message"], "is_from_me": True,
                "source": "api", "sender": BOT, "temp_guid": payload["tempGuid"],
            })
            return {"data": {"accepted": True, "guid": "outbound-guid"}}
        if path.startswith("/api/v1/chat/"):
            return {"data": {
                "guid": CHAT,
                "isGroup": False,
                "service": "iMessage",
                "participants": [{"address": OWNER[4:]}],
            }}
        raise AssertionError(f"unexpected request path {path}")

    def open_events(self, config):
        if self.stream_eof:
            return FakeStream(b"")
        if self.stream_error:
            return FakeStream(
                b'data: {"event":"chat_error","request_id":"request-1",'
                b'"thread_id":"pilot-thread","error_type":"unsafe private text"}\n\n'
            )
        return FakeStream(
            b'event: chat_done\r\ndata: {"event":"chat_done","request_id":"request-1",'
            b'"thread_id":"pilot-thread","full_response":"Hi back"}\r\n\r\n'
        )


class AdapterTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.store = Store(Path(self.temp.name) / "pilot.sqlite3")
        self.addCleanup(self.store.close)
        self.config = Config(
            bridge_url="http://127.0.0.1:12345",
            core_url="http://127.0.0.1:8787",
            chat_guid=CHAT,
            owner_handle=OWNER,
            bot_handle=BOT,
            state_db=Path(self.temp.name) / "pilot.sqlite3",
            client_id="pilot-client",
            thread_id="pilot-thread",
            bridge_token="b" * 32,
            core_token="c" * 32,
            poll_seconds=1,
            turn_timeout_seconds=30,
        )
        self.http = FakeHttp()
        self.adapter = Adapter(self.config, self.store, self.http)

    def test_direct_approval_gate_rpc_shape_precedes_chat(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.adapter.step()
        self.assertEqual(self.http.rpc_methods, [
            "openhuman.approval_get_gate_state",
            "openhuman.channel_web_queue_status",
            "openhuman.channel_web_chat",
        ])
        self.assertEqual(self.store.counts(), {"sent": 1})

    def test_approval_gate_must_be_explicitly_active_before_core_turn(self):
        self.store.initialize(0)
        self.store.ingest(
            [inbound(1, "00000000-0000-4000-8000-000000000001")],
            self.adapter.eligible,
        )
        item = self.store.next_inbox()
        for gate_response in (
            {"result": {"installed": False, "disabledByEnv": False}},
            {"result": {"installed": True, "disabledByEnv": True}},
            {"result": {"installed": True}},
            {"result": {"installed": True, "disabledByEnv": "false"}},
            {"result": {"result": {"installed": True, "disabledByEnv": False}}},
            {"result": None},
            {"error": {"code": -32603}, "result": {"installed": True, "disabledByEnv": False}},
        ):
            with self.subTest(gate_response=gate_response):
                self.http.gate_response = gate_response
                self.http.rpc_methods.clear()
                with self.assertRaisesRegex(ManualReview, "approval gate is not confirmed active"):
                    self.adapter.run_core(item)
                self.assertEqual(self.http.rpc_methods, ["openhuman.approval_get_gate_state"])
                self.assertEqual(self.http.chat_calls, 0)
                self.assertEqual(self.http.sends, [])
                self.assertEqual(self.store.counts(), {"pending": 1})

    def test_approval_gate_rpc_failure_leaves_turn_pending(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.http.gate_error = TimeoutError("mock timeout")
        with self.assertRaisesRegex(ManualReview, "approval gate state is unavailable"):
            self.adapter.step()
        self.assertEqual(self.http.rpc_methods, ["openhuman.approval_get_gate_state"])
        self.assertEqual(self.http.chat_calls, 0)
        self.assertEqual(self.http.sends, [])
        self.assertEqual(self.store.counts(), {"pending": 1})

    def test_two_identical_messages_with_different_guids_get_distinct_sends(self):
        self.store.initialize(0)
        first = "00000000-0000-4000-8000-000000000001"
        second = "00000000-0000-4000-8000-000000000002"
        self.http.events.append(inbound(1, first))
        self.adapter.step()
        self.http.events.append(inbound(3, second))
        self.adapter.step()
        self.assertEqual(self.http.chat_calls, 2)
        self.assertEqual(len(self.http.sends), 2)
        self.assertNotEqual(self.http.sends[0]["tempGuid"], self.http.sends[1]["tempGuid"])
        self.assertEqual(self.store.counts(), {"sent": 2})

    def test_filter_requires_exact_owner_chat_runtime_guid_and_no_group(self):
        self.store.initialize(0)
        guid = "00000000-0000-4000-8000-000000000003"
        variants = [
            {**inbound(1, guid), "sender": "tel:+15555550000"},
            {**inbound(2, guid), "chat_guid": "other-chat"},
            {**inbound(3, guid), "source": "official_log"},
            {**inbound(4, guid), "is_from_me": True},
            {**inbound(5, guid), "guid": None},
            {**inbound(6, guid), "participants": [OWNER, BOT, "tel:+15555559999"]},
            {**inbound(7, guid), "participants": []},
            inbound(8, guid),
        ]
        self.assertEqual(self.store.ingest(variants, self.adapter.eligible), 1)
        self.assertEqual(self.store.cursor(), 8)
        self.assertEqual(self.store.counts(), {"pending": 1})

    def test_target_mismatch_stops_before_core_or_send(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        original = self.http.json_request

        def wrong_chat(origin, path, token, *, payload=None, timeout=20):
            result = original(origin, path, token, payload=payload, timeout=timeout)
            if path.startswith("/api/v1/chat/"):
                result["data"]["participants"] = [{"address": "+15555559999"}]
            return result

        self.http.json_request = wrong_chat
        with self.assertRaisesRegex(ManualReview, "single-owner direct-chat target"):
            self.adapter.step()
        self.assertEqual(self.http.chat_calls, 0)
        self.assertEqual(self.http.sends, [])

    def test_sequence_gap_rolls_back_cursor_and_inbox(self):
        self.store.initialize(5)
        with self.assertRaisesRegex(ValueError, "sequence gap"):
            self.store.ingest([inbound(7, "00000000-0000-4000-8000-000000000007")], self.adapter.eligible)
        self.assertEqual(self.store.cursor(), 5)
        self.assertEqual(self.store.counts(), {})

    def test_lost_send_reply_never_retries_without_ledger_evidence(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.http.send_timeout = True
        with self.assertRaisesRegex(ManualReview, "outbound send is uncertain"):
            self.adapter.step()
        with self.assertRaisesRegex(ManualReview, "absent from the retained bridge ledger"):
            self.adapter.step()
        self.assertEqual(len(self.http.sends), 1)
        self.assertEqual(self.store.counts(), {"ready_to_send": 1})

    def test_uncertain_send_reconciles_from_bridge_ledger(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.http.send_timeout = True
        with self.assertRaises(ManualReview):
            self.adapter.step()
        attempted = self.http.sends[0]
        self.http.events.append({
            "sequence": 2, "chat_guid": CHAT, "guid": "outbound-guid",
            "kind": "text", "text": attempted["message"],
            "is_from_me": True, "source": "api", "sender": BOT,
            "temp_guid": attempted["tempGuid"],
        })
        self.adapter.step()
        self.assertEqual(len(self.http.sends), 1)
        self.assertEqual(self.store.counts(), {"sent": 1})

    def test_core_stream_loss_is_uncertain_and_not_replayed(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.http.stream_eof = True
        with self.assertRaisesRegex(ManualReview, "stream ended"):
            self.adapter.step()
        with self.assertRaisesRegex(ManualReview, "turn is uncertain"):
            self.adapter.step()
        self.assertEqual(self.http.chat_calls, 1)
        self.assertEqual(len(self.http.sends), 0)

    def test_chat_error_stores_only_safe_type_and_never_sends(self):
        self.store.initialize(0)
        self.http.events.append(inbound(1, "00000000-0000-4000-8000-000000000001"))
        self.http.stream_error = True
        self.adapter.step()
        self.assertEqual(self.store.counts(), {"failed": 1})
        issue = self.store.db.execute("SELECT issue FROM inbox").fetchone()[0]
        self.assertEqual(issue, "chat_error")
        self.assertEqual(self.http.sends, [])

    def test_sse_ignores_unrelated_request(self):
        stream = FakeStream(
            b'data: {"event":"chat_done","request_id":"other","thread_id":"pilot-thread"}\n\n'
            b'data: {"event":"chat_error","request_id":"wanted","thread_id":"pilot-thread"}\n\n'
        )
        self.assertEqual(
            terminal_event(stream, "wanted", "pilot-thread", float("inf"))["event"],
            "chat_error",
        )

    def test_repeated_sse_keepalives_cannot_extend_turn_deadline(self):
        stream = HeartbeatStream()
        with patch("adapter.time.monotonic", side_effect=[0, 0.1, 0.2, 0.3, 0.4, 0.5, 1]):
            with self.assertRaisesRegex(ManualReview, "wall-clock deadline"):
                terminal_event(stream, "wanted", "pilot-thread", 1)
        self.assertEqual(stream.reads, 3)

    def test_reply_parts_preserve_text_and_limit_volume(self):
        reply = "x" * 8000
        self.assertEqual("".join(split_reply(reply)), reply)
        self.assertEqual(len(split_reply(reply)), 3)
        with self.assertRaisesRegex(ValueError, "four-message limit"):
            split_reply("x" * 14001)

    def test_reply_parts_limit_utf8_bytes_without_splitting_emoji(self):
        reply = "a" * 3499 + "🙂" * 1750
        parts = split_reply(reply)
        self.assertEqual("".join(parts), reply)
        self.assertTrue(all(len(part.encode("utf-8")) <= 3500 for part in parts))
        self.assertEqual(parts[0], "a" * 3499)
        self.assertEqual(len(split_reply("🙂" * 3500)), 4)
        with self.assertRaisesRegex(ValueError, "four-message limit"):
            split_reply("🙂" * 3501)

    def test_initialization_skips_history_and_bridge_reset_stops(self):
        self.http.events.append(inbound(5, "00000000-0000-4000-8000-000000000005"))
        self.assertEqual(self.adapter.initialize(), 5)
        self.assertEqual(self.store.counts(), {})
        self.http.events.clear()
        with self.assertRaisesRegex(ManualReview, "ledger sequence appears to have reset"):
            self.adapter.step()


if __name__ == "__main__":
    unittest.main()
