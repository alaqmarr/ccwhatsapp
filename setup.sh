#!/usr/bin/env bash
{
set -euo pipefail

APP_NAME="ccwhatsapp"
DEFAULT_PORT="3007"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=================================================="
echo "Classic Concepts WhatsApp Desk - First-Time Setup"
echo "PM2 Process: ${APP_NAME} | Default Port: ${DEFAULT_PORT}"
echo "=================================================="

# 1. Verify Node.js & npm
if ! command -v node >/dev/null 2>&1; then
  echo "ERROR: Node.js (>= 20) is not installed. Please install Node.js 20/22 LTS first."
  exit 1
fi

NODE_MAJOR="$(node -p "process.versions.node.split('.')[0]")"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "ERROR: Node.js >= 20 is required (found $(node -v))."
  exit 1
fi
echo "[1/7] Node.js $(node -v) & npm $(npm -v) verified."

# 2. Ensure PM2 is installed globally
if ! command -v pm2 >/dev/null 2>&1; then
  echo "[2/7] Installing PM2 globally..."
  npm install -g pm2
else
  echo "[2/7] PM2 $(pm2 -v) already installed."
fi

# 3. Prepare runtime directories (SQLite databases, daily backups, PM2 logs)
mkdir -p data backups logs
chmod +x setup.sh update.sh 2>/dev/null || true
echo "[3/7] Runtime folders ready (./data, ./backups, ./logs)."

# 4. Prepare .env.production if not yet created
if [ ! -f ".env.production" ]; then
  if [ -f ".env.production.example" ]; then
    cp .env.production.example .env.production
    echo "[4/7] Created .env.production from .env.production.example."
    echo "      -> Edit .env.production anytime to add ANTHROPIC_API_KEY or SMTP_*."
  fi
else
  echo "[4/7] Found existing .env.production."
fi

# 5. Check Redis availability (optional; auto-falls back to 100MB in-memory LRU)
if command -v redis-cli >/dev/null 2>&1 && redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  echo "[5/7] Local Redis server is online (using isolated DB /1 for ccwhatsapp)."
else
  echo "[5/7] Local Redis daemon not detected; built-in 100MB in-memory cache will run automatically."
fi

# 6. Install dependencies, typecheck, and build production Next.js bundle
echo "[6/7] Installing workspace dependencies & building Next.js app..."
npm install --no-audit --no-fund
npm run typecheck
rm -rf apps/web/.next
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# 7. Start PM2 process "ccwhatsapp" on port 3007
echo "[7/7] Starting PM2 process '${APP_NAME}'..."
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 delete "${APP_NAME}" || true
fi
pm2 start ecosystem.config.cjs --update-env
pm2 save

APP_PORT="$(node -e "console.log(require('./ecosystem.config.cjs').apps[0].env.PORT || '${DEFAULT_PORT}')")"
echo "Waiting for '${APP_NAME}' to listen on http://127.0.0.1:${APP_PORT}..."
sleep 3

if curl -sSf -L -o /dev/null "http://127.0.0.1:${APP_PORT}/login"; then
  echo "=================================================="
  echo "SUCCESS: '${APP_NAME}' is LIVE on port ${APP_PORT}!"
  echo "Next steps:"
  echo "  1. Point Nginx for whatsapp.ccapl.cc -> http://127.0.0.1:${APP_PORT}"
  echo "     (Set 'proxy_buffering off;' on /api/realtime/stream for live SSE ticks)"
  echo "  2. Open https://whatsapp.ccapl.cc/setup to create your DEV account & connect Meta"
  echo "  3. Run 'pm2 startup' once if not already enabled on boot"
  echo "=================================================="
else
  echo "WARNING: Health check did not immediately return 200. Recent PM2 logs:"
  pm2 logs "${APP_NAME}" --lines 30 --nostream || true
fi

exit 0
}
