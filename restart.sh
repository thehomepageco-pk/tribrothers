#!/bin/zsh
set -e
cd "$(dirname "$0")"
echo "Stopping anything on :3001..."
lsof -tiTCP:3001 -sTCP:LISTEN 2>/dev/null | xargs kill -9 2>/dev/null || true
sleep 1
if ! nc -z 127.0.0.1 27017 2>/dev/null; then
  echo "MongoDB not running on 27017 — start it first (brew services start mongodb-community)"
  exit 1
fi
echo "Starting Tri Brothers..."
nohup node server.js >> /tmp/tri-server.log 2>&1 &
echo $! > /tmp/tri-server.pid
sleep 2
if curl -sf http://localhost:3001/health >/dev/null; then
  echo "OK → http://localhost:3001  (pid $(cat /tmp/tri-server.pid))"
  curl -s http://localhost:3001/health
  echo
else
  echo "FAILED — last log lines:"
  tail -40 /tmp/tri-server.log
  exit 1
fi
