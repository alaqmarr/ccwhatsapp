import { NextResponse } from "next/server";
import { resolveAndTrackCustomLink } from "@cc/storage";
import { normalizePublicEcosystemUrl } from "@cc/database";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const link = await resolveAndTrackCustomLink(code);

  if (!link) {
    return NextResponse.redirect(new URL("https://classicconcepts.in/shop", req.url));
  }

  const brandHint = link.productSlug?.startsWith("ce53:")
    ? "CLASSIC_EDGE_53"
    : link.productSlug?.startsWith("cc:")
    ? "CLASSIC_CONCEPTS"
    : undefined;
  const target = normalizePublicEcosystemUrl(link.targetUrl, brandHint);

  return NextResponse.redirect(target);
}
