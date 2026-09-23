"""SQLite inbox, cursor, and outbox for the single-chat pilot."""

from __future__ import annotations

import hashlib
import os
import sqlite3
from pathlib import Path


def split_reply(text: str, size: int = 3500) -> list[str]:
    if not text.strip():
        raise ValueError("OpenHuman returned an empty reply")
    parts: list[str] = []
    current: list[str] = []
    current_bytes = 0
    for character in text:
        character_bytes = len(character.encode("utf-8"))
        if character_bytes > size:
            raise ValueError("OpenHuman reply contains an oversized codepoint")
        if current_bytes + character_bytes > size:
            parts.append("".join(current))
            if len(parts) >= 4:
                raise ValueError("OpenHuman reply exceeds the pilot's four-message limit")
            current = []
            current_bytes = 0
        current.append(character)
        current_bytes += character_bytes
    if current:
        parts.append("".join(current))
    return parts


class Store:
    def __init__(self, path: Path):
        path.parent.mkdir(parents=True, exist_ok=True)
        self.db = sqlite3.connect(path)
        if os.name != "nt":
            path.chmod(0o600)
        self.db.row_factory = sqlite3.Row
        self.db.execute("PRAGMA journal_mode=WAL")
        self.db.execute("PRAGMA synchronous=FULL")
        self.db.executescript(
            """
            CREATE TABLE IF NOT EXISTS meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
            CREATE TABLE IF NOT EXISTS inbox (
              sequence INTEGER PRIMARY KEY, guid TEXT NOT NULL UNIQUE,
              body TEXT NOT NULL, state TEXT NOT NULL,
              core_request_id TEXT, issue TEXT
            );
            CREATE TABLE IF NOT EXISTS outbox (
              sequence INTEGER NOT NULL REFERENCES inbox(sequence),
              part INTEGER NOT NULL, temp_guid TEXT NOT NULL UNIQUE,
              body TEXT NOT NULL, state TEXT NOT NULL, bridge_guid TEXT,
              PRIMARY KEY (sequence, part)
            );
            """
        )

    def close(self) -> None:
        self.db.close()

    def cursor(self) -> int | None:
        row = self.db.execute("SELECT value FROM meta WHERE key='cursor'").fetchone()
        return int(row[0]) if row else None

    def initialize(self, cursor: int) -> None:
        if self.cursor() is not None:
            raise ValueError("cursor is already initialized")
        with self.db:
            self.db.execute("INSERT INTO meta VALUES ('cursor', ?)", (str(cursor),))

    def ingest(self, events: list[dict], eligible) -> int:
        cursor = self.cursor()
        if cursor is None:
            raise ValueError("run init before ingesting events")
        added = 0
        with self.db:
            for event in events:
                sequence = event.get("sequence")
                if type(sequence) is not int or sequence < 1:
                    raise ValueError("bridge event has no valid sequence")
                if sequence <= cursor:
                    continue
                if sequence != cursor + 1:
                    raise ValueError(f"bridge event sequence gap after {cursor}")
                if eligible(event):
                    guid = event["guid"].upper()
                    old = self.db.execute("SELECT body FROM inbox WHERE guid=?", (guid,)).fetchone()
                    if old and old[0] != event["text"]:
                        raise ValueError("bridge reused an inbound GUID with different text")
                    if not old:
                        self.db.execute(
                            "INSERT INTO inbox(sequence,guid,body,state) VALUES (?,?,?,'pending')",
                            (sequence, guid, event["text"]),
                        )
                        added += 1
                cursor = sequence
            self.db.execute("UPDATE meta SET value=? WHERE key='cursor'", (str(cursor),))
        return added

    def next_inbox(self):
        return self.db.execute(
            "SELECT * FROM inbox WHERE state NOT IN ('sent','failed') ORDER BY sequence LIMIT 1"
        ).fetchone()

    def set_core_uncertain(self, sequence: int, request_id: str | None = None) -> None:
        with self.db:
            self.db.execute(
                "UPDATE inbox SET state='core_uncertain', core_request_id=COALESCE(?,core_request_id) "
                "WHERE sequence=?",
                (request_id, sequence),
            )

    def set_failed(self, sequence: int, issue: str) -> None:
        with self.db:
            self.db.execute(
                "UPDATE inbox SET state='failed', issue=? WHERE sequence=?",
                (issue, sequence),
            )

    def prepare_reply(self, sequence: int, guid: str, text: str, chat_guid: str) -> None:
        parts = split_reply(text)
        with self.db:
            for index, part in enumerate(parts):
                seed = f"{chat_guid}\0{guid}\0{index}".encode("utf-8")
                temp_guid = "openhuman-" + hashlib.sha256(seed).hexdigest()
                self.db.execute(
                    "INSERT INTO outbox(sequence,part,temp_guid,body,state) "
                    "VALUES (?,?,?,?, 'pending')",
                    (sequence, index, temp_guid, part),
                )
            self.db.execute("UPDATE inbox SET state='ready_to_send' WHERE sequence=?", (sequence,))

    def next_outbox(self, sequence: int):
        return self.db.execute(
            "SELECT * FROM outbox WHERE sequence=? AND state!='sent' ORDER BY part LIMIT 1",
            (sequence,),
        ).fetchone()

    def set_sending(self, sequence: int, part: int) -> None:
        with self.db:
            self.db.execute(
                "UPDATE outbox SET state='sending' WHERE sequence=? AND part=? AND state='pending'",
                (sequence, part),
            )

    def set_sent(self, sequence: int, part: int, bridge_guid: str) -> None:
        with self.db:
            self.db.execute(
                "UPDATE outbox SET state='sent', bridge_guid=? WHERE sequence=? AND part=?",
                (bridge_guid, sequence, part),
            )
            remaining = self.db.execute(
                "SELECT COUNT(*) FROM outbox WHERE sequence=? AND state!='sent'", (sequence,)
            ).fetchone()[0]
            if remaining == 0:
                self.db.execute("UPDATE inbox SET state='sent' WHERE sequence=?", (sequence,))

    def counts(self) -> dict[str, int]:
        return {
            row[0]: row[1]
            for row in self.db.execute("SELECT state, COUNT(*) FROM inbox GROUP BY state")
        }
