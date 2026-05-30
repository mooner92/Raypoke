#!/bin/bash
# ──────────────────────────────────────────────────────────────────────────────
# PokeBOT health check — verifies the /health endpoint and reports status.
# Intended for cron monitoring. Exit code 0 = healthy, 1 = unhealthy.
#
# Usage:  bash scripts/health-check.sh [URL]
#   URL defaults to http://localhost:3000/health
# Optional: set WEBHOOK_URL to receive a POST alert on failure.
# ──────────────────────────────────────────────────────────────────────────────
set -uo pipefail

URL="${1:-http://localhost:3000/health}"
TIMESTAMP="$(date -u +%Y-%m-%dT%H:%M:%SZ)"

response="$(curl -fsS --max-time 10 "$URL" 2>/dev/null)"
status=$?

if [ $status -eq 0 ] && echo "$response" | grep -q '"status":"ok"'; then
  echo "[$TIMESTAMP] OK — $response"
  exit 0
fi

echo "[$TIMESTAMP] UNHEALTHY — curl exit=$status response=${response:-<none>}" >&2

if [ -n "${WEBHOOK_URL:-}" ]; then
  curl -fsS -X POST "$WEBHOOK_URL" \
    -H 'Content-Type: application/json' \
    -d "{\"text\":\"🚨 PokeBOT unhealthy at $TIMESTAMP ($URL)\"}" >/dev/null 2>&1 || true
fi

exit 1
