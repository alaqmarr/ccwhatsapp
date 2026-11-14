#!/usr/bin/env bash
{
set -e

APP_NAME="ccwhatsapp"
DEFAULT_PORT="3007"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

restart_on_error() {
  if [ -f "node_modules/next/dist/bin/next" ] && [ -f "apps/web/.next/BUILD_ID" ]; then
    echo "WARNING: Update/build failed. Restoring previous PM2 process (${APP_NAME})..."
    pm2 start ecosystem.config.cjs --update-env || pm2 restart "${APP_NAME}" || true
  else
    echo "ERROR: Dependencies or Next.js build not present yet. Run 'bash setup.sh' to complete initial install."
  fi
}
trap restart_on_error ERR

install_workspace_deps() {
  # 1. Remove any orphaned npm atomic-rename temp directories (.next-*, .libsql-*, etc.) that trigger ENOTEMPTY
  if [ -d "node_modules" ]; then
    find node_modules apps packages -maxdepth 3 -name ".*-*" -exec rm -rf {} + 2>/dev/null || true
    if [ "$(uname -s)" = "Linux" ] && { ls node_modules/@next/swc-win32-* >/dev/null 2>&1 || { [ -d "node_modules/next" ] && [ ! -f "node_modules/next/package.json" ]; }; }; then
      echo "      -> Detected incomplete or cross-platform node_modules; cleaning before install..."
      rm -rf node_modules apps/*/node_modules packages/*/node_modules
    fi
  fi

  # 2. Install workspace dependencies (including TypeScript & Tailwind build devDependencies)
  if ! NODE_ENV=development npm install --include=dev --no-audit --no-fund; then
    echo "      -> npm install hit a stale directory state (such as ENOTEMPTY). Cleaning node_modules and retrying..."
    rm -rf node_modules apps/*/node_modules packages/*/node_modules
    npm cache verify >/dev/null 2>&1 || true
    if ! NODE_ENV=development npm install --include=dev --no-audit --no-fund; then
      echo "      -> Retrying with fresh Linux package-lock resolution..."
      rm -rf node_modules apps/*/node_modules packages/*/node_modules package-lock.json
      NODE_ENV=development npm install --include=dev --no-audit --no-fund
    fi
  fi
}

echo "=================================================="
echo "Starting Safe Zero-Data-Loss Update (${APP_NAME})"
echo "=================================================="

mkdir -p data backups logs

# 1. Pull latest code from Git (data/*.db, backups/, and .env.production are gitignored and NEVER overwritten)
echo "[1/7] Pulling latest code from Git..."
if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git stash push -m "pre-update-$(date +%Y%m%d_%H%M%S)" || true
fi
git pull --ff-only || git pull
chmod +x setup.sh update.sh reset-db.sh 2>/dev/null || true

# 2. Install workspace dependencies (auto-recovers from ENOTEMPTY)
echo "[2/7] Installing dependencies..."
install_workspace_deps

# 3. Stop PM2 briefly before checkpointing & backing up live SQLite databases
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  echo "[3/7] Pausing running '${APP_NAME}' process for clean SQLite WAL backup..."
  pm2 stop "${APP_NAME}" || true
else
  echo "[3/7] '${APP_NAME}' is not currently running; proceeding with backup check..."
fi

# 4. Safe WAL-checkpointed backup of all 7 domain SQLite databases (retains latest 5 pre-update snapshots)
if compgen -G "data/*.db" >/dev/null 2>&1; then
  SNAP_DIR="backups/pre-update-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$SNAP_DIR"
  node -e '
    const fs = require("fs");
    const path = require("path");
    const { createClient } = require("@libsql/client");
    (async () => {
      const files = fs.readdirSync("data").filter((f) => f.endsWith(".db"));
      for (const f of files) {
        const src = path.resolve("data", f);
        try {
          const c = createClient({ url: "file:" + src });
          await c.execute("PRAGMA wal_checkpoint(TRUNCATE);");
          c.close();
        } catch {}
        fs.copyFileSync(src, path.join(process.argv[1], f));
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  ' "$SNAP_DIR" || cp data/*.db "$SNAP_DIR/"
  echo "[4/7] Backed up live SQLite databases to ${SNAP_DIR}"
  ls -1dt backups/pre-update-* 2>/dev/null | tail -n +6 | xargs -r rm -rf || true
else
  echo "[4/7] No existing data/*.db files yet (will bootstrap automatically on start)."
fi

# 5. Typecheck & clean production Next.js build
echo "[5/7] Running TypeScript check & clean Next.js build..."
npm run typecheck
rm -rf apps/web/.next
NODE_OPTIONS="--max-old-space-size=1536" npm run build

# 6. Refresh ONLY Redis DB /1 (leaves classicconcepts on DB /0 untouched!)
if command -v redis-cli >/dev/null 2>&1 && redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  echo "[6/7] Flushing stale cache keys in Redis DB /1..."
  redis-cli -h 127.0.0.1 -p 6379 -n 1 FLUSHDB ASYNC >/dev/null 2>&1 || true
else
  echo "[6/7] Skipping Redis CLI flush (in-memory cache resets automatically on restart)."
fi

# 7. Restart PM2 process "ccwhatsapp" on port 3007
trap - ERR
echo "[7/7] Starting fresh PM2 process '${APP_NAME}'..."
pm2 flush "${APP_NAME}" >/dev/null 2>&1 || true
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 delete "${APP_NAME}" || true
fi
pm2 start ecosystem.config.cjs --update-env
pm2 save

APP_PORT="$(node -e "console.log(require('./ecosystem.config.cjs').apps[0].env.PORT || '${DEFAULT_PORT}')")"
echo "Verifying '${APP_NAME}' health on http://127.0.0.1:${APP_PORT}..."
sleep 3

if curl -sSf -L -o /dev/null "http://127.0.0.1:${APP_PORT}/login"; then
  echo "=================================================="
  echo "SUCCESS: '${APP_NAME}' updated & live on port ${APP_PORT} (all chats, contacts, templates & settings retained)!"
  echo "=================================================="
else
  echo "WARNING: Health check did not immediately return 200. Recent PM2 logs:"
  pm2 logs "${APP_NAME}" --lines 30 --nostream || true
fi

exit 0
}
