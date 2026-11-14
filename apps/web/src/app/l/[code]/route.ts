import { NextResponse } from "next/server";
import { resolveAndTrackCustomLink } from "@cc/storage";

export const dynamic = "force-dynamic";

export async function GET(
  req: Request,
  context: { params: Promise<{ code: string }> }
) {
  const { code } = await context.params;
  const link = await resolveAndTrackCustomLink(code);

  if (!link) {
    return NextResponse.redirect(new URL("https://www.classicconcepts.in/shop", req.url));
  }

  const target = link.targetUrl.startsWith("http")
    ? link.targetUrl
    : `https://www.classicconcepts.in${link.targetUrl}`;

  return NextResponse.redirect(target);
}
