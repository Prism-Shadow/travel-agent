#!/usr/bin/env bash
# Brings up a real Chrome with the Penguin Browser extension attached, on a machine with no
# monitor — a dev box, a container, CI.
#
# Extension mode is not a convenience here: it is the only mode that carries the user's real
# logged-in profile, and every booking flow needs that. The obstacle on a headless machine is not
# Chrome (one is already installed by `penguin-browser browser install`) but the *display* —
# loading an unpacked extension needs a browser with a window, and `--headless` gives none. Xvfb
# supplies a virtual one, which is enough: Chrome renders into it, the extension's service worker
# runs, and it connects to the relay exactly as it would on a desktop.
#
#   scripts/dev-browser.sh            # start (idempotent)
#   scripts/dev-browser.sh stop       # tear down Chrome and the display
#   scripts/dev-browser.sh status     # what is up
#
# After it reports the extension as connected:
#   node packages/browser-cli/dist/cli.js session new
set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
EXTENSION_DIR="$REPO_ROOT/packages/browser-extension/dist"
CLI="$REPO_ROOT/packages/browser-cli/dist/cli.js"
DISPLAY_NUM="${PENGUIN_DEV_DISPLAY:-:99}"
DEBUG_PORT="${PENGUIN_DEV_DEBUG_PORT:-9222}"
PROFILE_DIR="${PENGUIN_DEV_PROFILE:-$HOME/.penguin-browser/dev-profile}"
RELAY_PORT=19989

chrome_binary() {
  # Prefer a system Chrome when one exists; otherwise the Chrome for Testing that
  # `penguin-browser browser install` downloads.
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if command -v "$candidate" >/dev/null 2>&1; then command -v "$candidate"; return; fi
  done
  # Newest first, so an upgrade is picked up without editing this script.
  find "$HOME/.penguin-browser/browsers" -maxdepth 3 -name chrome -type f 2>/dev/null | sort -r | head -1
}

pid_on_port() { ss -lntpH 2>/dev/null | grep ":$1 " | grep -oP 'pid=\K[0-9]+' | head -1; }

status() {
  pgrep -f "Xvfb $DISPLAY_NUM" >/dev/null 2>&1 && echo "display  $DISPLAY_NUM  up" || echo "display  $DISPLAY_NUM  down"
  [ -n "$(pid_on_port "$DEBUG_PORT")" ] && echo "chrome   :$DEBUG_PORT  up" || echo "chrome   :$DEBUG_PORT  down"
  [ -n "$(pid_on_port "$RELAY_PORT")" ] && echo "relay    :$RELAY_PORT  up" || echo "relay    :$RELAY_PORT  down"
}

stop() {
  for port in "$DEBUG_PORT"; do
    pid="$(pid_on_port "$port")"
    [ -n "$pid" ] && kill "$pid" 2>/dev/null && echo "stopped chrome (pid $pid)"
  done
  # Matched on the display argument, never on a bare name: a broad pattern would match the
  # shell running this script and take it down with the target.
  pkill -f "Xvfb $DISPLAY_NUM" 2>/dev/null && echo "stopped display $DISPLAY_NUM" || true
  echo "relay left running (it is shared; stop it with: kill \$(ss -lntpH | grep :$RELAY_PORT | grep -oP 'pid=\\K[0-9]+'))"
}

start() {
  [ -f "$EXTENSION_DIR/manifest.json" ] || {
    echo "Extension not built. Run: pnpm --filter penguin-browser-extension build" >&2
    exit 1
  }
  local chrome; chrome="$(chrome_binary)"
  [ -n "$chrome" ] || {
    echo "No Chrome found. Run: node $CLI browser install" >&2
    exit 1
  }
  echo "chrome:    $chrome"

  if ! pgrep -f "Xvfb $DISPLAY_NUM" >/dev/null 2>&1; then
    command -v Xvfb >/dev/null 2>&1 || { echo "Xvfb is not installed (apt-get install xvfb)" >&2; exit 1; }
    Xvfb "$DISPLAY_NUM" -screen 0 1920x1080x24 -nolisten tcp >/dev/null 2>&1 &
    sleep 2
    echo "display:   $DISPLAY_NUM started"
  else
    echo "display:   $DISPLAY_NUM already up"
  fi

  # The relay must be listening before Chrome starts, or the extension's first connection
  # attempt finds nothing and the session cannot see a browser.
  if [ -z "$(pid_on_port "$RELAY_PORT")" ]; then
    node "$CLI" session list >/dev/null 2>&1 || true
    sleep 1
  fi
  echo "relay:     $([ -n "$(pid_on_port "$RELAY_PORT")" ] && echo up || echo 'FAILED to start')"

  if [ -n "$(pid_on_port "$DEBUG_PORT")" ]; then
    echo "chrome:    already up on :$DEBUG_PORT"
  else
    mkdir -p "$PROFILE_DIR"
    DISPLAY="$DISPLAY_NUM" "$chrome" \
      --no-sandbox --disable-gpu --no-first-run --no-default-browser-check \
      --remote-debugging-port="$DEBUG_PORT" \
      --user-data-dir="$PROFILE_DIR" \
      --disable-extensions-except="$EXTENSION_DIR" \
      --load-extension="$EXTENSION_DIR" \
      about:blank >/dev/null 2>&1 &
    sleep 6
    echo "chrome:    started on :$DEBUG_PORT (profile $PROFILE_DIR)"
  fi

  if grep -q "Extension connected" "$HOME/.penguin-browser/relay-server.log" 2>/dev/null; then
    echo "extension: connected"
    echo
    echo "Ready. Create a session with:  node packages/browser-cli/dist/cli.js session new"
  else
    echo "extension: not connected yet — check $HOME/.penguin-browser/relay-server.log" >&2
  fi
}

case "${1:-start}" in
  start) start ;;
  stop) stop ;;
  status) status ;;
  *) echo "usage: $0 [start|stop|status]" >&2; exit 1 ;;
esac
