"use client";

type RealtimeListener = (ev: MessageEvent) => void;

interface SingletonRealtimeHub {
  es: EventSource | null;
  listenersByEvent: Map<string, Set<RealtimeListener>>;
  boundEventDispatchers: Map<string, (ev: Event) => void>;
  totalSubscribers: number;
}

function getHub(): SingletonRealtimeHub {
  const g = globalThis as unknown as { __ccRealtimeHub?: SingletonRealtimeHub };
  if (!g.__ccRealtimeHub) {
    g.__ccRealtimeHub = {
      es: null,
      listenersByEvent: new Map(),
      boundEventDispatchers: new Map(),
      totalSubscribers: 0,
    };
  }
  return g.__ccRealtimeHub;
}

function ensureDispatcherForEvent(hub: SingletonRealtimeHub, eventName: string) {
  if (!hub.es || hub.boundEventDispatchers.has(eventName)) return;
  const dispatch = (ev: Event) => {
    const set = hub.listenersByEvent.get(eventName);
    if (!set || set.size === 0) return;
    for (const listener of Array.from(set)) {
      try {
        listener(ev as MessageEvent);
      } catch {
        // Isolate subscriber errors from sibling listeners
      }
    }
  };
  hub.boundEventDispatchers.set(eventName, dispatch);
  hub.es.addEventListener(eventName, dispatch);
}

function ensureSocketConnected(hub: SingletonRealtimeHub) {
  if (typeof window === "undefined" || typeof EventSource === "undefined") return;
  if (hub.es) return;
  hub.es = new EventSource("/api/realtime/stream");
  for (const eventName of hub.listenersByEvent.keys()) {
    ensureDispatcherForEvent(hub, eventName);
  }
}

/**
 * Subscribes to named SSE events over a single shared EventSource per browser tab,
 * preventing browser HTTP/1.1 6-connection pool exhaustion across dashboard widgets.
 */
export function subscribeRealtimeEvent(
  eventName: string,
  listener: RealtimeListener
): () => void {
  const hub = getHub();
  let set = hub.listenersByEvent.get(eventName);
  if (!set) {
    set = new Set();
    hub.listenersByEvent.set(eventName, set);
  }
  if (!set.has(listener)) {
    set.add(listener);
    hub.totalSubscribers += 1;
  }

  ensureSocketConnected(hub);
  ensureDispatcherForEvent(hub, eventName);

  return () => {
    const currentSet = hub.listenersByEvent.get(eventName);
    if (currentSet && currentSet.delete(listener)) {
      hub.totalSubscribers = Math.max(0, hub.totalSubscribers - 1);
      if (currentSet.size === 0) {
        hub.listenersByEvent.delete(eventName);
        const dispatch = hub.boundEventDispatchers.get(eventName);
        if (dispatch && hub.es) {
          hub.es.removeEventListener(eventName, dispatch);
        }
        hub.boundEventDispatchers.delete(eventName);
      }
    }
    if (hub.totalSubscribers === 0 && hub.es) {
      hub.es.close();
      hub.es = null;
      hub.boundEventDispatchers.clear();
    }
  };
}

/**
 * Helper to unwrap `{ id, type, timestamp, payload }` emitted by @cc/sockets
 * back to its inner payload object cleanly.
 */
export function parseRealtimeEventPayload(ev: MessageEvent): Record<string, unknown> {
  try {
    const raw = JSON.parse(String(ev.data || "{}"));
    if (raw && typeof raw === "object" && raw.payload && typeof raw.payload === "object") {
      return raw.payload as Record<string, unknown>;
    }
    return raw && typeof raw === "object" ? (raw as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
