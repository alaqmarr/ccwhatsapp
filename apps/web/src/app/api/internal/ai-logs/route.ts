import { NextResponse } from "next/server";
import {
  appendAiTraceLog,
  resolveEcosystemBridgeKey,
  type AiTraceLogEntry,
} from "@cc/database";
import { socketHub } from "@cc/sockets";

export const dynamic = "force-dynamic";

function isAuthorizedInternalCaller(req: Request): boolean {
  const key = (req.headers.get("x-cc-bridge-key") || "").trim();
  if (key && key === resolveEcosystemBridgeKey()) return true;

  const host = (req.headers.get("host") || "").toLowerCase();
  const forwarded = (req.headers.get("x-forwarded-for") || "").toLowerCase();
  const isLocalHost =
    host.startsWith("127.0.0.1") ||
    host.startsWith("localhost") ||
    host.startsWith("[::1]");
  const isLocalFwd =
    !forwarded ||
    forwarded.startsWith("127.0.0.1") ||
    forwarded.startsWith("::1") ||
    forwarded.includes("localhost");

  return isLocalHost && isLocalFwd;
}

export async function POST(req: Request) {
  if (!isAuthorizedInternalCaller(req)) {
    return NextResponse.json(
      { ok: false, error: "Invalid internal bridge key" },
      { status: 401 }
    );
  }

  const body = await req.json().catch(() => null);
  if (!body || typeof body !== "object") {
    return NextResponse.json(
      { ok: false, error: "Invalid AI log payload" },
      { status: 400 }
    );
  }

  const rawEntries: any[] = Array.isArray(body.entries) ? body.entries : [body];
  const saved: AiTraceLogEntry[] = [];

  for (const item of rawEntries) {
    if (!item || typeof item !== "object") continue;
    const entry = appendAiTraceLog({
      id: typeof item.id === "string" ? item.id : undefined,
      timestampUtc:
        typeof item.timestampUtc === "string" ? item.timestampUtc : undefined,
      website:
        item.website === "CLASSIC_EDGE_53"
          ? "CLASSIC_EDGE_53"
          : item.website === "CLASSIC_CONCEPTS"
          ? "CLASSIC_CONCEPTS"
          : "WHATSAPP_HUB",
      websiteLabel: String(item.websiteLabel || item.website || "Ecosystem Website"),
      feature: String(item.feature || "AI Operation"),
      actor: String(item.actor || "Visitor"),
      question: String(item.question || ""),
      model: String(item.model || "claude-haiku-5-5"),
      effort: item.effort ? String(item.effort) : undefined,
      outcomeSource: item.outcomeSource || "LIVE_AI",
      responseCacheStatus: item.responseCacheStatus || "BYPASS",
      catalogCacheStatus: item.catalogCacheStatus || "BYPASS",
      cacheDetails: String(item.cacheDetails || ""),
      productLookupTriggered: Boolean(item.productLookupTriggered),
      productLookupQuery: String(item.productLookupQuery || ""),
      productLookupBudget: item.productLookupBudget
        ? String(item.productLookupBudget)
        : null,
      productLookupTotalScanned: Number(item.productLookupTotalScanned ?? 0),
      productsLookedUp: Array.isArray(item.productsLookedUp)
        ? item.productsLookedUp
        : [],
      steps: Array.isArray(item.steps) ? item.steps : [],
      response: String(item.response || ""),
      durationMs: Number(item.durationMs ?? 0),
      tokenUsage: item.tokenUsage || null,
      error: item.error ? String(item.error) : null,
    });
    saved.push(entry);
    try {
      socketHub.emit("ai:log", entry);
    } catch {
      // Non-blocking
    }
  }

  return NextResponse.json({ ok: true, count: saved.length });
}
