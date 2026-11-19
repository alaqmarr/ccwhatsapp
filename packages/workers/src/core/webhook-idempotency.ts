import { ensureDatabasesBootstrapped, getRawLibSqlClient } from "@cc/database";

const MAX_WA_ID_CACHE_SIZE = 10_000;
const MAX_INBOUND_SEQ_ENTRIES = 5_000;

/**
 * Bounded LRU ring Set so long-lived server processes never leak memory
 * across millions of Meta WhatsApp message IDs.
 */
class BoundedIdSet {
  private readonly set = new Set<string>();

  constructor(private readonly maxSize = MAX_WA_ID_CACHE_SIZE) {}

  has(id: string): boolean {
    if (!this.set.has(id)) return false;
    this.set.delete(id);
    this.set.add(id);
    return true;
  }

  add(id: string): void {
    if (this.set.has(id)) {
      this.set.delete(id);
    } else if (this.set.size >= this.maxSize) {
      const oldest = this.set.values().next().value;
      if (oldest !== undefined) {
        this.set.delete(oldest);
      }
    }
    this.set.add(id);
  }

  clear(): void {
    this.set.clear();
  }
}

const claimedInboundWaIds = new BoundedIdSet(MAX_WA_ID_CACHE_SIZE);
const processedAutomationWaIds = new BoundedIdSet(MAX_WA_ID_CACHE_SIZE);

/**
 * Idempotency guard for inbound Meta WhatsApp message IDs (`wamid.*`).
 * Prevents duplicate message inserts, duplicate ACRIO runs, and duplicate ₹0.30 ledger charges
 * when Meta retries a webhook delivery. Empty IDs (e.g. local simulator calls) always return true.
 */
export async function claimInboundWaMessageId(
  waMessageId?: string | null
): Promise<boolean> {
  const cleanId = String(waMessageId || "").trim();
  if (!cleanId) return true;
  if (claimedInboundWaIds.has(cleanId)) return false;
  // Claim synchronously before awaiting DB I/O so parallel webhooks in the same event tick cannot race past SELECT
  claimedInboundWaIds.add(cleanId);

  await ensureDatabasesBootstrapped();
  const conv = getRawLibSqlClient("conversations");
  const existing = await conv.execute({
    sql: `SELECT id FROM messages WHERE wa_message_id = ? LIMIT 1`,
    args: [cleanId],
  });
  if (existing.rows.length > 0) {
    return false;
  }

  return true;
}

export function claimAutomationWaMessageId(waMessageId?: string | null): boolean {
  const cleanWaId = String(waMessageId || "").trim();
  if (!cleanWaId) return true;
  if (processedAutomationWaIds.has(cleanWaId)) return false;
  processedAutomationWaIds.add(cleanWaId);
  return true;
}

export function resetClaimedWaMessageIdsForTest(): void {
  claimedInboundWaIds.clear();
  processedAutomationWaIds.clear();
}

const gInboundState = globalThis as unknown as {
  __ccInboundSeqMap?: Map<string, number>;
  __ccInboundLockMap?: Map<string, Promise<void>>;
};

const inboundTurnSeqMap = (gInboundState.__ccInboundSeqMap ??= new Map<string, number>());
const conversationWorkerLockMap = (gInboundState.__ccInboundLockMap ??= new Map<string, Promise<void>>());

/**
 * Increments and stores the turn sequence number for a conversation,
 * evicting the oldest entry if the map exceeds 5,000 conversations.
 */
export function nextInboundTurnSeq(conversationId: string): number {
  const next = (inboundTurnSeqMap.get(conversationId) || 0) + 1;
  if (inboundTurnSeqMap.has(conversationId)) {
    inboundTurnSeqMap.delete(conversationId);
  } else if (inboundTurnSeqMap.size >= MAX_INBOUND_SEQ_ENTRIES) {
    const oldestKey = inboundTurnSeqMap.keys().next().value;
    if (oldestKey !== undefined) {
      inboundTurnSeqMap.delete(oldestKey);
    }
  }
  inboundTurnSeqMap.set(conversationId, next);
  return next;
}

export function getInboundTurnSeq(conversationId: string): number | undefined {
  return inboundTurnSeqMap.get(conversationId);
}

/**
 * Serializes inbound worker execution per conversationId and always deletes
 * the lock key in finally once no later waiter remains queued.
 */
export async function withConversationWorkerLock<T>(
  conversationId: string,
  task: () => Promise<T>
): Promise<T> {
  const prev = conversationWorkerLockMap.get(conversationId) || Promise.resolve();
  let release!: () => void;
  const next = new Promise<void>((resolve) => {
    release = resolve;
  });
  const chained = prev.catch(() => {}).then(() => next);
  conversationWorkerLockMap.set(conversationId, chained);
  try {
    await prev.catch(() => {});
    return await task();
  } finally {
    release();
    if (conversationWorkerLockMap.get(conversationId) === chained) {
      conversationWorkerLockMap.delete(conversationId);
    }
  }
}
