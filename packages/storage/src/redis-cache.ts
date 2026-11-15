import Redis from "ioredis";

export const WHATSAPP_REDIS_MAX_BYTES =
  Number(process.env.REDIS_MAXMEMORY_BYTES) > 0
    ? Number(process.env.REDIS_MAXMEMORY_BYTES)
    : 100 * 1024 * 1024; // 100 MB

export const WHATSAPP_CACHE_TAGS = [
  "cc-products",
  "ce53-machines",
  "customer-history",
  "acrio-replies",
] as const;

export type WhatsAppCacheTag = (typeof WHATSAPP_CACHE_TAGS)[number];

interface MemoryEntry {
  json: string;
  bytes: number;
  expiresAt: number;
  tags: WhatsAppCacheTag[];
}

interface WhatsAppCacheEngineState {
  redisClient: Redis | null;
  redisInitStarted: boolean;
  redisReady: boolean;
  redisConfigured: boolean;
  redisUrl: string;
  memoryStore: Map<string, MemoryEntry>;
  memoryUsedBytes: number;
  tagVersions: Record<WhatsAppCacheTag, number>;
  inflight: Map<string, Promise<unknown>>;
  hits: number;
  misses: number;
  writes: number;
  lastSyncedAt: string | null;
}

const globalCacheRef = globalThis as unknown as {
  __ccWhatsAppRedisCache?: WhatsAppCacheEngineState;
};

function getCacheState(): WhatsAppCacheEngineState {
  if (!globalCacheRef.__ccWhatsAppRedisCache) {
    globalCacheRef.__ccWhatsAppRedisCache = {
      redisClient: null,
      redisInitStarted: false,
      redisReady: false,
      redisConfigured: false,
      redisUrl: process.env.REDIS_URL || "redis://127.0.0.1:6379",
      memoryStore: new Map<string, MemoryEntry>(),
      memoryUsedBytes: 0,
      tagVersions: {
        "cc-products": 1,
        "ce53-machines": 1,
        "customer-history": 1,
        "acrio-replies": 1,
      },
      inflight: new Map<string, Promise<unknown>>(),
      hits: 0,
      misses: 0,
      writes: 0,
      lastSyncedAt: null,
    };
  }
  return globalCacheRef.__ccWhatsAppRedisCache;
}

function initRedisIfNeeded(state: WhatsAppCacheEngineState): void {
  if (state.redisInitStarted) return;
  state.redisInitStarted = true;

  if (process.env.REDIS_DISABLED === "1" || process.env.REDIS_DISABLED === "true") {
    return;
  }

  try {
    const client = new Redis(state.redisUrl, {
      lazyConnect: true,
      enableOfflineQueue: false,
      maxRetriesPerRequest: 0,
      connectTimeout: 450,
      commandTimeout: 800,
      retryStrategy(times) {
        return Math.min(times * 5000, 30000);
      },
    });

    client.on("error", () => {
      state.redisReady = false;
    });
    client.on("close", () => {
      state.redisReady = false;
    });
    client.on("ready", async () => {
      state.redisReady = true;
      if (!state.redisConfigured) {
        state.redisConfigured = true;
        try {
          await client.config("SET", "maxmemory", String(WHATSAPP_REDIS_MAX_BYTES));
          await client.config("SET", "maxmemory-policy", "allkeys-lru");
        } catch {
          // Managed Redis instances may restrict CONFIG SET
        }
      }
    });

    state.redisClient = client;
    void client.connect().catch(() => {
      state.redisReady = false;
    });
  } catch {
    state.redisReady = false;
  }
}

function buildVersionedKey(rawKey: string, tags: WhatsAppCacheTag[], state: WhatsAppCacheEngineState): string {
  const versionSuffix = tags.map((t) => `${t}:v${state.tagVersions[t] || 1}`).join("|");
  return `ccwa:${rawKey}::${versionSuffix}`;
}

function writeMemoryLru(
  state: WhatsAppCacheEngineState,
  fullKey: string,
  json: string,
  ttlSeconds: number,
  tags: WhatsAppCacheTag[]
): void {
  const bytes = Buffer.byteLength(json, "utf8");
  if (bytes > WHATSAPP_REDIS_MAX_BYTES * 0.25) return;

  const existing = state.memoryStore.get(fullKey);
  if (existing) {
    state.memoryUsedBytes -= existing.bytes;
    state.memoryStore.delete(fullKey);
  }

  while (
    state.memoryUsedBytes + bytes > WHATSAPP_REDIS_MAX_BYTES &&
    state.memoryStore.size > 0
  ) {
    const oldestKey = state.memoryStore.keys().next().value;
    if (!oldestKey) break;
    const oldest = state.memoryStore.get(oldestKey);
    if (oldest) state.memoryUsedBytes -= oldest.bytes;
    state.memoryStore.delete(oldestKey);
  }

  state.memoryStore.set(fullKey, {
    json,
    bytes,
    expiresAt: Date.now() + ttlSeconds * 1000,
    tags,
  });
  state.memoryUsedBytes += bytes;
}

function readMemoryLru<T>(state: WhatsAppCacheEngineState, fullKey: string): T | null {
  const entry = state.memoryStore.get(fullKey);
  if (!entry) return null;
  if (Date.now() > entry.expiresAt) {
    state.memoryUsedBytes -= entry.bytes;
    state.memoryStore.delete(fullKey);
    return null;
  }
  // Promote in Map order for LRU
  state.memoryStore.delete(fullKey);
  state.memoryStore.set(fullKey, entry);
  try {
    return JSON.parse(entry.json) as T;
  } catch {
    return null;
  }
}

export type WhatsAppCacheHitTier = "HIT_MEMORY" | "HIT_REDIS" | "MISS";

export async function rememberWhatsAppCacheWithMeta<T>(
  key: string,
  tags: WhatsAppCacheTag[],
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<{ value: T; cacheStatus: WhatsAppCacheHitTier }> {
  const state = getCacheState();
  initRedisIfNeeded(state);

  const fullKey = buildVersionedKey(key, tags, state);

  // 1. Check fast memory tier first
  const fromMem = readMemoryLru<T>(state, fullKey);
  if (fromMem !== null) {
    state.hits++;
    return { value: fromMem, cacheStatus: "HIT_MEMORY" };
  }

  // 2. Check Redis if online
  if (state.redisReady && state.redisClient) {
    try {
      const raw = await state.redisClient.get(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        writeMemoryLru(state, fullKey, raw, ttlSeconds, tags);
        state.hits++;
        return { value: parsed, cacheStatus: "HIT_REDIS" };
      }
    } catch {
      // Fall through to fetcher
    }
  }

  // 3. Deduplicate concurrent fetches
  const existingFlight = state.inflight.get(fullKey) as Promise<T> | undefined;
  if (existingFlight) {
    const val = await existingFlight;
    return { value: val, cacheStatus: "MISS" };
  }

  state.misses++;
  const promise = (async () => {
    try {
      const fresh = await fetcher();
      const json = JSON.stringify(fresh);
      writeMemoryLru(state, fullKey, json, ttlSeconds, tags);
      state.writes++;
      if (tags.includes("cc-products") || tags.includes("ce53-machines")) {
        state.lastSyncedAt = new Date().toISOString();
      }

      if (state.redisReady && state.redisClient) {
        try {
          await state.redisClient.set(fullKey, json, "EX", ttlSeconds);
        } catch {
          // Memory cache still holds the entry
        }
      }
      return fresh;
    } finally {
      state.inflight.delete(fullKey);
    }
  })();

  state.inflight.set(fullKey, promise);
  const value = await promise;
  return { value, cacheStatus: "MISS" };
}

export async function rememberWhatsAppCache<T>(
  key: string,
  tags: WhatsAppCacheTag[],
  ttlSeconds: number,
  fetcher: () => Promise<T>
): Promise<T> {
  const res = await rememberWhatsAppCacheWithMeta(key, tags, ttlSeconds, fetcher);
  return res.value;
}

export async function invalidateWhatsAppCacheTags(
  tags: WhatsAppCacheTag[] = [...WHATSAPP_CACHE_TAGS]
): Promise<void> {
  const state = getCacheState();
  for (const tag of tags) {
    state.tagVersions[tag] = (state.tagVersions[tag] || 1) + 1;
  }

  for (const [k, entry] of state.memoryStore.entries()) {
    if (entry.tags.some((t) => tags.includes(t))) {
      state.memoryUsedBytes -= entry.bytes;
      state.memoryStore.delete(k);
    }
  }
}

export function getWhatsAppCacheSummary(): {
  connectedToRedis: boolean;
  cachedItemsCount: number;
  usedMegabytes: number;
  maxMegabytes: number;
  hits: number;
  misses: number;
  lastSyncedAt: string | null;
} {
  const state = getCacheState();
  initRedisIfNeeded(state);
  return {
    connectedToRedis: state.redisReady,
    cachedItemsCount: state.memoryStore.size,
    usedMegabytes: Number((state.memoryUsedBytes / (1024 * 1024)).toFixed(2)),
    maxMegabytes: Math.round(WHATSAPP_REDIS_MAX_BYTES / (1024 * 1024)),
    hits: state.hits,
    misses: state.misses,
    lastSyncedAt: state.lastSyncedAt,
  };
}
