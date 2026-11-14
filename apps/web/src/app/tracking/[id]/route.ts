import { NextResponse } from "next/server";
import {
  ensureDatabasesBootstrapped,
  lookupOrderTracking,
} from "@cc/database";

export const dynamic = "force-dynamic";

function buildFallbackPortalUrl(req: Request, rawId: string, notFound: boolean): URL {
  const forwardedProto = (req.headers.get("x-forwarded-proto") || "")
    .split(",")[0]
    .trim();
  const forwardedHost = (
    req.headers.get("x-forwarded-host") ||
    req.headers.get("host") ||
    ""
  )
    .split(",")[0]
    .trim();

  const reqUrl = new URL(req.url);
  const proto = forwardedProto || reqUrl.protocol.replace(":", "") || "https";
  const host = forwardedHost || reqUrl.host;
  const cleanHost = host.toLowerCase().replace(/:\d+$/, "");
  const isTrackingDomain =
    cleanHost === "track.ccapl.cc" ||
    cleanHost === "track.ccapl.in" ||
    cleanHost.startsWith("track.");

  const basePath = isTrackingDomain ? "/" : "/tracking";
  const target = new URL(`${proto}://${host}${basePath}`);
  target.searchParams.set("order", rawId);
  if (notFound) {
    target.searchParams.set("notfound", "1");
  }
  return target;
}

export async function GET(
  req: Request,
  context: { params: Promise<{ id: string }> }
) {
  await ensureDatabasesBootstrapped();
  const { id } = await context.params;
  const cleanId = String(id || "").trim();

  if (!cleanId) {
    return NextResponse.redirect(buildFallbackPortalUrl(req, "", false), 307);
  }

  const reqUrl = new URL(req.url);
  const viewStatusOnly = reqUrl.searchParams.get("status") === "1";

  const tracking = await lookupOrderTracking({
    orderInput: cleanId,
    incrementCounter: true,
  });

  if (!tracking) {
    return NextResponse.redirect(buildFallbackPortalUrl(req, cleanId, true), 307);
  }

  if (!viewStatusOnly && /^https?:\/\//i.test(tracking.providerTrackingUrl)) {
    return NextResponse.redirect(tracking.providerTrackingUrl, 307);
  }

  return NextResponse.redirect(
    buildFallbackPortalUrl(req, tracking.orderId, false),
    307
  );
}
