#!/usr/bin/env bash
{
set -Eeuo pipefail

APP_NAME="ccwhatsapp"
DEFAULT_PORT="3007"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
cd "$SCRIPT_DIR"

LOCK_DIR="${SCRIPT_DIR}/.update.lock"
STAGING_DIR="${SCRIPT_DIR}/.deploy-staging"
ROLLBACK_NEXT="${SCRIPT_DIR}/apps/web/.next.rollback"
ROLLBACK_MODULES="${SCRIPT_DIR}/.node_modules.rollback"
ROLLBACK_SUBMODULES="${SCRIPT_DIR}/.submodules.rollback"

LOCK_ACQUIRED=0
SWAP_STARTED=0
STASH_CREATED=0
DEPS_CHANGED=0
MODULES_SWAPPED=0
PREV_GIT_SHA=""
DOWN_START_EPOCH=0

log() {
  printf '%s\n' "$*"
}

acquire_lock() {
  if mkdir "$LOCK_DIR" 2>/dev/null; then
    echo "$$" > "${LOCK_DIR}/pid"
    LOCK_ACQUIRED=1
    return 0
  fi

  local old_pid=""
  if [ -f "${LOCK_DIR}/pid" ]; then
    old_pid="$(cat "${LOCK_DIR}/pid" 2>/dev/null || true)"
  fi
  if [ -n "$old_pid" ] && kill -0 "$old_pid" 2>/dev/null; then
    log "ERROR: Another update process (PID ${old_pid}) is already running."
    exit 1
  fi

  log "NOTE: Removing stale lock from finished update process..."
  rm -rf "$LOCK_DIR"
  mkdir "$LOCK_DIR"
  echo "$$" > "${LOCK_DIR}/pid"
  LOCK_ACQUIRED=1
}

cleanup_on_exit() {
  rm -rf "$STAGING_DIR" 2>/dev/null || true
  if [ "$LOCK_ACQUIRED" -eq 1 ]; then
    rm -rf "$LOCK_DIR" 2>/dev/null || true
  fi
}

preflight_fail_handler() {
  local exit_code=$?
  trap - ERR
  log ""
  log "=================================================="
  log "ERROR: Update pre-flight/staging build failed (exit ${exit_code})."
  log "Live '${APP_NAME}' on port 3007 was NOT stopped or modified."
  log "=================================================="
  cleanup_on_exit
  exit "$exit_code"
}

rollback_live() {
  local exit_code=$?
  trap - ERR
  log ""
  log "=================================================="
  log "WARNING: Swap or health check failed! Rolling back '${APP_NAME}' automatically..."
  log "=================================================="

  pm2 stop "${APP_NAME}" >/dev/null 2>&1 || true

  if [ -n "$PREV_GIT_SHA" ]; then
    git reset --hard "$PREV_GIT_SHA" >/dev/null 2>&1 || true
    if [ "$STASH_CREATED" -eq 1 ]; then
      git stash pop >/dev/null 2>&1 || true
    fi
  fi

  if [ -d "${ROLLBACK_NEXT}" ] && [ -f "${ROLLBACK_NEXT}/BUILD_ID" ]; then
    rm -rf "${SCRIPT_DIR}/apps/web/.next"
    mv "${ROLLBACK_NEXT}" "${SCRIPT_DIR}/apps/web/.next"
  fi

  if [ "$MODULES_SWAPPED" -eq 1 ] && [ -d "${ROLLBACK_MODULES}" ]; then
    rm -rf "${SCRIPT_DIR}/node_modules"
    mv "${ROLLBACK_MODULES}" "${SCRIPT_DIR}/node_modules"
    for dir_prefix in apps packages; do
      if [ -d "${ROLLBACK_SUBMODULES}/${dir_prefix}" ]; then
        for sub_nm in "${ROLLBACK_SUBMODULES}/${dir_prefix}"/*; do
          [ -e "$sub_nm" ] || continue
          pkg_name="$(basename "$sub_nm")"
          rm -rf "${SCRIPT_DIR}/${dir_prefix}/${pkg_name}/node_modules"
          mv "$sub_nm" "${SCRIPT_DIR}/${dir_prefix}/${pkg_name}/node_modules"
        done
      fi
    done
    rm -rf "${ROLLBACK_SUBMODULES}"
  fi

  pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
  if pm2 start ecosystem.config.cjs --update-env >/dev/null 2>&1; then
    pm2 save >/dev/null 2>&1 || true
    log "Rollback complete: previous '${APP_NAME}' build is running again."
  else
    log "CRITICAL: Automatic rollback could not start PM2. Check 'pm2 logs ${APP_NAME}'."
  fi

  cleanup_on_exit
  exit "$exit_code"
}

install_workspace_deps_in() {
  local target_dir="$1"
  (
    cd "$target_dir"
    if [ -d "node_modules" ]; then
      find node_modules apps packages -maxdepth 3 -name ".*-*" -exec rm -rf {} + 2>/dev/null || true
      if [ "$(uname -s)" = "Linux" ] && { ls node_modules/@next/swc-win32-* >/dev/null 2>&1 || { [ -d "node_modules/next" ] && [ ! -f "node_modules/next/package.json" ]; }; }; then
        log "      -> Detected incomplete or cross-platform node_modules; cleaning before install..."
        rm -rf node_modules apps/*/node_modules packages/*/node_modules
      fi
    fi

    if ! NODE_ENV=development npm install --include=dev --no-audit --no-fund --legacy-peer-deps; then
      log "      -> npm install hit a stale directory state (such as ENOTEMPTY). Cleaning node_modules and retrying..."
      rm -rf node_modules apps/*/node_modules packages/*/node_modules
      npm cache verify >/dev/null 2>&1 || true
      if ! NODE_ENV=development npm install --include=dev --no-audit --no-fund --legacy-peer-deps; then
        log "      -> Retrying with fresh package-lock resolution..."
        rm -rf node_modules apps/*/node_modules packages/*/node_modules package-lock.json
        NODE_ENV=development npm install --include=dev --no-audit --no-fund --legacy-peer-deps
      fi
    fi
  )
}

relink_workspace_packages() {
  local base_dir="$1"
  mkdir -p "${base_dir}/node_modules/@cc"
  rm -rf "${base_dir}/node_modules/@cc"/*
  local pkg_dir
  for pkg_dir in "${base_dir}/packages"/*; do
    [ -d "$pkg_dir" ] || continue
    local pkg_name
    pkg_name="$(basename "$pkg_dir")"
    ln -s "../../packages/${pkg_name}" "${base_dir}/node_modules/@cc/${pkg_name}"
  done
}

clone_node_modules_to_staging() {
  if cp -al "${SCRIPT_DIR}/node_modules" "${STAGING_DIR}/node_modules" 2>/dev/null; then
    for parent in apps packages; do
      [ -d "${SCRIPT_DIR}/${parent}" ] || continue
      for pkg_dir in "${SCRIPT_DIR}/${parent}"/*; do
        [ -d "${pkg_dir}/node_modules" ] || continue
        local pkg_name
        pkg_name="$(basename "$pkg_dir")"
        cp -al "${pkg_dir}/node_modules" "${STAGING_DIR}/${parent}/${pkg_name}/node_modules" 2>/dev/null || cp -a "${pkg_dir}/node_modules" "${STAGING_DIR}/${parent}/${pkg_name}/node_modules"
      done
    done
  else
    rm -rf "${STAGING_DIR}/node_modules"
    cp -a "${SCRIPT_DIR}/node_modules" "${STAGING_DIR}/node_modules"
    for parent in apps packages; do
      [ -d "${SCRIPT_DIR}/${parent}" ] || continue
      for pkg_dir in "${SCRIPT_DIR}/${parent}"/*; do
        [ -d "${pkg_dir}/node_modules" ] || continue
        local pkg_name
        pkg_name="$(basename "$pkg_dir")"
        rm -rf "${STAGING_DIR}/${parent}/${pkg_name}/node_modules"
        cp -a "${pkg_dir}/node_modules" "${STAGING_DIR}/${parent}/${pkg_name}/node_modules"
      done
    done
  fi
  relink_workspace_packages "$STAGING_DIR"
}

run_hot_sqlite_backup() {
  mkdir -p backups
  if ! compgen -G "data/*.db" >/dev/null 2>&1; then
    log "[3/7] No existing data/*.db files yet (will initialize automatically on start)."
    return 0
  fi

  local snap_dir="backups/pre-update-$(date +%Y%m%d_%H%M%S)"
  mkdir -p "$snap_dir"

  local node_modules_path="${STAGING_DIR}/node_modules"
  NODE_PATH="$node_modules_path" node -e '
    const fs = require("fs");
    const path = require("path");
    const { createClient } = require("@libsql/client");
    (async () => {
      const snapDir = path.resolve(process.argv[1]);
      const files = fs.readdirSync("data").filter((f) => f.endsWith(".db"));
      for (const f of files) {
        const src = path.resolve("data", f);
        const dest = path.join(snapDir, f);
        let backedUp = false;
        const c = createClient({ url: "file:" + src });
        try {
          await c.execute("PRAGMA busy_timeout = 5000;");
          await c.execute({ sql: "VACUUM INTO ?;", args: [dest] });
          if (fs.existsSync(dest) && fs.statSync(dest).size > 0) {
            backedUp = true;
          }
        } catch {
          try {
            await c.execute("PRAGMA wal_checkpoint(PASSIVE);");
          } catch {}
        } finally {
          try { c.close(); } catch {}
        }
        if (!backedUp) {
          fs.copyFileSync(src, dest);
        }
      }
    })().catch((err) => { console.error(err); process.exit(1); });
  ' "$snap_dir"

  log "[3/7] Online SQLite backup saved to ${snap_dir} (zero server pause)"
  ls -1dt backups/pre-update-* 2>/dev/null | tail -n +6 | xargs -r rm -rf || true
}

wait_for_port_health() {
  local port="$1"
  local attempt=0
  local max_attempts=30
  while [ "$attempt" -lt "$max_attempts" ]; do
    local login_code
    login_code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/login" || echo "000")"
    if [ "$login_code" = "200" ] || [ "$login_code" = "302" ] || [ "$login_code" = "307" ]; then
      local webhook_code
      webhook_code="$(curl -s -o /dev/null -w "%{http_code}" --max-time 2 "http://127.0.0.1:${port}/api/webhooks/whatsapp" || echo "000")"
      if [ "$webhook_code" = "400" ] || [ "$webhook_code" = "403" ] || [ "$webhook_code" = "200" ]; then
        return 0
      fi
    fi
    attempt=$((attempt + 1))
    sleep 1
  done
  return 1
}

for cmd in git node npm pm2 curl tar; do
  if ! command -v "$cmd" >/dev/null 2>&1; then
    log "ERROR: Required command '${cmd}' not found in PATH."
    exit 1
  fi
done

acquire_lock
trap cleanup_on_exit EXIT
trap preflight_fail_handler ERR

log "=================================================="
log "Starting Zero-Downtime-Build Update (${APP_NAME})"
log "Live site stays ONLINE while building in staging."
log "=================================================="

mkdir -p data backups logs

CURRENT_BRANCH="$(git rev-parse --abbrev-ref HEAD 2>/dev/null || echo "master")"
if [ -z "$CURRENT_BRANCH" ] || [ "$CURRENT_BRANCH" = "HEAD" ]; then
  CURRENT_BRANCH="master"
fi
PREV_GIT_SHA="$(git rev-parse HEAD)"

# ------------------------------------------------------------------
# PHASE A: Pull, Install, Hot-Backup & Build in Staging (LIVE IS UP)
# ------------------------------------------------------------------
log "[1/7] Fetching origin/${CURRENT_BRANCH} & preparing staging workspace..."
git fetch origin "$CURRENT_BRANCH"
TARGET_REF="origin/${CURRENT_BRANCH}"

rm -rf "$STAGING_DIR"
mkdir -p "$STAGING_DIR"
git archive "$TARGET_REF" | tar -x -C "$STAGING_DIR"

for env_file in .env .env.production .env.local .env.production.local; do
  if [ -f "${SCRIPT_DIR}/${env_file}" ]; then
    cp "${SCRIPT_DIR}/${env_file}" "${STAGING_DIR}/${env_file}"
  fi
done
if [ -f "${STAGING_DIR}/.env.production" ]; then
  sed -i 's|https://whatsapp\.ccapl\.cc|https://chat.ccapl.cc|g' "${STAGING_DIR}/.env.production" 2>/dev/null || true
fi

log "[2/7] Preparing dependencies inside staging (live node_modules untouched)..."
if [ ! -d "${SCRIPT_DIR}/node_modules/next" ] || [ ! -f "${SCRIPT_DIR}/node_modules/next/package.json" ]; then
  DEPS_CHANGED=1
elif [ "$(uname -s)" = "Linux" ] && ls "${SCRIPT_DIR}"/node_modules/@next/swc-win32-* >/dev/null 2>&1; then
  DEPS_CHANGED=1
elif git diff --name-only "$PREV_GIT_SHA" "$TARGET_REF" | grep -qE '(^|/)(package\.json|package-lock\.json)$'; then
  DEPS_CHANGED=1
fi

if [ "$DEPS_CHANGED" -eq 0 ]; then
  log "      -> Dependencies unchanged; cloning node_modules into staging via hardlinks..."
  clone_node_modules_to_staging
else
  log "      -> Dependencies changed or incomplete; running clean npm install inside staging..."
  install_workspace_deps_in "$STAGING_DIR"
fi

run_hot_sqlite_backup

log "[4/7] Running TypeScript check, lint & Next.js build in staging (live remains online)..."
(
  cd "$STAGING_DIR"
  npm run typecheck
  if node -e "const p=require('./package.json'); process.exit(p.scripts && p.scripts.lint ? 0 : 1)" 2>/dev/null; then
    npm run lint
  fi
  DATABASE_DATA_DIR="${STAGING_DIR}/.build-db" NODE_OPTIONS="--max-old-space-size=1536" npm run build
  rm -rf "${STAGING_DIR}/.build-db"
)

if [ ! -f "${STAGING_DIR}/apps/web/.next/BUILD_ID" ]; then
  log "ERROR: Staging build completed without apps/web/.next/BUILD_ID."
  exit 1
fi
log "      -> Staging build verified! Ready for quick final swap on port 3007."

# ------------------------------------------------------------------
# PHASE B: Fast Swap & Health Check with Auto-Rollback (~2-4s pause)
# ------------------------------------------------------------------
trap - ERR
SWAP_STARTED=1

if [ -f ".env.production" ]; then
  sed -i 's|https://whatsapp\.ccapl\.cc|https://chat.ccapl.cc|g' .env.production 2>/dev/null || true
fi

if [ -n "$(git status --porcelain --untracked-files=no)" ]; then
  git stash push -m "pre-update-$(date +%Y%m%d_%H%M%S)" >/dev/null 2>&1 && STASH_CREATED=1 || true
fi

trap rollback_live ERR

DOWN_START_EPOCH="$(date +%s)"
log "[5/7] Pausing '${APP_NAME}' briefly for final swap..."
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 stop "${APP_NAME}" || true
fi

log "[6/7] Swapping verified build into place & starting '${APP_NAME}'..."
if ! git merge --ff-only "$TARGET_REF" >/dev/null 2>&1; then
  git reset --hard "$TARGET_REF"
fi
chmod +x setup.sh update.sh reset-db.sh 2>/dev/null || true

rm -rf "$ROLLBACK_NEXT"
if [ -d "${SCRIPT_DIR}/apps/web/.next" ]; then
  mv "${SCRIPT_DIR}/apps/web/.next" "$ROLLBACK_NEXT"
fi
mv "${STAGING_DIR}/apps/web/.next" "${SCRIPT_DIR}/apps/web/.next"

if [ "$DEPS_CHANGED" -eq 1 ] && [ -d "${STAGING_DIR}/node_modules" ]; then
  rm -rf "$ROLLBACK_MODULES" "$ROLLBACK_SUBMODULES"
  MODULES_SWAPPED=1
  if [ -d "${SCRIPT_DIR}/node_modules" ]; then
    mv "${SCRIPT_DIR}/node_modules" "$ROLLBACK_MODULES"
  fi
  mv "${STAGING_DIR}/node_modules" "${SCRIPT_DIR}/node_modules"

  mkdir -p "${ROLLBACK_SUBMODULES}/apps" "${ROLLBACK_SUBMODULES}/packages"
  for parent in apps packages; do
    [ -d "${SCRIPT_DIR}/${parent}" ] || continue
    for pkg_dir in "${SCRIPT_DIR}/${parent}"/*; do
      [ -d "$pkg_dir" ] || continue
      pkg_name="$(basename "$pkg_dir")"
      if [ -d "${pkg_dir}/node_modules" ]; then
        mv "${pkg_dir}/node_modules" "${ROLLBACK_SUBMODULES}/${parent}/${pkg_name}"
      fi
      if [ -d "${STAGING_DIR}/${parent}/${pkg_name}/node_modules" ]; then
        mv "${STAGING_DIR}/${parent}/${pkg_name}/node_modules" "${pkg_dir}/node_modules"
      fi
    done
  done
  relink_workspace_packages "$SCRIPT_DIR"
fi

if command -v redis-cli >/dev/null 2>&1 && redis-cli -h 127.0.0.1 -p 6379 ping >/dev/null 2>&1; then
  redis-cli -h 127.0.0.1 -p 6379 -n 1 FLUSHDB ASYNC >/dev/null 2>&1 || true
fi

pm2 flush "${APP_NAME}" >/dev/null 2>&1 || true
if pm2 describe "${APP_NAME}" >/dev/null 2>&1; then
  pm2 delete "${APP_NAME}" >/dev/null 2>&1 || true
fi
pm2 start ecosystem.config.cjs --update-env
pm2 save >/dev/null 2>&1 || true

APP_PORT="$(node -e "console.log(require('./ecosystem.config.cjs').apps[0].env.PORT || '${DEFAULT_PORT}')")"
log "[7/7] Verifying '${APP_NAME}' health on http://127.0.0.1:${APP_PORT}..."

if wait_for_port_health "$APP_PORT"; then
  trap - ERR
  DOWN_END_EPOCH="$(date +%s)"
  DOWN_SECS=$((DOWN_END_EPOCH - DOWN_START_EPOCH))
  rm -rf "$ROLLBACK_NEXT" "$ROLLBACK_MODULES" "$ROLLBACK_SUBMODULES"
  log "=================================================="
  log "SUCCESS: '${APP_NAME}' updated & LIVE on port ${APP_PORT}!"
  log "Total restart window: ~${DOWN_SECS}s (chats, contacts, templates & DB intact)."
  log "=================================================="
else
  log "ERROR: '${APP_NAME}' failed post-restart health check on port ${APP_PORT}."
  pm2 logs "${APP_NAME}" --lines 30 --nostream || true
  false
fi

exit 0
}
