export type RealtimeEventType =
  | "connected"
  | "message:new"
  | "note:new"
  | "message:status"
  | "conversation:updated"
  | "conversation:assigned"
  | "conversation:escalated"
  | "chat:escalated"
  | "conversation:resolved"
  | "staff:approval_changed"
  | "broadcast:progress"
  | "template:updated"
  | "backup:completed"
  | "queue:updated"
  | "ai:log";

export interface RealtimeEvent<T = Record<string, unknown>> {
  id: string;
  type: RealtimeEventType;
  timestamp: string;
  payload: T;
}

type Listener = (event: RealtimeEvent) => void;

class RealtimeSocketHub {
  private listeners = new Set<Listener>();
  private recentEvents: RealtimeEvent[] = [];
  private readonly maxRecent = 100;

  subscribe(listener: Listener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  emit<T = Record<string, unknown>>(type: RealtimeEventType, payload: T): RealtimeEvent<T> {
    const event: RealtimeEvent<T> = {
      id: `evt_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      type,
      timestamp: new Date().toISOString(),
      payload,
    };

    this.recentEvents.push(event as RealtimeEvent);
    if (this.recentEvents.length > this.maxRecent) {
      this.recentEvents.shift();
    }

    for (const listener of this.listeners) {
      try {
        listener(event as RealtimeEvent);
      } catch {
        // Never allow a single SSE client error to interrupt others
      }
    }

    return event;
  }

  getConnectedCount(): number {
    return this.listeners.size;
  }

  getRecentEvents(limit = 25): RealtimeEvent[] {
    return this.recentEvents.slice(-limit).reverse();
  }
}

const globalForSockets = globalThis as unknown as {
  __ccWhatsappSocketHub?: RealtimeSocketHub;
};

export const socketHub: RealtimeSocketHub =
  globalForSockets.__ccWhatsappSocketHub ??
  (globalForSockets.__ccWhatsappSocketHub = new RealtimeSocketHub());
