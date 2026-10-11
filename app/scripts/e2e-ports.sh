#!/usr/bin/env bash

# Port selection shared by the web E2E build and session scripts (#5918).
#
# The three harness ports used to be fixed constants, so two sessions on one
# machine claimed the same ones. The second session bound nothing and ran
# against the first session's mock backend, core and served bundle: no error,
# and failures that read exactly like product defects ("Session validation
# failed", "Connection refused", "Core startup failed").
#
# `E2E_PORT_BASE` gives a session its own block. The build and the session must
# agree on it, because the mock and core ports are baked into the bundle at
# build time and cannot be changed at run time (#6478) — which is why this
# lives in one file both scripts source instead of in each of them.

E2E_DEFAULT_MOCK_PORT=18473
E2E_DEFAULT_CORE_PORT=17788
E2E_DEFAULT_WEB_PORT=4173

# Resolve E2E_MOCK_PORT / OPENHUMAN_CORE_PORT / E2E_WEB_PORT.
#
# An explicit per-port variable always wins, so existing callers and CI lanes
# that set one keep their behaviour; `E2E_PORT_BASE` only supplies defaults.
e2e_resolve_ports() {
  local mock_default="$E2E_DEFAULT_MOCK_PORT"
  local core_default="$E2E_DEFAULT_CORE_PORT"
  local web_default="$E2E_DEFAULT_WEB_PORT"
  local base="${E2E_PORT_BASE:-}"

  if [ -n "$base" ]; then
    # A leading zero would be read as octal by `$((base + 1))`: `031000`
    # resolves to 12801 and `08000` fails outright as an invalid digit, both
    # while passing the decimal range check below.
    case "$base" in
      '' | *[!0-9]* | 0*)
        echo "ERROR: E2E_PORT_BASE must be a port number without a leading zero, got '$base'" >&2
        return 1
        ;;
    esac
    # The block is base, base+1, base+2, so the last usable base is 65533.
    # Staying above 1024 keeps it off the privileged range.
    if [ "$base" -lt 1024 ] || [ "$base" -gt 65533 ]; then
      echo "ERROR: E2E_PORT_BASE must be between 1024 and 65533 (it claims base..base+2), got $base" >&2
      return 1
    fi
    mock_default="$base"
    core_default="$((base + 1))"
    web_default="$((base + 2))"
  fi

  E2E_MOCK_PORT="${E2E_MOCK_PORT:-$mock_default}"
  OPENHUMAN_CORE_PORT="${OPENHUMAN_CORE_PORT:-$core_default}"
  E2E_WEB_PORT="${E2E_WEB_PORT:-$web_default}"
}

# Refuse to start when something is already listening on one of the ports.
#
# This has to happen before anything is launched, because every readiness probe
# in the session is an HTTP GET and another session's server answers those just
# as happily. The core is the reason it cannot be left to the launch failing:
# `openhuman-core run` does not exit when its port is held — it falls back to
# preferred+1..+10 (`pick_listen_port_for_host_with`), so it stays alive on a
# port nothing probes while `/health` and the authenticated RPC probe are
# answered by the other session's core.
#
# The probe connects rather than binds. A bind answers only whether THIS
# process could take the address, which is a different question: with
# `SO_REUSEADDR` a `127.0.0.1:port` bind coexists with an existing
# `0.0.0.0:port` listener on macOS and BSD, so the port reads as free while
# that listener goes on answering every probe the session makes. A successful
# connect is the condition that actually matters — something is serving this
# port — and it is not fooled by a `TIME_WAIT` socket from a previous run.
e2e_require_free_ports() {
  local blocked=""
  local port

  for port in "$@"; do
    if ! python3 - "$port" <<'PY'
import socket, sys

try:
    with socket.create_connection(("127.0.0.1", int(sys.argv[1])), timeout=1):
        sys.exit(1)  # something answered: the port is taken
except OSError:
    pass  # refused, unreachable or timed out: nothing is serving it
PY
    then
      blocked="${blocked} ${port}"
    fi
  done

  if [ -n "$blocked" ]; then
    echo "ERROR: already in use on 127.0.0.1:${blocked}" >&2
    echo "       Another web E2E session, or another process, is listening there. Starting" >&2
    echo "       anyway would run this session's specs against that one's backend." >&2
    echo "       Give this session its own port block, for the build and the run:" >&2
    echo "         E2E_PORT_BASE=<free base> pnpm --filter openhuman-app test:e2e:web" >&2
    echo "       The mock and core ports are baked into the bundle, so both must use the same base." >&2
    return 1
  fi
}
