# OpenBubbles → OpenHuman pilot

This adapter connects one allowlisted Windows OpenBubbles conversation to the
same OpenHuman core chat and tool runtime used by its web chat. It is a separate
Python process and does not modify Apple account state, the OpenBubbles app, or
OpenHuman's vendored `tinychannels` submodule. Python 3.11 or newer is enough;
there are no third-party Python packages.

The tested wire contract is:

1. Read OpenBubbles `GET /api/v1/events?after=<sequence>&limit=1000` with a
   bearer token. Only native runtime text messages with the configured chat,
   sender, GUID, and direct-chat participants enter the SQLite inbox.
2. Open an authenticated OpenHuman `GET /events?client_id=<id>` stream, then
   submit `openhuman.channel_web_chat` to `POST /rpc`. Correlate `chat_done` or
   `chat_error` by request and thread IDs. Only a completed `chat_done` can
   create outbound work.
3. Send each reply part through OpenBubbles `POST /api/v1/message/text` with
   the configured `chatGuid` and a stable `tempGuid` derived from the inbound
   GUID and part number. The adapter accepts a recipient APNs confirmation as
   a successful send; that alone is not proof the phone displayed the message.

The adapter uses the standalone `openhuman-core serve` HTTP server from the
fork's current `main`, not the installed v0.63.12 desktop release. The desktop
shell keeps its RPC token in process memory, so its private listener is not an
adapter credential. Start a standalone core with a private
`OPENHUMAN_CORE_TOKEN`. For an isolated pilot, set `OPENHUMAN_APP_ENV=staging`
and point `OPENHUMAN_WORKSPACE` at a separate private workspace; staging uses
`~/.openhuman-staging` for its app state. Web chat can run signed out with a
configured local model, so login credential setup is not a prerequisite for
this channel. Configure and verify the LM Studio local API independently
before enabling the adapter. The adapter invokes OpenHuman's normal agent
tools and memory according to that core's settings; it does not grant or
restrict individual tools. Review that core's permissions before starting it
with personal messages.

## Private setup

1. Make a copy of `config.example.json` outside this repository. Fill in the
   bridge and core loopback ports, the sole bridge chat GUID, normalized owner
   and bot handles, and an absolute private SQLite path. The example handles
   are placeholders. Never put a populated config or the SQLite files in Git.
2. Set `OPENBUBBLES_BRIDGE_TOKEN` and `OPENHUMAN_CORE_TOKEN` in the adapter's
   environment. They must match the two running services and be at least 32
   characters. Keep the tokens out of command arguments and logs.
3. Verify that the OpenBubbles headless bridge and standalone OpenHuman core
   are running on loopback. The bridge's own one-recipient guard remains the
   outer send boundary. The adapter also checks that the configured bridge
   chat is a direct iMessage chat with exactly the configured owner before
   starting a turn.
4. Run `py -3 integrations/openbubbles/adapter.py init --config
   C:\\private\\pilot-config.json` once. Initialization records the bridge's
   current highest event sequence without processing old messages. Send a new
   message only after initialization finishes.
5. Run `py -3 integrations/openbubbles/adapter.py run --config
   C:\\private\\pilot-config.json`. Use `status` in place of `run` for a local
   cursor and state count snapshot. Stop with Ctrl+C.

The `init` command refuses an already initialized database. To repeat the
pilot from a new baseline, choose a **new** SQLite path after reviewing the
old database; do not silently delete it. Only one process can own a state
database at a time.

## Recovery and limits

- The inbox cursor, accepted messages, and outbox are committed to SQLite.
  Sequence gaps or a reset bridge ledger stop the adapter. Bridge events are
  retained in a 4,000-event in-memory window backed by its journal; a long
  outage can exceed that window and requires review.
- The adapter marks a core turn uncertain before submitting it. If it crashes
  or loses the SSE stream before a terminal event, it stops on restart instead
  of submitting the prompt again. A tool action may already have occurred.
- The adapter marks an outbound part `sending` before its HTTP call. After a
  lost response, it searches the retained bridge ledger for the exact
  `tempGuid` and text. If found, it records the send; otherwise it stops. The
  bridge persists `tempGuid` **after** the Apple send, so the rare crash between
  those steps cannot be proven safe to retry automatically. Check the phone
  and bridge journal before manually resolving it.
- Text only. The bridge caps messages at 4,000 UTF-8 bytes; the adapter splits
  replies into at most four 3,500-byte parts without breaking Unicode
  characters. An empty or longer reply stops for review. Incoming attachments,
  reactions, edits, and proactive messages are outside this pilot.
- A `chat_error` is stored as a failed turn and is not sent to iMessage. The
  adapter records only its error type, not the error text. A failed turn does
  not block later inbound messages.
- The database contains private inbound text and generated replies. Store and
  back it up as sensitive user data. Normal logs contain counts and states,
  without message bodies, handles, chat GUIDs, or tokens.

Offline verification:

```powershell
py -3 -m unittest discover -s integrations\openbubbles -p test_adapter.py -v
```

The tests mock both HTTP services. They do not start OpenHuman, LM Studio,
OpenBubbles, or send a real message. An owner-phone round trip and restart
check are still required before calling the pilot operational.
