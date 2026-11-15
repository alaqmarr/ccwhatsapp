#!/usr/bin/env bash
{
set -e

APP_NAME="ccwhatsapp"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

echo "=========================================================="
echo "Classic Concepts WhatsApp Desk - Reset ALL 7 Databases"
echo "Target Folder: ${SCRIPT_DIR}/data"
echo "=========================================================="

mkdir -p data backups logs

# 1. Stop PM2 process so no open file handles remain on SQLite WAL files
if command -v pm2 >/dev/null 2>&1 && pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  echo "[1/6] Stopping PM2 process '${APP_NAME}'..."
  pm2 stop "${APP_NAME}" || true
else
  echo "[1/6] PM2 process '${APP_NAME}' is not running; continuing..."
fi

# 2. Archive previous SQLite files to backups/pre-reset-* just in case
if compgen -G "data/*.db" >/dev/null 2>&1; then
  ARCHIVE_DIR="backups/pre-reset-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$ARCHIVE_DIR"
  cp -f data/*.db "$ARCHIVE_DIR/" 2>/dev/null || true
  echo "[2/6] Archived old database files to ${ARCHIVE_DIR}"
else
  echo "[2/6] No previous data/*.db files found to archive."
fi

# 3. Delete ALL 7 SQLite databases + WAL/SHM/journal files
echo "[3/6] Deleting all SQLite databases in ./data (core_auth, conversations, contacts, crm_orders, marketing, billing_ops, queue_jobs)..."
rm -f data/*.db data/*.db-wal data/*.db-shm data/*.db-journal

# 4. Flush isolated Redis cache DB /1 (leaves DB /0 untouched)
if command -v redis-cli >/dev/null 2>&1 && redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  echo "[4/6] Flushing Redis cache DB /1..."
  redis-cli -h 127.0.0.1 -p 6379 -n 1 FLUSHDB >/dev/null 2>&1 || true
else
  echo "[4/6] Redis CLI not active; skipping Redis DB /1 flush."
fi

# 5. Re-initialize fresh production schemas with ZERO dummy data (SEED_DEMO_DATA=0)
if [ -f "node_modules/.bin/tsx" ]; then
  echo "[5/6] Bootstrapping fresh empty schemas across all 7 databases (SEED_DEMO_DATA=0)..."
  set -a
  [ -f ".env" ] && . ./.env
  [ -f ".env.production" ] && . ./.env.production
  set +a
  SEED_DEMO_DATA=0 ./node_modules/.bin/tsx -e '
    import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "./packages/database/src/index.ts";
    (async () => {
      await ensureDatabasesBootstrapped();
      const checks = [
        ["core_auth.db -> users", getRawLibSqlClient("core_auth"), "SELECT COUNT(*) AS c FROM users"],
        ["conversations.db -> conversations", getRawLibSqlClient("conversations"), "SELECT COUNT(*) AS c FROM conversations"],
        ["conversations.db -> messages", getRawLibSqlClient("conversations"), "SELECT COUNT(*) AS c FROM messages"],
        ["contacts.db -> contacts", getRawLibSqlClient("contacts"), "SELECT COUNT(*) AS c FROM contacts"],
        ["crm_orders.db -> customers", getRawLibSqlClient("crm_orders"), "SELECT COUNT(*) AS c FROM customers"],
        ["crm_orders.db -> customer_orders", getRawLibSqlClient("crm_orders"), "SELECT COUNT(*) AS c FROM customer_orders"],
        ["crm_orders.db -> order_trackings", getRawLibSqlClient("crm_orders"), "SELECT COUNT(*) AS c FROM order_trackings"],
        ["marketing.db -> broadcasts", getRawLibSqlClient("marketing"), "SELECT COUNT(*) AS c FROM broadcasts"],
        ["billing_ops.db -> message_billing_ledger", getRawLibSqlClient("billing_ops"), "SELECT COUNT(*) AS c FROM message_billing_ledger"],
        ["queue_jobs.db -> jobs", getRawLibSqlClient("queue_jobs"), "SELECT COUNT(*) AS c FROM jobs"],
      ] as const;
      for (const [label, client, sql] of checks) {
        const res = await client.execute(sql);
        console.log(`      -> ${label}: ${Number(res.rows[0]?.c || 0)} rows`);
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  '
else
  echo "[5/6] Clean schemas will initialize automatically when '${APP_NAME}' starts."
fi

# 6. Rebuild / Restart PM2 if Next.js build exists
if command -v pm2 >/dev/null 2>&1 && [ -f "apps/web/.next/BUILD_ID" ]; then
  echo "[6/6] Restarting PM2 process '${APP_NAME}' with clean databases..."
  if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
    pm2 delete "${APP_NAME}" || true
  fi
  SEED_DEMO_DATA=0 pm2 start ecosystem.config.cjs --update-env
  pm2 save
else
  echo "[6/6] Databases reset complete. Run 'bash update.sh' to build and start PM2."
fi

echo "=========================================================="
echo "ALL 7 DATABASES RESET COMPLETE (0 DUMMY RECORDS)"
echo "Next step: Open https://chat.ccapl.cc/setup to create"
echo "your real DEV owner account."
echo "=========================================================="
exit 0
}
