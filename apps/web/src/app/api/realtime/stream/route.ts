import { NextResponse } from "next/server";
import { socketHub } from "@cc/sockets";
import { ensureBackgroundWorkersRunning } from "@cc/workers";
import { getServerReleaseVersion } from "@/lib/app-version";
import { getCurrentUser } from "@/lib/session";

export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const user = await getCurrentUser().catch(() => null);
  if (!user) {
    return NextResponse.json({ ok: false, error: "Unauthorized" }, { status: 401 });
  }
  if (user.status !== "ACTIVE") {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  ensureBackgroundWorkersRunning();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;
  let cleanedUp = false;

  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    if (unsubscribe) {
      try {
        unsubscribe();
      } catch {
        // Ignore unsubscribe error
      }
      unsubscribe = null;
    }
    if (keepAliveTimer) {
      clearInterval(keepAliveTimer);
      keepAliveTimer = null;
    }
    try {
      req.signal.removeEventListener("abort", cleanup);
    } catch {
      // Ignore signal listener removal error
    }
  };

  const stream = new ReadableStream({
    start(controller) {
      const send = <T extends { type?: string }>(data: T) => {
        if (cleanedUp) return;
        try {
          const eventLine = data.type ? `event: ${data.type}\n` : "";
          controller.enqueue(
            encoder.encode(`${eventLine}data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          cleanup();
        }
      };

      if (req.signal.aborted) {
        cleanup();
        try {
          controller.close();
        } catch {
          // Stream already closed
        }
        return;
      }

      req.signal.addEventListener("abort", cleanup, { once: true });

      send({
        type: "connected",
        timestamp: new Date().toISOString(),
        buildId: getServerReleaseVersion(),
        connectedClients: socketHub.getConnectedCount() + 1,
      });

      unsubscribe = socketHub.subscribe((evt) => {
        if (evt.type === "staff:mention") {
          const payload = evt.payload as { staffId?: unknown } | undefined;
          if (!payload || String(payload.staffId || "") !== user.id) {
            return;
          }
        }
        send(evt);
      });

      keepAliveTimer = setInterval(() => {
        if (cleanedUp) return;
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          cleanup();
        }
      }, 20000);
    },
    cancel() {
      cleanup();
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
    },
  });
}
