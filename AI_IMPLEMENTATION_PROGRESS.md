# AI Architecture Implementation Progress (`ai_arch.txt`)

## Phase Status Overview
- [x] **Pre-Phase Build Fix**: Resolved `@cc/web` Ubuntu production build failure (`turbopack.root` + `outputFileTracingRoot` pinned to monorepo root; `/*turbopackIgnore: true*/` added on runtime `fs`/`path` operations).
- [x] **Phase A — Fix Intent Routing & Unnecessary Product Retrieval** *(Completed)*
- [ ] **Phase B — Fix Product Search Relevance, Synonym Grounding & Budget Constraints** *(Pending)*
- [ ] **Phase C — Fix Multi-Turn Conversation State & Topic Switching** *(Pending)*
- [ ] **Phase D — Fix Human Handoff State Machine & Ownership Rules** *(Pending)*
- [ ] **Phase E — Fix WhatsApp Template Drafter & Outbound Message Formatting** *(Pending)*
- [ ] **Phase F — Complete End-to-End `ai.logs` & `/dashboard/ai-logs` Observability** *(Pending)*
- [ ] **Phase G — Add Evaluation & Regression Test Suite** *(Pending)*

---

## Phase A — Completed Summary

### What Was Fixed
1. **Deterministic Turn-Level Intent Router Before Retrieval (`ccwhatsapp`)**:
   - Added `classifyAcrioInboundIntent(rawText, hasConversationHistory)` in `packages/connections/src/index.ts`.
   - Classifies turns into 14 explicit intents before touching `getCachedEcosystemCatalog()` or `searchEcosystemItems()`:
     - Non-retrieval intents (`requiresProductLookup: false`, `allowRollingContextFallback: false`):
       - `GREETING` (`"Hi"`, `"Hello"`, `"Good morning"`, `"Namaste"`, `"Thanks"`)
       - `IDENTITY_META` (`"Who are you?"`, `"What can you help me with?"`, `"Which AI model are you using?"`, `"Are you a bot?"`)
       - `COMPANY_INFO` (`"Where is your factory?"`, `"Where are you located?"`, `"What does Classic Concepts do?"`, `"Do you ship across India?"`)
       - `TOPIC_RESET` (`"I have a different query"`, `"Forget that, let's start over"`, `"Something else"`)
       - `HUMAN_HANDOFF_INFO` (`"Whom will you connect me to?"`, `"Who will you connect me to?"`, `"Who handles custom quotes?"` — `needsImmediateHandoff: false`)
       - `HUMAN_HANDOFF_REQUEST` (`"Connect me to a human"`, `"I want to talk to sales"`, `"Please call me"` — `needsImmediateHandoff: true`)
       - `SUPPORT_ISSUE` (damaged/cracked item, refund, wrong item, payment failed, CAD/DXF attached — `needsImmediateHandoff: true`)
       - `ORDER_STATUS` (order ID or `"Track my order"`, `"Where is my order"` — `needsImmediateHandoff: true`)
       - `OFF_TOPIC` (weather, cricket, recipes, coding, etc. with zero domain terms)
     - Product-retrieval intents (`requiresProductLookup: true`):
       - `PRODUCT_SEARCH`, `FOLLOW_UP_REFINEMENT`, `PRODUCT_COMPARISON`, `CUSTOM_QUOTE`
   - Updated `runAcrioAutonomousTurn` and `runAcrioChatCopilot` so catalog lookup and rolling multi-turn window fallback only execute when `requiresProductLookup === true`.
   - Eliminated prior-turn product contamination on `"Who are you?"`, `"I have a different query"`, `"Where is your factory?"`, and `"Whom will you connect me to?"`.
   - Accurate `ai.logs` telemetry: non-product turns now record `productLookupTriggered: false`, `productLookupQuery: ""`, `productLookupTotalScanned: 0`, and `productsLookedUp: []`.

2. **Website Intent Router & Retrieval Gate (`classicconcepts`)**:
   - Extended `LocalQueryIntent` and added `isNonProductQueryIntent()` in `src/lib/ai-context.ts` to cover `greeting`, `role_clarify`, `company_info`, `topic_reset`, `human_handoff_info`, and `off_topic` before lexical product scoring.
   - Updated `runCustomerConcierge` and `runSmartCatalogSearch` in `src/lib/ai.ts` to pre-classify visitor turns, skip the 189-product catalog system prompt cache (`useCatalogSystemCache: false`) on non-product turns, never backfill product cards on non-product intents, and log `productLookupTriggered: false` / `productLookupTotalScanned: 0` in `ai.logs`.

### Changed Files in Phase A
- `C:\Users\DELL\Downloads\ccwhatsapp\packages\connections\src\index.ts`
- `C:\Users\DELL\Downloads\ccwhatsapp\scripts\test-phase-a-intent-routing.ts`
- `c:\Users\DELL\Desktop\classicconcepts\src\lib\ai-context.ts`
- `c:\Users\DELL\Desktop\classicconcepts\src\lib\ai.ts`
- `c:\Users\DELL\Desktop\classicconcepts\scripts\test-phase-a-intent-routing.ts`

### Verification & Regression Tests Run
- `npx tsx scripts/test-phase-a-intent-routing.ts` in `ccwhatsapp`: **PASS** (21 non-product intents, 6 product-seeking intents, 4 multi-turn context contamination checks + `ai.logs` verification).
- `npx tsx scripts/test-phase-a-intent-routing.ts` in `classicconcepts`: **PASS** (14 non-product queries returning 0 products + podium product lookup verification).
- `npx tsc --noEmit` in both `ccwhatsapp` and `classicconcepts`: **PASS (0 errors)**.
