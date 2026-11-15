import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  resolveSharedAnthropicApiKey,
  saveSharedAnthropicApiKey,
} from "@cc/database";
import {
  getCachedEcosystemCatalog,
  syncEcosystemRedisCache,
} from "@cc/connections";
import { hasPermission } from "@cc/rbac";
import { getWhatsAppCacheSummary } from "@cc/storage";
import { getCurrentUser } from "../../../../lib/session";

export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getCurrentUser();
  if (!user || !hasPermission(user.role, "inbox:view", user.status)) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const [catalog, aiKeyInfo] = await Promise.all([
    getCachedEcosystemCatalog(),
    resolveSharedAnthropicApiKey(),
  ]);
  const cacheSummary = getWhatsAppCacheSummary();

  return NextResponse.json({
    ok: true,
    classicConceptsCount: catalog.classicConceptsProducts.length,
    classicEdgeMachinesCount: catalog.classicEdgeItems.filter((i) => i.itemType === "MACHINE").length,
    classicEdgeConsumablesCount: catalog.classicEdgeItems.filter((i) => i.itemType === "CONSUMABLE").length,
    autoShortLinksCount: catalog.allItems.filter((i) => Boolean(i.shortCode)).length,
    lastSyncedAt: cacheSummary.lastSyncedAt,
    aiConnected: Boolean(aiKeyInfo.apiKey),
    aiKeySource: aiKeyInfo.source,
    aiMaskedKey: aiKeyInfo.apiKey
      ? `${aiKeyInfo.apiKey.slice(0, 10)}...${aiKeyInfo.apiKey.slice(-4)}`
      : "",
  });
}

const CC_BRIDGE_KEY = (
  process.env.CC_ECOSYSTEM_BRIDGE_KEY || "cc_internal_bridge_2026"
).trim();

function isAuthorizedEcosystemBridge(req: Request): boolean {
  const headerKey = (
    req.headers.get("x-cc-bridge-key") ||
    req.headers.get("x-bridge-secret") ||
    ""
  ).trim();
  return Boolean(headerKey && headerKey === CC_BRIDGE_KEY);
}

export async function POST(req: Request) {
  const isBridge = isAuthorizedEcosystemBridge(req);
  const user = isBridge ? null : await getCurrentUser().catch(() => null);
  if (!isBridge && (!user || user.status !== "ACTIVE")) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  await ensureDatabasesBootstrapped();
  const body = await req.json().catch(() => ({}));
  const action = String(body.action || "sync");

  if (action === "save_ai_key") {
    if (isBridge || !user || !["DEV", "SUPERADMIN", "ADMIN"].includes(user.role)) {
      return NextResponse.json({ ok: false, error: "Admin access required." }, { status: 403 });
    }
    const rawKey = String(body.anthropicApiKey || "").trim();
    if (rawKey && !rawKey.startsWith("sk-ant-")) {
      return NextResponse.json(
        { ok: false, error: "Anthropic API key should start with sk-ant-" },
        { status: 400 }
      );
    }
    await saveSharedAnthropicApiKey(rawKey);
    const updated = await resolveSharedAnthropicApiKey();
    return NextResponse.json({
      ok: true,
      aiConnected: Boolean(updated.apiKey),
      aiKeySource: updated.source,
      aiMaskedKey: updated.apiKey
        ? `${updated.apiKey.slice(0, 10)}...${updated.apiKey.slice(-4)}`
        : "",
    });
  }

  const rawBrand = String(body.brand || "ALL").toUpperCase();
  const brand =
    rawBrand === "CLASSIC_CONCEPTS" || rawBrand === "CLASSIC_EDGE_53"
      ? rawBrand
      : "ALL";

  const synced = await syncEcosystemRedisCache({ brand });
  return NextResponse.json({
    ok: true,
    source: isBridge ? "ecosystem-bridge" : "admin-session",
    ...synced,
  });
}
