"""Private runtime configuration for the OpenBubbles pilot."""

from __future__ import annotations

import json
import os
from dataclasses import dataclass
from pathlib import Path
from urllib.parse import urlsplit


def _loopback_url(value: object, name: str) -> str:
    if not isinstance(value, str):
        raise ValueError(f"{name} must be a loopback HTTP URL")
    parsed = urlsplit(value)
    if (
        parsed.scheme != "http"
        or parsed.hostname not in {"127.0.0.1", "::1", "localhost"}
        or parsed.port is None
        or parsed.username is not None
        or parsed.password is not None
        or parsed.path not in {"", "/"}
        or parsed.query
        or parsed.fragment
    ):
        raise ValueError(f"{name} must be a bare loopback HTTP origin with a port")
    return value.rstrip("/")


def _required(raw: dict[str, object], name: str) -> str:
    value = raw.get(name)
    if not isinstance(value, str) or not value.strip():
        raise ValueError(f"{name} must be a nonempty string")
    return value.strip()


def _handle(value: str, name: str) -> str:
    if value.startswith("tel:+") and value[5:].isdigit():
        return value
    if value.startswith("mailto:") and "@" in value[7:] and not any(c.isspace() for c in value):
        return value
    raise ValueError(f"{name} must be a normalized tel:+ or mailto: handle")


@dataclass(frozen=True)
class Config:
    bridge_url: str
    core_url: str
    chat_guid: str
    owner_handle: str
    bot_handle: str
    state_db: Path
    client_id: str
    thread_id: str
    bridge_token: str
    core_token: str
    poll_seconds: float
    turn_timeout_seconds: float

    @classmethod
    def load(cls, path: Path) -> "Config":
        raw = json.loads(path.read_text(encoding="utf-8"))
        if not isinstance(raw, dict):
            raise ValueError("configuration must be a JSON object")
        state_db = Path(_required(raw, "state_db")).expanduser()
        if not state_db.is_absolute():
            raise ValueError("state_db must be an absolute private path")
        bridge_token = os.environ.get("OPENBUBBLES_BRIDGE_TOKEN", "")
        core_token = os.environ.get("OPENHUMAN_CORE_TOKEN", "")
        if len(bridge_token) < 32 or len(core_token) < 32:
            raise ValueError("set both OPENBUBBLES_BRIDGE_TOKEN and OPENHUMAN_CORE_TOKEN")
        poll_seconds = float(raw.get("poll_seconds", 2))
        turn_timeout_seconds = float(raw.get("turn_timeout_seconds", 900))
        if not 0.2 <= poll_seconds <= 60 or not 30 <= turn_timeout_seconds <= 3600:
            raise ValueError("poll_seconds or turn_timeout_seconds is outside its safe range")
        owner_handle = _handle(_required(raw, "owner_handle"), "owner_handle")
        bot_handle = _handle(_required(raw, "bot_handle"), "bot_handle")
        if owner_handle == bot_handle:
            raise ValueError("owner_handle and bot_handle must differ")
        return cls(
            bridge_url=_loopback_url(raw.get("bridge_url"), "bridge_url"),
            core_url=_loopback_url(raw.get("core_url"), "core_url"),
            chat_guid=_required(raw, "chat_guid"),
            owner_handle=owner_handle,
            bot_handle=bot_handle,
            state_db=state_db.resolve(),
            client_id=_required(raw, "client_id"),
            thread_id=_required(raw, "thread_id"),
            bridge_token=bridge_token,
            core_token=core_token,
            poll_seconds=poll_seconds,
            turn_timeout_seconds=turn_timeout_seconds,
        )
