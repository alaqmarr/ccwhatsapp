import { NextResponse } from "next/server";
import { getCurrentUser } from "@/lib/session";
import {
  checkEcosystemBridgesHealth,
  ensureDatabasesBootstrapped,
  isValidEcosystemBridgeKey,
} from "@cc/database";
import {
  handleEnquiryReply,
  handleWebsiteOrder,
} from "@/lib/api/website-enquiry/order-and-reply";
import { handleNewWebsiteEnquiry } from "@/lib/api/website-enquiry/new-enquiry";

export const dynamic = "force-dynamic";

function isAuthorizedBridgeCall(req: Request): boolean {
  const key = req.headers.get("x-cc-bridge-key")?.trim() || "";
  return isValidEcosystemBridgeKey(key);
}

export async function GET(req: Request) {
  const bridgeOk = isAuthorizedBridgeCall(req);
  if (!bridgeOk) {
    const user = await getCurrentUser();
    if (!user || user.status !== "ACTIVE") {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }
  }

  const health = await checkEcosystemBridgesHealth();
  return NextResponse.json({ ok: true, health });
}

export async function POST(req: Request) {
  if (!isAuthorizedBridgeCall(req)) {
    return NextResponse.json(
      { ok: false, error: "Invalid bridge key" },
      { status: 401 }
    );
  }

  await ensureDatabasesBootstrapped();
  const body = (await req.json().catch(() => ({}))) as Record<string, unknown>;
  const eventType = String(
    body.type || body.event || "WEBSITE_ENQUIRY"
  ).toUpperCase();

  if (eventType === "WEBSITE_ORDER") {
    return handleWebsiteOrder(body);
  }

  if (eventType === "ENQUIRY_REPLY") {
    return handleEnquiryReply(body);
  }

  return handleNewWebsiteEnquiry(body);
}
