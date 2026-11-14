import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TRACKING_HOSTS = new Set(["track.ccapl.cc", "track.ccapl.in"]);

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const rawHost = (forwardedHost || request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");

  const isTrackingHost =
    TRACKING_HOSTS.has(rawHost) || rawHost.startsWith("track.");

  if (!isTrackingHost) {
    return NextResponse.next();
  }

  const { pathname, search } = request.nextUrl;

  // Allow Next.js internals, API routes, already-rewritten /tracking paths, and static files
  if (
    pathname.startsWith("/_next") ||
    pathname.startsWith("/api/") ||
    pathname === "/tracking" ||
    pathname.startsWith("/tracking/") ||
    /\.[a-z0-9]{2,6}$/i.test(pathname)
  ) {
    return NextResponse.next();
  }

  // Internally route root (track.ccapl.in / track.ccapl.cc) -> /tracking
  if (pathname === "/") {
    const dest = request.nextUrl.clone();
    dest.pathname = "/tracking";
    dest.search = search;
    return NextResponse.rewrite(dest);
  }

  // Internally route track.ccapl.cc/{id} & track.ccapl.in/{id} -> /tracking/{id}
  const dest = request.nextUrl.clone();
  dest.pathname = `/tracking${pathname}`;
  dest.search = search;
  return NextResponse.rewrite(dest);
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
