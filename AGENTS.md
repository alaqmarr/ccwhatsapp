# Classic Concepts WhatsApp Desk Rules (whatsapp.ccapl.cc)

## Domain
- Official WhatsApp platform domain: **`whatsapp.ccapl.cc`** (`https://whatsapp.ccapl.cc`).
- Webhook URL: `https://whatsapp.ccapl.cc/api/webhooks/whatsapp`
- Custom short links: `https://ccapl.cc/<6-char-id>` (with `/l/[code]` backwards-compatible)

## UI / UX Rules
1. **No AI design patterns**: Avoid neon purple/indigo gradients, sparkles, bubbly pills, shouty micro-caps, or generic AI SaaS templates.
2. **Full page width**: Always span the full browser width (`w-full`) without cramped centered narrow containers.
3. **Light mode first**: Clean, readable light surfaces (`bg-white`, `bg-neutral-50`, `border-neutral-200`, `text-neutral-900`) everywhere.
4. **Layman terms & zero irrelevant technical showoff text**: Never expose technical jargon that staff or admins do not care about (never write things like "running on SQLite WAL mode", "VACUUM INTO", "SSE sockets", "RBAC", "@cc/workers", etc. in the UI). Use simple everyday English.
5. **Zero em-dashes (`—`), spaced en-dashes (` – `), or `--`** anywhere in UI or ACRIO copy.

## Architecture & Database
- Modular workspace packages: `@cc/workers`, `@cc/queue`, `@cc/rbac`, `@cc/auth`, `@cc/storage`, `@cc/connections`, `@cc/sockets`, `@cc/ui`, `@cc/database`, `@cc/web`.
- **Database**: Strictly use `@libsql/client` + `drizzle-orm/libsql` (never `better-sqlite3`).
- **Pricing Confidentiality**:
  - Client / Admin / Superadmin see ONLY `₹0.95` per Marketing message and `₹0.30` for all other messages (including Auth, Order Updates & Support).
  - Only `DEV` sees actual Meta wholesale costs and net margin.
