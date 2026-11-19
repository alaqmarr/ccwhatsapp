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
  "custom-links",
  "contacts-meta",
  "company-docs",
] as const;

export type WhatsAppCacheTag = (typeof WHATSAPP_CACHE_TAGS)[number];

interface MemoryEntry {
  value: unknown;
  bytes: number;
  expiresAt: number;
  tags: WhatsAppCacheTag[];
}

interface WhatsAppCacheEngineState {
  redisClient: Redis | null;
  redisInitStarted: boolean;
  redisReady: boolean;
  redisEverReady: boolean;
  redisConfigured: boolean;
  redisUrl: string;
  hasExplicitRedisUrl: boolean;
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
    const explicitUrl = (process.env.REDIS_URL || "").trim();
    globalCacheRef.__ccWhatsAppRedisCache = {
      redisClient: null,
      redisInitStarted: false,
      redisReady: false,
      redisEverReady: false,
      redisConfigured: false,
      redisUrl: explicitUrl || "redis://127.0.0.1:6379",
      hasExplicitRedisUrl: Boolean(explicitUrl),
      memoryStore: new Map<string, MemoryEntry>(),
      memoryUsedBytes: 0,
      tagVersions: {
        "cc-products": 1,
        "ce53-machines": 1,
        "customer-history": 1,
        "acrio-replies": 1,
        "custom-links": 1,
        "contacts-meta": 1,
        "company-docs": 1,
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

  if (
    process.env.REDIS_DISABLED === "1" ||
    process.env.REDIS_DISABLED === "true"
  ) {
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
        // Without an explicit REDIS_URL, stop after the initial probe fails
        if (!state.hasExplicitRedisUrl && (!state.redisEverReady || times > 2)) {
          return null;
        }
        // Exponential backoff capped at 60s when REDIS_URL is configured
        return Math.min(1000 * Math.pow(2, Math.min(times - 1, 6)), 60_000);
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
      state.redisEverReady = true;
      if (!state.redisConfigured) {
        state.redisConfigured = true;
        try {
          await client.config(
            "SET",
            "maxmemory",
            String(WHATSAPP_REDIS_MAX_BYTES)
          );
          await client.config("SET", "maxmemory-policy", "allkeys-lru");
        } catch {
          // Managed Redis instances may restrict CONFIG SET
        }
      }
    });

    state.redisClient = client;
    void client.connect().catch(() => {
      state.redisReady = false;
      if (!state.hasExplicitRedisUrl && !state.redisEverReady) {
        try {
          client.disconnect(false);
        } catch {
          // Ignore disconnect cleanup error
        }
        state.redisClient = null;
      }
    });
  } catch {
    state.redisReady = false;
  }
}

function buildVersionedKey(
  rawKey: string,
  tags: WhatsAppCacheTag[],
  state: WhatsAppCacheEngineState
): string {
  const versionSuffix = tags
    .map((t) => `${t}:v${state.tagVersions[t] || 1}`)
    .join("|");
  return `ccwa:${rawKey}::${versionSuffix}`;
}

function cloneCachedValue<T>(value: T): T {
  if (value === null || typeof value !== "object") {
    return value;
  }
  try {
    return structuredClone(value);
  } catch {
    return value;
  }
}

function writeMemoryLru<T>(
  state: WhatsAppCacheEngineState,
  fullKey: string,
  value: T,
  bytes: number,
  ttlSeconds: number,
  tags: WhatsAppCacheTag[],
  skipClone = false
): void {
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
    value: skipClone ? value : cloneCachedValue(value),
    bytes,
    expiresAt: Date.now() + ttlSeconds * 1000,
    tags,
  });
  state.memoryUsedBytes += bytes;
}

function readMemoryLru<T>(
  state: WhatsAppCacheEngineState,
  fullKey: string,
  skipClone = false
): { value: T } | null {
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
  return {
    value: skipClone ? (entry.value as T) : cloneCachedValue(entry.value as T),
  };
}

export type WhatsAppCacheHitTier = "HIT_MEMORY" | "HIT_REDIS" | "MISS";

export interface RememberWhatsAppCacheOptions {
  skipClone?: boolean;
}

export async function rememberWhatsAppCacheWithMeta<T>(
  key: string,
  tags: WhatsAppCacheTag[],
  ttlSeconds: number,
  fetcher: () => Promise<T>,
  options?: RememberWhatsAppCacheOptions
): Promise<{ value: T; cacheStatus: WhatsAppCacheHitTier }> {
  const state = getCacheState();
  initRedisIfNeeded(state);

  const skipClone = Boolean(options?.skipClone);
  const fullKey = buildVersionedKey(key, tags, state);

  // 1. Check fast memory tier first (parsed value retained in memory, no JSON.parse)
  const fromMem = readMemoryLru<T>(state, fullKey, skipClone);
  if (fromMem !== null) {
    state.hits++;
    return { value: fromMem.value, cacheStatus: "HIT_MEMORY" };
  }

  // 2. Check Redis if online
  if (state.redisReady && state.redisClient) {
    try {
      const raw = await state.redisClient.get(fullKey);
      if (raw) {
        const parsed = JSON.parse(raw) as T;
        const bytes = Buffer.byteLength(raw, "utf8");
        writeMemoryLru(state, fullKey, parsed, bytes, ttlSeconds, tags, skipClone);
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
      const json = JSON.stringify(fresh) ?? "null";
      const bytes = Buffer.byteLength(json, "utf8");
      writeMemoryLru(state, fullKey, fresh, bytes, ttlSeconds, tags, skipClone);
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
  fetcher: () => Promise<T>,
  options?: RememberWhatsAppCacheOptions
): Promise<T> {
  const res = await rememberWhatsAppCacheWithMeta(
    key,
    tags,
    ttlSeconds,
    fetcher,
    options
  );
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
