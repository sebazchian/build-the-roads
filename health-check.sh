#!/bin/bash
# build-the-roads health check + auto-restart
# Run via cron every 5 minutes

NODE_PID=$(pgrep -f "node.*server\.js" | head -1)
CF_PID=$(pgrep -f "cloudflared tunnel" | head -1)
LOG_FILE="/home/sebastian/.openclaw/workspace/mytwosats/auto-restart.log"

# Check Node.js server
if ! curl -fsS http://127.0.0.1:3005/api/health >/dev/null 2>&1; then
  echo "$(date): Server down. Restarting..." >> "$LOG_FILE"
  [ -n "$NODE_PID" ] && kill "$NODE_PID" 2>/dev/null
  sleep 2
  cd /home/sebastian/.openclaw/workspace/mytwosats && nohup node server.js > server.log 2>&1 &
  echo "$(date): Server restarted, PID $!" >> "$LOG_FILE"
fi

# Check Cloudflare tunnel
if [ -z "$CF_PID" ]; then
  echo "$(date): Cloudflared down. Restarting..." >> "$LOG_FILE"
  cloudflared tunnel --config /home/sebastian/.cloudflared/config.yml run > /dev/null 2>&1 &
  echo "$(date): Cloudflared restarted, PID $!" >> "$LOG_FILE"
fi
