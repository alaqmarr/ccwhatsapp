# Classic Concepts WhatsApp Hub (`ccwhatsapp`) Full-App Audit & Performance Report

**Audit Date:** 2026-11-18  
**Target Codebase:** `C:\Users\DELL\Downloads\ccwhatsapp` (`HEAD` at `8417e3b`)  
**Tooling Baseline at Audit Time:** `npm run typecheck` passes (`exit 0`); `npm run lint` fails with 9 pre-existing em-dash violations across 7 files.

## 1. Executive Summary

`ccwhatsapp` has a solid transactional and real-time foundation in its recently refactored core (`better-sqlite3` with WAL mode and `BEGIN IMMEDIATE` writes, `next.config.ts` package import optimization, single-connection browser `EventSource` multiplexing, and `/dashboard/inbox` streaming via `<Suspense>`, TanStack Query, Zustand, and TanStack Virtual).

However, a full-stack audit across databases, API routes, background workers, storage/AI logs, caching, and UI routes uncovered **4 critical security/correctness/leak bugs**, **12 high-impact performance bottlenecks**, and **significant monolith bloat** outside the inbox route:

1. **Unauthenticated SSE Stream & Leak (`P0`):** `GET /api/realtime/stream` does not check `getCurrentUser()`, exposing live internal events (`message:new`, `staff:mention`, `note:new`) to unauthenticated callers and leaking intervals/listeners on abrupt disconnects.
2. **Header-Spoofable Internal Endpoint (`P0`):** `POST /api/internal/ai-logs` falls back to checking `host` and `x-forwarded-for` headers when `x-cc-bridge-key` is absent, which can be bypassed behind reverse proxies or with spoofed headers.
3. **Unbounded In-Memory Sets/Maps (`P0`):** Worker deduplication sets (`claimedInboundWaIds`, `processedAutomationWaIds`) and per-conversation sequence maps (`inboundTurnSeqMap`) grow without bounds or TTL eviction across process uptime.
4. **Synchronous 3.28 MB Text Log Parsing (`P1`):** `ai.logs` is already **3,280.0 KB (19,914 lines)** and is read/parsed synchronously via `fs.readFileSync` on `/dashboard/analytics`, `/dashboard/ai-logs`, and duplicate-checked on writes.
5. **18 of 19 Dashboard Routes Block on SSR (`P1`):** Only `/dashboard/inbox` uses `<Suspense>` streaming and `next/dynamic`; the remaining 18 routes block HTML streaming on multi-DB loaders and ship monolithic client components (up to 2,783 lines in `TemplatesClient.tsx` and 2,634 lines in `ContactsClient.tsx`).
6. **Missing Database Indexes & Full-Table JS Aggregations (`P1`):** `billing_ops.db` has zero custom indexes, `core_auth.db` has no `sessions(expires_at)` index or expired-session cleanup, `crm_orders.db` lacks phone/customer indexes on `customer_orders` and `customer_relations`, and `analytics.ts` / `crm.ts` pull full tables into Node memory to filter and aggregate in JavaScript.

## 2. Verified Architectural Strengths (Preserve These Patterns)

Before optimizing other modules, preserve and replicate the following patterns already proven in the codebase:

* **SQLite Concurrency & Prepared Statement Shim (`packages/database/src/bootstrap.ts:50-69`, `packages/database/src/sqlite-compat.ts`):** WAL mode, `synchronous = NORMAL`, `busy_timeout = 5000`, `foreign_keys = ON`, `temp_store = MEMORY`, and immediate write transactions via `better-sqlite3`.
* **Build & Package Tuning (`apps/web/next.config.ts:46-75`):** `compress: true`, `experimental.optimizePackageImports: ["lucide-react"]`, and `serverExternalPackages: ["better-sqlite3", "@libsql/client", "nodemailer", "ioredis"]`.
* **Shared Tab-Level SSE Client (`apps/web/src/lib/realtime-client.ts:12-92`):** Singleton `EventSource` hub per browser tab with reference-counted event listeners, avoiding HTTP/1.1 6-connection browser pool exhaustion across dashboard widgets.
* **Inbox Server Streaming & Virtualization (`apps/web/src/app/dashboard/inbox/page.tsx`, `InboxClient.tsx`):** `<Suspense>` streaming boundary, `next/dynamic` modal/popover splitting, Zustand UI store, TanStack Query cursor-paginated timeline, and TanStack Virtual scrolling.

## 3. Critical Bugs, Security Gaps & Memory Leaks (Priority P0)

### 3.1 Unauthenticated Real-Time SSE Stream & Timer/Listener Leak
* **Location:** `apps/web/src/app/api/realtime/stream/route.ts:6-48`
* **Observed Behavior:**
  * `GET()` invokes `ensureBackgroundWorkersRunning()` and immediately subscribes the response stream to `socketHub.subscribe(...)` without calling `getCurrentUser()` or verifying session/account status. Any unauthenticated client reaching `/api/realtime/stream` receives real-time internal events (`message:new`, `note:new`, `staff:mention`, `ai:log`, `broadcast:progress`).
  * `keepAliveTimer = setInterval(..., 20000)` (line 35) only clears inside `ReadableStream.cancel()`. Inside `send()` (lines 14-23) and the keep-alive callback (lines 36-40), closed/errored stream exceptions are caught and ignored without calling `unsubscribe()` or `clearInterval(keepAliveTimer)`. Additionally, `req.signal` is not bound to abort cleanup.
* **Impact:** Data exposure on public hosts, leaked closures/timers inside Node memory, and dead listeners accumulated inside `socketHub.listeners` (`packages/sockets/src/index.ts:33`).
* **Recommended Fix:**
  1. Require an active authenticated staff user (`const user = await getCurrentUser(); if (!user || user.status !== "ACTIVE") return NextResponse.json({ error: "Unauthorized" }, { status: 401 });`) and filter user-private events (like `staff:mention`) by `user.id`.
  2. Accept `req: Request`, extract a unified idempotent `cleanup()` helper that runs `unsubscribe()`, `clearInterval(keepAliveTimer)`, and `cleanup()` on `req.signal.addEventListener("abort", cleanup)` as well as on any `controller.enqueue` error.

### 3.2 Header-Trust Fallback in Internal AI Logs Endpoint
* **Location:** `apps/web/src/app/api/internal/ai-logs/route.ts:11-36`
* **Observed Behavior:** `isAuthorizedInternalCaller(req)` allows requests without a valid `x-cc-bridge-key` whenever `host` starts with `127.0.0.1`, `localhost`, or `[::1]` and `x-forwarded-for` is empty or starts with `127.0.0.1` / `::1` / `localhost`.
* **Impact:** If the production reverse proxy rewrites `Host` to the upstream `127.0.0.1:3007` (common Nginx default) and strips/rewrites `X-Forwarded-For`, external requests can satisfy `isLocalHost && isLocalFwd` and inject arbitrary AI log entries into `ai.logs` and `socketHub`.
* **Recommended Fix:** Always require `x-cc-bridge-key` using a constant-time comparison (`crypto.timingSafeEqual`) against `resolveEcosystemBridgeKey()`, even in local calls, or gate the localhost fallback strictly behind `NODE_ENV !== "production"`.

### 3.3 Unbounded In-Process `Set` and `Map` Growth in Workers
* **Location:** `packages/workers/src/index.ts:456-457, 464-484, 898-915`
* **Observed Behavior:**
  * `claimedInboundWaIds = new Set<string>()` (line 456) and `processedAutomationWaIds = new Set<string>()` (line 457) insert every inbound WhatsApp `wamid.*` and never prune or cap entries.
  * `inboundTurnSeqMap` (`globalThis.__ccInboundSeqMap`, line 898) stores a sequence number per `conversationId` permanently in process memory.
  * Similarly, `orgReportCache` and `orgIdentityCache` in `packages/connections/src/anthropic-usage-spend.ts:145-146` keep cached keys in module `Map`s without a max-size bound.
* **Impact:** Monotonic heap growth in long-running PM2/Node processes over weeks of webhook traffic. Note also that `claimedInboundWaIds` only protects one Node worker process (SQLite `wa_message_id` check provides cross-process protection, though `messages.wa_message_id` is non-unique in schema).
* **Recommended Fix:**
  * Wrap `claimedInboundWaIds` / `processedAutomationWaIds` / `inboundTurnSeqMap` in bounded ring buffers or TTL caches (e.g., max 10,000 entries or 15-minute TTL pruning).
  * Enforce a partial `UNIQUE` index on `messages(wa_message_id) WHERE wa_message_id IS NOT NULL` so webhook idempotency holds atomically across processes without needing unbounded RAM sets.

### 3.4 Non-Promoted Cache & Full-Clear Invalidations in `sqlite-compat.ts`
* **Location:** `packages/database/src/sqlite-compat.ts:117-161, 265-302`
* **Observed Behavior:**
  * `getPrepared()` (lines 119-130) checks `stmtCache.get(sql)`. On cache hit, it returns `stmt` directly without deleting and re-inserting the key, making eviction FIFO instead of true LRU. Frequently used hot queries can get evicted when the 256-entry cap fills.
  * `DDL_INVALIDATION_RE.test(trimmed)` (line 152), multi-statement `db.exec(trimmed)` (line 159), `executeMultiple` (lines 268, 301) call `stmtCache.clear()`, wiping all 256 compiled SQLite statements across the connection.
* **Recommended Fix:** Re-insert on `stmtCache.get(sql)` hit (`stmtCache.delete(sql); stmtCache.set(sql, stmt);`), raise cap to 512 statements, and avoid triggering `DDL_INVALIDATION_RE` during steady-state request traffic by ensuring bootstrap runs strictly once at process startup.

## 4. Database Footprint, Missing Indexes & Query Bottlenecks (Priority P1)

### 4.1 Observed Local Database Snapshot (`data/*.db`)

| Database File | Disk Size | Key Row Counts | Current Custom Indexes | Gap Summary |
| :--- | :--- | :--- | :--- | :--- |
| `conversations.db` | 680.0 KB | `conversations`: 69, `messages`: 219, `custom_links`: 411, `conversation_assignments`: 86, `staff_notifications`: 23 | 18 indexes (`conversations`, `messages`, `conversation_assignments`, `call_dispatch_queue`, `lead_forwards`, `staff_notifications`, `staff_quick_replies`, `ai_training_examples`) | `custom_links` has `411` rows without index on `LOWER(code)` or `product_slug`. |
| `crm_orders.db` | 112.0 KB | `ecosystem_enquiries`: 12, `customers`: 7, `customer_relations`: 5, `customer_orders`: 4 | 6 indexes (`ecosystem_enquiries`, `order_trackings`) | Zero indexes on `customer_orders(customer_phone)`, `customer_orders(customer_id)`, `customer_orders(ordered_at)`, `customer_relations(customer_phone)`, or `customers(opt_in_marketing)`. |
| `marketing.db` | 72.0 KB | `broadcasts`: 8, `broadcast_recipients`: 9, `templates`: 9, `marketing_lists`: 2 | 2 indexes (`broadcast_recipients`) | `broadcasts(status, next_dispatch_at)` polled every 2s lacks an index; `templates(approval_status)` lacks an index. |
| `contacts.db` | 68.0 KB | `contacts`: 75, `contact_groups`: 4, `contact_import_logs`: 1 | 3 indexes (`contacts`) | Good coverage on `stage`, `updated_at`, `city`; missing partial/email index if email search scales. |
| `core_auth.db` | 68.0 KB | `users`: 1, `sessions`: 2, `email_dispatch_logs`: 4, `setup_state`: 2 | 2 indexes (`email_change_requests`, `email_dispatch_logs`) | Missing indexes on `sessions(user_id)`, `sessions(expires_at)`, `users(status)`; expired sessions are never pruned. |
| `billing_ops.db` | 52.0 KB | `message_billing_ledger`: 84, `backup_settings`: 1, `pricing_config`: 1, `backup_logs`: 1 | **NONE (0 custom indexes)** | Missing indexes on `message_billing_ledger(billed_at DESC)`, `(conversation_id)`, `(broadcast_id)`. |
| `queue_jobs.db` | 28.0 KB | `jobs`: 1, `worker_heartbeats`: 2 | 2 indexes (`jobs`) | Well indexed (`queue_name, status, run_after` and `status, created_at`). |

Note: File sizes are currently small (`~1.08 MB` total DB footprint), so sequential scans hide today. Because `ccwhatsapp` is designed for high message volume, these missing indexes and full-table JS loops become quadratic latency cliffs as rows reach 10k to 100k+.

### 4.2 High-Priority Missing Indexes & Auth Session Hygiene
* **Locations:** `packages/database/src/bootstrap.ts:71-118, 484-525, 691-755` and `packages/auth/src/index.ts:541-612`
* **Issues:**
  * `billing_ops.db` has **zero non-auto indexes**. Queries filtering `message_billing_ledger WHERE billed_at >= ?` (`apps/web/src/lib/loaders/analytics.ts:152-156`) always perform full table scans.
  * `core_auth.db` checks `sessions WHERE token = ? AND expires_at > ?` (`packages/auth/src/index.ts:588`) on every authenticated page/API request (good that `token` has a `UNIQUE` index, but expired rows are never purged unless a user logs out or gets rejected/suspended).
  * `crm_orders.db` executes `SELECT * FROM customer_orders WHERE customer_phone = ? ORDER BY ordered_at DESC` (`apps/web/src/app/api/contacts/route.ts:87`, `apps/web/src/app/api/conversations/[id]/route.ts:150`) and `SELECT * FROM customer_relations WHERE customer_phone = ?` without any index on `customer_phone` or `ordered_at`.
  * `packages/storage/src/index.ts:171-184` resolves shortlinks on public `ccapl.cc/{code}` traffic via `LOWER(code) = LOWER(?)` and `OR LOWER(target_url) LIKE LOWER('%/' || code || '%')`, forcing a full scan across `custom_links` whenever an exact match misses.
* **Recommended Fix:**
  1. Add indexes in `bootstrap.ts`:
     * `billing_ops`: `idx_ledger_billed_at ON message_billing_ledger (billed_at DESC)`, `idx_ledger_conv ON message_billing_ledger (conversation_id)`
     * `crm_orders`: `idx_cust_orders_phone_date ON customer_orders (customer_phone, ordered_at DESC)`, `idx_cust_rel_phone_date ON customer_relations (customer_phone, occurred_at DESC)`, `idx_customers_optin ON customers (opt_in_marketing, lifetime_value_inr DESC)`
     * `marketing`: `idx_broadcasts_queue ON broadcasts (status, next_dispatch_at, created_at)`
     * `core_auth`: `idx_sessions_user ON sessions (user_id)`, `idx_sessions_exp ON sessions (expires_at)`, `idx_users_status ON users (status)`
     * `conversations`: `idx_custom_links_code_nocase ON custom_links (code COLLATE NOCASE)`, `idx_custom_links_slug ON custom_links (product_slug COLLATE NOCASE)`
  2. Add periodic cleanup of `DELETE FROM sessions WHERE expires_at <= ?` inside `pruneOldJobs()` (`packages/workers/src/index.ts:5224`).

### 4.3 Analytics Loader Runs Escalations Synchronously & Pulls Full Tables Into JS
* **Location:** `apps/web/src/lib/loaders/analytics.ts:50-165`
* **Observed Behavior:**
  * Every `/dashboard/analytics` page load and `GET /api/analytics` request starts by calling `await checkAndEscalateWaitingChats()` (line 59), mixing a mutating background cron write into a read-only GET request path.
  * Fires 12 parallel queries pulling entire tables into Node RAM: `SELECT * FROM conversations ORDER BY last_message_at DESC` (line 108, all rows and all columns including `tags_json`, `resolution_summary`, `collaborators_json`), unbounded `SELECT ... FROM messages WHERE created_at >= ?` (line 110), unbounded `SELECT * FROM conversation_assignments` (line 117), and unbounded `SELECT ... FROM customers` (line 129), then computes rollups in JavaScript loops.
  * Additionally pulls full `ai.logs` text parsing via `readAiTraceLogs()` later in the analytics loader.
* **Recommended Fix:**
  * Remove `checkAndEscalateWaitingChats()` from `loadAnalyticsPayload` (the 15s background worker already handles escalations).
  * Move counts, daily buckets, SLA averages, and billing revenue totals into SQL `COUNT(*)`, `SUM(...)`, and `GROUP BY strftime('%Y-%m-%d', ...)` queries instead of transferring thousands of raw rows into Node memory.

### 4.4 Contacts Loader Performs 4 Full-Table Queries & Filters in JavaScript
* **Location:** `apps/web/src/lib/loaders/crm.ts:65-96` and `apps/web/src/app/api/contacts/route.ts:516-517`
* **Observed Behavior:**
  * `loadContactsPayload` reads `SELECT * FROM contacts ORDER BY updated_at DESC` (line 76), `SELECT id, customer_phone, ... FROM conversations` (all rows, line 80), an unbounded `LEFT JOIN messages ... GROUP BY c.customer_phone` (lines 84-87), and `SELECT customer_phone, COUNT(*), SUM(...) FROM customer_orders GROUP BY customer_phone` (lines 91-93) before applying search, stage, tag, opt-in, or pagination in Node memory.
  * `apps/web/src/app/api/contacts/route.ts:516-517` executes `SELECT * FROM conversations` and `SELECT * FROM customers`.
* **Recommended Fix:** Push `WHERE stage = ?`, `opt_in_marketing = ?`, `LIKE ?`, `LIMIT ? OFFSET ?` into `contacts.db` first to retrieve only the current page (e.g., 50 phone numbers), then query `conversations`, message counts, and `customer_orders` only for `WHERE customer_phone IN (...)`.

### 4.5 Correlated Scalar Subqueries in Conversation List API
* **Location:** `apps/web/src/app/api/conversations/route.ts:82-109`
* **Observed Behavior:** For every row matching `WHERE`, if `c.last_message_direction` is null, SQLite evaluates two separate correlated subqueries against `messages` (`resolved_last_dir` and `resolved_last_status`).
* **Recommended Fix:** Ensure `last_message_direction` and `last_message_status` are always populated atomically on every message insert/status update and drop the correlated fallback subqueries from the hot read path.

## 5. Backend, Caching, Worker & File I/O Bottlenecks (Priority P1 / P2)

### 5.1 Synchronous Full-File `ai.logs` Reads & Duplicate Checks (3.28 MB Today)
* **Location:** `packages/database/src/ai-logger.ts:248-445`
* **Measured Impact:** `ai.logs` is currently **3,280.0 KB (19,914 lines)**.
* **Observed Behavior:**
  * `appendAiTraceLog()` (lines 269-277): When `input.id` is provided, it synchronously calls `fs.readFileSync(filePath, "utf8")` on the entire 3.28 MB file to check `existingRaw.includes('"id":"' + entry.id + '"')` before calling `fs.appendFileSync`.
  * `readAiTraceLogs()` (lines 379-397): Always runs `syncSiblingWebsiteAiLogs()` (lines 308-344), which synchronously reads the entire master `ai.logs` AND sibling website `ai.logs` files into strings, parses every `META_JSON: ` line, appends missing blocks synchronously, and then re-reads and re-parses the entire 3.28 MB master file with `split(/\r?\n/)` + `JSON.parse` on every single entry, sorted in memory, even if the caller only asked for `limit: 50`.
* **Impact:** Blocks the Node.js event loop for tens/hundreds of milliseconds on every AI trace log view, analytics page load, or cross-site log sync, and gets linearly worse up to the log rotation cap.
* **Recommended Fix:**
  1. Store structured AI traces in SQLite (e.g., a dedicated `ai_trace_logs` table with `id TEXT PRIMARY KEY`, `website`, `outcome_source`, `timestamp_utc`, `input_tokens`, `output_tokens` + SQL indexes) and use `INSERT OR IGNORE` for idempotency instead of scanning a 3 MB+ text file.
  2. Keep `ai.logs` strictly as an optional append-only debug stream via `fs.promises.appendFile` (never read synchronously on HTTP request threads), and track seen IDs with a bounded ring Set in memory + SQLite primary key.

### 5.2 Media Proxy Uses Blocking Sync File I/O, RAM Buffering, and Uncached PDF Rebuilds
* **Location:** `apps/web/src/app/api/media/[id]/route.ts:72-422`
* **Observed Behavior:**
  * `renderBuiltinCataloguePdf(mediaId)` (lines 72-123+): Dynamically builds PDF byte buffers from `getCachedEcosystemCatalog()` on every request without caching the resulting `Buffer` by `(mediaId, catalogVersion)`.
  * Local file reads (lines 246-247) and local Meta media disk caching (lines 392-413) use blocking synchronous APIs (`fs.existsSync`, `fs.readFileSync`, `fs.mkdirSync`, `fs.writeFileSync`).
  * Proxy downloads from Meta CDN (lines 389-422) buffer the entire payload in Node memory (`await cdnRes.arrayBuffer()` + `Buffer.from(arrayBuf)`) before sending bytes to the browser.
* **Impact:** Concurrent image/PDF/video loads block the event loop and spike RSS memory with duplicate Buffers.
* **Recommended Fix:**
  * Switch disk reads/writes to `fs.promises` (`readFile`, `writeFile`, `mkdir`).
  * Cache generated built-in catalogue PDF buffers in memory (invalidated alongside `"cc-products"` / `"ce53-machines"` cache tags) and add strong `ETag` / `304 Not Modified` support.
  * Stream CDN responses to the client (`TransformStream` / tee) while writing to disk asynchronously, or redirect to signed local URLs when cached.

### 5.3 Sequential Database Roundtrips in WhatsApp Webhook POST
* **Location:** `apps/web/src/app/api/webhooks/whatsapp/route.ts:41-539`
* **Observed Behavior:**
  * Runs `await ensureDatabasesBootstrapped()` and `await getSetupStatus()` on every webhook POST before signature verification (`lines 42-45`).
  * Inside `for (const msg of val?.messages || [])` (`lines 130-493`), each message performs sequential `await`s: `claimInboundWaMessageId` -> `SELECT customers` -> conditional `INSERT customers` -> `await upsertSyncedContact` -> `SELECT conversations` -> `INSERT`/`UPDATE conversations` -> optional `logConversationAssignment` -> `await markPriorOutboundMessagesRead` -> optional quoted `SELECT messages` -> message insert.
  * Inside `for (const st of val?.statuses || [])` (`lines 496-535`), each status receipt calls `await applyWhatsAppMessageReceipt(...)` sequentially in series.
* **Impact:** Meta expects webhook endpoints to return `200 OK` within seconds; burst batches of status receipts (`SENT`/`DELIVERED`/`READ`) or inbound messages multiply latency linearly.
* **Recommended Fix:**
  * Cache `metaAppSecret` in memory so HMAC signature verification happens immediately without DB setup checks.
  * Consolidate per-message DB writes into a single `conv.transaction("immediate")` and run `upsertSyncedContact` / `crm` customer upsert concurrently (`Promise.all`) or inside the post-response worker.
  * Batch receipt updates or process `val?.statuses` after returning `200 OK` / with `Promise.all` grouped by message ID.

### 5.4 In-Process Polling Workers on Every Web Request Context
* **Location:** `packages/workers/src/index.ts:5160-5221` and `apps/web/src/lib/session.ts:11-29`
* **Observed Behavior:**
  * `getCurrentUser()`, `getCachedSetupStatus()`, `getAppBootContext()`, and `GET /api/realtime/stream` all call `ensureBackgroundWorkersRunning()`.
  * Once started inside the Next.js server process, 4 perpetual `setInterval` timers run forever even when idle:
    1. `processMarketingBroadcastQueue()` every **2,000 ms** (`bootstrap`/`settings`/update `SCHEDULED`/select active `broadcasts` queries every 2s). Note `processMarketingBroadcastQueue` processes at most 1 recipient (`LIMIT 1`, line 4135) per active campaign per tick.
    2. `drainPendingWorkerJobs()` every **6,000 ms**.
    3. `checkAndEscalateWaitingChats()` every **15,000 ms** (`waitingRes` `NOT EXISTS` correlated check + `teams` + `team_members` + `GROUP BY assigned_staff_id` + `auth.users`).
    4. `backup_settings` + `worker_heartbeats` upsert every **30,000 ms**.
* **Impact:** Continuous background SQLite reads/writes on an idle server, AND if Next.js is ever scaled to > 1 worker process (e.g., PM2 cluster mode), multiple processes run competing 2s/6s/15s pollers against the same SQLite files without leader election.
* **Recommended Fix:**
  * Use an adaptive backoff timer (or trigger `processMarketingBroadcastQueue` immediately on broadcast enqueue/progress, sleeping longer e.g. 30s when zero broadcasts are `SCHEDULED`/`QUEUED`/`SENDING`).
  * Call `.unref()` on background timers so graceful shutdown does not hang, or run workers in a dedicated single PM2 worker process (`WORKER_ROLE=runner`) instead of inside SSR/API handlers.

### 5.5 Cache Stampede Risk, Redis Retry Config & External Fetch Timeouts
* **Redis Cache (`packages/storage/src/redis-cache.ts:79-115, 198-236`):**
  * Sets `lazyConnect: true`, `enableOfflineQueue: false`, `maxRetriesPerRequest: 0`, `connectTimeout: 450`, `commandTimeout: 800`, and reconnects indefinitely (`retryStrategy: Math.min(times * 5000, 30000)`). When Redis is not running locally, the cache still maintains a 100 MB per-process `Map` storing stringified JSON (`memoryStore`). Note `rememberWhatsAppCacheWithMeta` runs `JSON.parse(entry.json)` on every `HIT_MEMORY` read (line 171), paying JSON parse CPU overhead on every cache hit.
  * **Suggestion:** Cache parsed shallow-frozen objects or avoid re-parsing JSON on every in-memory LRU hit when callers treat catalog items as read-only; add a clear `REDIS_URL` check so deployments without Redis do not spawn reconnect sockets every 30s.
* **Missing HTTP Fetch Timeouts:**
  * `packages/connections/src/backups.acrio.ops.ts:31, 67`: `fetch("https://oauth2.googleapis.com/token", ...)` lacks `signal: AbortSignal.timeout(...)`. If Google OAuth hangs, the backup worker job stalls indefinitely.
  * `packages/connections/src/email-alerts.acrio.ops.ts:357`: `fetch(t.url + "/api/internal/bridge", ...)` check caller timeout guards consistently; `packages/database/src/clients.ts:4199` has `AbortSignal.timeout(6000)` (good).

## 6. Frontend Bundle Bloat, Blocking SSR & Polling Overhead (Priority P1 / P2)

### 6.1 File Size & Monolith Inventory (Top 25 Largest TS/TSX Files)

| Rank | Lines | File Path | Concern |
| :--- | :--- | :--- | :--- |
| 1 | 8,751 | `packages/database/src/clients.ts` | Mixes SQLite clients, sync helpers, bridge HTTP clients, HTML scraper, catalog search, and call dispatch |
| 2 | 5,249 | `packages/workers/src/index.ts` | Billing ledger, webhook idempotency, automations, AI orchestrator, escalations, broadcast queue, cron loops |
| 3 | 2,885 | `packages/connections/src/concierge.acrio.ai.ts` | Large AI orchestration module |
| 4 | 2,783 | `apps/web/src/app/dashboard/templates/TemplatesClient.tsx` | Monolithic client page (modals, builders, previewers, API mutations in one bundle) |
| 5 | 2,634 | `apps/web/src/app/dashboard/contacts/ContactsClient.tsx` | Monolithic client page (unvirtualized directory, CSV importer, drawer, group modals) |
| 6 | 2,604 | `packages/database/src/bootstrap.ts` | DDL + column migrations + initial operational data seeding |
| 7 | 2,597 | `packages/connections/src/helpers.acrio.ai.ts` | Mixed AI helper utilities |
| 8 | 2,046 | `packages/workers/src/staff-notes.ts` | Staff notes, mentions, notifications, assignment helpers |
| 9 | 1,947 | `packages/connections/src/whatsapp-cloud.acrio.ai.ts` | Meta Graph API client and template sync |
| 10 | 1,945 | `apps/web/src/app/api/conversations/[id]/route.ts` | Massive single route handler (`GET`/`POST`/`PATCH`) |
| 11 | 1,889 | `apps/web/src/app/dashboard/marketing/MarketingClient.tsx` | Monolithic campaign studio + polling |
| 12 | 1,847 | `apps/web/src/app/dashboard/teams/TeamsClient.tsx` | Monolithic team management UI |
| 13 | 1,813 | `packages/workers/src/owner-desk.ts` | Lead forward / owner desk engine |
| 14 | 1,605 | `packages/connections/src/anthropic-usage-spend.ts` | Anthropic usage API client + report caches |
| 15 | 1,604 | `apps/web/src/app/dashboard/analytics/AnalyticsClient.tsx` | Analytics + Dev Cost dashboards bundled together |
| 16 | 1,547 | `apps/web/src/app/dashboard/inbox/InboxClient.tsx` | Recently reduced from 4,879+ lines; remaining controller hooks/composer glue |
| 17 | 1,523 | `apps/web/src/app/dashboard/dev/DevClient.tsx` | Dev panel monolith |
| 18 | 1,428 | `apps/web/src/app/dashboard/ai-training/AiTrainingClient.tsx` | Training rules + examples UI monolith |
| 19 | 1,251 | `apps/web/src/components/MediaAttachmentTools.tsx` | Heavy attachment/catalogue picker component |
| 20 | 1,178 | `packages/auth/src/index.ts` | Auth, sessions, user approvals, profile, email verification |
| 21 | 1,114 | `apps/web/src/app/dashboard/claude-usage/ClaudeUsageClient.tsx` | Claude usage & cost UI |
| 22 | 1,077 | `apps/web/src/lib/loaders/analytics.ts` | Full-table analytics computation loader |
| 23 | 1,061 | `packages/connections/src/marketing-templates.acrio.ai.ts` | AI template generator & audience builder |
| 24 | 1,051 | `packages/connections/src/email-alerts.acrio.ops.ts` | Email notifications & SMTP bridge |
| 25 | 1,005 | `apps/web/src/app/dashboard/enquiries/EnquiriesClient.tsx` | Ecosystem enquiries UI |

### 6.2 Blocking SSR Across 18 of 19 Dashboard Routes
* **Observed Scan Result:**
  * Only `apps/web/src/app/dashboard/inbox/page.tsx` wraps data loading in `<Suspense>`.
  * All 18 sibling routes (`ai-logs`, `ai-training`, `analytics`, `approvals`, `automations`, `call-queue`, `claude-usage`, `contacts`, `dev`, `enquiries`, `issues-identifier`, `marketing`, `dashboard/page.tsx`, `pricing`, `profile`, `teams`, `templates`, `tracking`) block HTML streaming inside `async function Page()` while awaiting full multi-DB queries (and for `/dashboard/claude-usage` or `/dashboard/analytics`, external HTTP/3.28 MB disk scans).
  * **Impact:** Users experience frozen route transitions until the slowest DB query completes, even with `AppShell` navigation indicators.
* **Recommended Fix:** Adopt the `inbox/page.tsx` pattern everywhere: render instant route shell + skeleton `<Suspense fallback={...}>` around an async `*DataBoundary` Server Component, and mark heavy modals/drawers (`ContactsClient`, `TemplatesClient`, `AnalyticsClient`, `DevClient`) with `next/dynamic(..., { ssr: false })` and TanStack Virtual for tables/lists (`contacts`, `templates`, `ai-logs`).

### 6.3 Code-Splitting Gap (`next/dynamic`)
* **Observed Scan Result:** `apps/web/src/app/dashboard/inbox/InboxClient.tsx` is the **only** file in the entire `apps/web/src/` tree importing `next/dynamic`.
* **Recommended Fix:** Lazy-load secondary modals, CSV importers, template preview drawers, Dev panels, and `MediaAttachmentTools` across `TemplatesClient.tsx`, `ContactsClient.tsx`, `MarketingClient.tsx`, `AnalyticsClient.tsx`, and `DevClient.tsx`.

### 6.4 Residual Client Polling Loops (`setInterval`) & Mount Probes
* **Observed Polling Locations:**
  * `apps/web/src/app/dashboard/DashboardClient.tsx:242`: polls `load(true)` every 30s.
  * `apps/web/src/app/dashboard/ai-logs/AiLogsClient.tsx:231`: polling interval triggers re-fetches of `/api/dev/ai-logs` (which triggers synchronous 3.28 MB `ai.logs` reads!).
  * `apps/web/src/app/dashboard/marketing/MarketingClient.tsx:439`: polls campaign progress even though `socketHub` already emits `broadcast:progress` events.
  * `apps/web/src/app/dashboard/inbox/InboxClient.tsx:336`: still polls `loadSignals()` (callbacks + notifications) every 30s alongside SSE (`NotificationBell` also runs independently in `AppShell`).
  * `apps/web/src/components/AppShell.tsx:54, 92`: triggers `fetch("/api/internal/website-enquiry")` on mount when module cache is cold/expired, calling `checkEcosystemBridgesHealth()` (`packages/database/src/clients.ts:1165-1214`), which probes both `:3002` and `:3003` with a 2,200 ms timeout.
* **Recommended Fix:** Replace polling timers on `DashboardClient`, `AiLogsClient`, `MarketingClient`, and `InboxClient` signals with TanStack Query hooks invalidated/patched via the existing `subscribeRealtimeEvent(...)` singleton (`realtime-client.ts`). Move bridge health to an optional on-demand refresh in Dev/Enquiries rather than firing on first dashboard shell mount.

## 7. Code Health, Lint Status & Decomposition Plan (Priority P2 / P3)

### 7.1 Pre-Existing Lint Failures (`npm run lint`)
Running `node scripts/lint.js` against 293 files passes all model-lock checks (`claude-haiku-5-5`), but currently fails on **9 forbidden em-dash (`\u2014`) violations**:
* `apps/web/src/app/api/enquiries/route.ts:170`
* `apps/web/src/app/api/internal/website-enquiry/route.ts:138`
* `apps/web/src/app/dashboard/claude-usage/ClaudeUsageClient.tsx:601, 825`
* `apps/web/src/app/dashboard/DashboardClient.tsx:445, 653`
* `packages/database/src/ai-logger.ts:214`
* `scripts/test-phase-h-deep-retrieval.ts:61`
* `scripts/test-phase-i-image-intelligence.ts:250`

### 7.2 Backend File Decomposition Targets
1. **Split `packages/database/src/clients.ts` (8,751 lines)** into cohesive modules:
   * `sqlite-connections.ts` (singleton handles + pool management)
   * `catalog-sync.acrio.ts` (ecosystem product/machine readers & caches)
   * `orders-enquiries.bridge.ts` (Classic Concepts `:3003` & Classic Edge `:3002` HTTP bridge + tracking)
   * `call-dispatch.db.ts` and `ai-training.db.ts`
2. **Split `packages/workers/src/index.ts` (5,249 lines)** into:
   * `webhook-idempotency.ts`
   * `billing-ledger.ts`
   * `automations-engine.ts`
   * `inbound-ai-turn.ts`
   * `escalation-scheduler.ts`
   * `broadcast-runner.ts`
   * `worker-daemon.ts`
3. **Split `apps/web/src/app/api/conversations/[id]/route.ts` (1,945 lines)** by moving message sending, template sending, assignment, and resolution business logic out of the Next.js route handler into typed domain services under `@cc/workers` or `@cc/connections`.

## 8. Prioritized Action Roadmap

### Phase 1: Security, Memory Safety & Zero-Risk Quick Wins (1 to 2 Days)
1. Authenticate `GET /api/realtime/stream`, filter private staff events, bind `req.signal` abort cleanup, and clear `keepAliveTimer` on enqueue errors.
2. Remove the header-spoofable host/XFF fallback from `POST /api/internal/ai-logs` in production (`timingSafeEqual` bridge key check only).
3. Add missing SQLite indexes in `packages/database/src/bootstrap.ts` (`billing_ops`, `crm_orders`, `core_auth`, `marketing`, `conversations.custom_links`) + periodic expired-session deletion in `pruneOldJobs()`.
4. Add `AbortSignal.timeout(15000)` to `packages/connections/src/backups.acrio.ops.ts:31, 67`.
5. Clean up the 9 pre-existing em-dash lint errors so `npm run lint` returns green (`exit 0`).

### Phase 2: High-Impact Database, Log & Caching Performance (3 to 5 Days)
1. Migrate AI trace logging (`packages/database/src/ai-logger.ts`) from synchronous 3.28 MB `ai.logs` full-file parsing to indexed SQLite storage + async append-only log file.
2. Bound `claimedInboundWaIds`, `processedAutomationWaIds`, `inboundTurnSeqMap`, and `orgReportCache` with LRU/TTL caps + unique `messages(wa_message_id)` index.
3. Refactor `apps/web/src/lib/loaders/analytics.ts` and `crm.ts` (`loadContactsPayload`) to run SQL aggregations and SQL-filtered pagination (`LIMIT`/`OFFSET` + `WHERE IN`) instead of pulling entire tables into JS.
4. Remove `checkAndEscalateWaitingChats()` from `loadAnalyticsPayload`, convert `api/media/[id]/route.ts` disk I/O to async `fs.promises` + buffer-cached built-in PDFs, and add `.unref()` + adaptive sleep intervals to `ensureBackgroundWorkersRunning()`.
5. Upgrade `sqlite-compat.ts` `getPrepared()` to true LRU promotion and raise statement cache capacity to 512.

### Phase 3: Frontend Streaming, Virtualization & Bundle Splitting (1 Week)
1. Replicate the `/dashboard/inbox` pattern (`<Suspense>` + Server DataBoundary + Zustand/TanStack Query + `next/dynamic` + TanStack Virtual) on the highest-traffic heavy routes first:
   * `ContactsClient.tsx` (2,634 lines) + virtualized contact rows + async CSV modal
   * `TemplatesClient.tsx` (2,783 lines) + dynamic template builder/preview modals
   * `AnalyticsClient.tsx` (1,604 lines) + split Admin vs Dev cost views
   * `MarketingClient.tsx` (1,889 lines) + replace 439-line `setInterval` poll with SSE `broadcast:progress` cache patching
2. Replace `AiLogsClient.tsx`, `DashboardClient.tsx`, and `InboxClient.tsx` signal `setInterval` polls with SSE-driven `queryClient.invalidateQueries` / `setQueryData`.

### Phase 4: Backend Monolith Decomposition (Ongoing)
1. Break apart `clients.ts` (8,751L), `workers/index.ts` (5,249L), and `api/conversations/[id]/route.ts` (1,945L) into single-responsibility service files.
2. Add optional dedicated worker runner mode (`WORKER_ROLE=runner`) so multi-instance Next.js web servers never run duplicate background cron intervals against SQLite.
