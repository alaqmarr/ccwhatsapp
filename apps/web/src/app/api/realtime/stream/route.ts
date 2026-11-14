import { socketHub } from "@cc/sockets";
import { ensureBackgroundWorkersRunning } from "@cc/workers";

export const dynamic = "force-dynamic";

export async function GET() {
  ensureBackgroundWorkersRunning();
  const encoder = new TextEncoder();
  let unsubscribe: (() => void) | null = null;
  let keepAliveTimer: ReturnType<typeof setInterval> | null = null;

  const stream = new ReadableStream({
    start(controller) {
      const send = <T extends { type?: string }>(data: T) => {
        try {
          const eventLine = data.type ? `event: ${data.type}\n` : "";
          controller.enqueue(
            encoder.encode(`${eventLine}data: ${JSON.stringify(data)}\n\n`)
          );
        } catch {
          // Stream closed
        }
      };

      send({
        type: "connected",
        timestamp: new Date().toISOString(),
        connectedClients: socketHub.getConnectedCount() + 1,
      });

      unsubscribe = socketHub.subscribe((evt) => {
        send(evt);
      });

      keepAliveTimer = setInterval(() => {
        try {
          controller.enqueue(encoder.encode(`: ping\n\n`));
        } catch {
          // Ignore closed stream
        }
      }, 20000);
    },
    cancel() {
      if (unsubscribe) unsubscribe();
      if (keepAliveTimer) clearInterval(keepAliveTimer);
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
