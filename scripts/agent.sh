#!/bin/zsh
# Runs Unscroll in the background on macOS: starts on login, restarts if it crashes.
# Usage: scripts/agent.sh install | uninstall | status | logs
set -euo pipefail

LABEL="com.unscroll.bot"
PLIST="$HOME/Library/LaunchAgents/$LABEL.plist"
DIR="$(cd "$(dirname "$0")/.." && pwd)"
LOG="$DIR/data/unscroll.log"

case "${1:-}" in
  install)
    [[ -f "$DIR/.env" ]] || { echo "Create $DIR/.env first (see .env.example)."; exit 1; }
    NODE="$(command -v node)"
    mkdir -p "$DIR/data" "$HOME/Library/LaunchAgents"
    cat > "$PLIST" <<PLIST
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>$LABEL</string>
  <key>WorkingDirectory</key><string>$DIR</string>
  <key>ProgramArguments</key>
  <array>
    <string>$NODE</string>
    <string>--env-file-if-exists=.env</string>
    <string>--disable-warning=ExperimentalWarning</string>
    <string>--import</string><string>tsx</string>
    <string>src/index.ts</string>
  </array>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>ThrottleInterval</key><integer>30</integer>
  <key>StandardOutPath</key><string>$LOG</string>
  <key>StandardErrorPath</key><string>$LOG</string>
</dict>
</plist>
PLIST
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    launchctl bootstrap "gui/$(id -u)" "$PLIST"
    echo "Installed. Unscroll now runs in the background and starts on login."
    echo "Logs: $LOG"
    ;;
  uninstall)
    launchctl bootout "gui/$(id -u)/$LABEL" 2>/dev/null || true
    rm -f "$PLIST"
    echo "Removed."
    ;;
  status)
    launchctl print "gui/$(id -u)/$LABEL" 2>/dev/null | grep -E "state|pid|last exit" || echo "Not installed."
    ;;
  logs)
    tail -n 50 -f "$LOG"
    ;;
  *)
    echo "Usage: $0 install | uninstall | status | logs"
    exit 1
    ;;
esac
