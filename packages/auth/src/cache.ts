import { getDatabaseFilePath } from "@cc/database";

const AUTH_CACHE_TTL_MS = 30_000;

interface AuthCacheEntry<T> {
  value: T;
  expiresAtMs: number;
}

interface AuthCacheStore<T> {
  entries: Map<string, AuthCacheEntry<T>>;
  inflight: Map<string, Promise<T>>;
  generation: number;
}

type AuthCacheSlot =
  | "__ccAuthSetupStatusCache"
  | "__ccAuthPendingApprovalsCache";

function getStore<T>(slot: AuthCacheSlot): AuthCacheStore<T> {
  const globalRef = globalThis as unknown as Record<
    string,
    AuthCacheStore<T> | undefined
  >;
  if (!globalRef[slot]) {
    globalRef[slot] = {
      entries: new Map(),
      inflight: new Map(),
      generation: 0,
    };
  }
  return globalRef[slot]!;
}

function cloneValue<T>(value: T): T {
  if (value === null || typeof value !== "object") return value;
  return structuredClone(value);
}

export async function rememberCoreAuthCache<T>(
  slot: AuthCacheSlot,
  fetcher: () => Promise<T>
): Promise<T> {
  const store = getStore<T>(slot);
  const key = getDatabaseFilePath("core_auth");
  const now = Date.now();
  const cached = store.entries.get(key);
  if (cached && cached.expiresAtMs > now) {
    return cloneValue(cached.value);
  }

  const existingInflight = store.inflight.get(key);
  if (existingInflight) {
    return cloneValue(await existingInflight);
  }

  const startGen = store.generation;
  const promise = (async () => {
    const fresh = await fetcher();
    if (store.generation === startGen) {
      store.entries.set(key, {
        value: cloneValue(fresh),
        expiresAtMs: Date.now() + AUTH_CACHE_TTL_MS,
      });
    }
    return fresh;
  })();

  const cleanup = promise.finally(() => {
    if (store.inflight.get(key) === cleanup) {
      store.inflight.delete(key);
    }
  });

  store.inflight.set(key, cleanup);
  return cloneValue(await cleanup);
}

export function invalidateSetupStatusCache(): void {
  const store = getStore("__ccAuthSetupStatusCache");
  store.generation += 1;
  store.entries.clear();
  store.inflight.clear();
}

export function invalidatePendingApprovalsCache(): void {
  const store = getStore("__ccAuthPendingApprovalsCache");
  store.generation += 1;
  store.entries.clear();
  store.inflight.clear();
}
