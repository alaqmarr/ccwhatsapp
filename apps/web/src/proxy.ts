import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

const TRACKING_HOSTS = new Set(["track.ccapl.cc", "track.ccapl.in"]);
const SHORTLINK_HOSTS = new Set(["ccapl.cc", "www.ccapl.cc"]);
const RESERVED_APP_SEGMENTS = new Set([
  "login",
  "register",
  "dashboard",
  "onboarding",
  "setup",
  "tracking",
  "api",
  "l",
  "_next",
  "favicon.ico",
  "robots.txt",
  "sitemap.xml",
]);

export function proxy(request: NextRequest) {
  const forwardedHost = request.headers.get("x-forwarded-host");
  const rawHost = (forwardedHost || request.headers.get("host") || "")
    .split(",")[0]
    .trim()
    .toLowerCase()
    .replace(/:\d+$/, "");

  const { pathname, search } = request.nextUrl;

  // 1. Order Tracking Domain: track.ccapl.cc / track.ccapl.in -> /tracking & /tracking/{id}
  const isTrackingHost =
    TRACKING_HOSTS.has(rawHost) || rawHost.startsWith("track.");

  if (isTrackingHost) {
    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/api/") ||
      pathname === "/tracking" ||
      pathname.startsWith("/tracking/") ||
      /\.[a-z0-9]{2,6}$/i.test(pathname)
    ) {
      return NextResponse.next();
    }

    if (pathname === "/") {
      const dest = request.nextUrl.clone();
      dest.pathname = "/tracking";
      dest.search = search;
      return NextResponse.rewrite(dest);
    }

    const dest = request.nextUrl.clone();
    dest.pathname = `/tracking${pathname}`;
    dest.search = search;
    return NextResponse.rewrite(dest);
  }

  // 2. Ultra-Short Shareable Link Domain: ccapl.cc/{6-char-id} -> /l/{6-char-id}
  const isShortLinkHost = SHORTLINK_HOSTS.has(rawHost);
  if (isShortLinkHost) {
    if (
      pathname.startsWith("/_next") ||
      pathname.startsWith("/api/") ||
      pathname.startsWith("/l/")
    ) {
      return NextResponse.next();
    }

    if (pathname === "/") {
      return NextResponse.redirect("https://www.classicconcepts.in");
    }

    // Single-segment short code e.g. ccapl.cc/Ab3@9k
    const singleSeg = pathname.replace(/^\/+|\/+$/g, "");
    if (singleSeg && !singleSeg.includes("/")) {
      const dest = request.nextUrl.clone();
      dest.pathname = `/l/${singleSeg}`;
      dest.search = search;
      return NextResponse.rewrite(dest);
    }
  }

  // 3. Also support direct /{6-char-id} on whatsapp.ccapl.cc or localhost (:3007)
  // whenever it is a non-reserved single path segment without a file extension.
  const trimmedSeg = pathname.replace(/^\/+|\/+$/g, "");
  if (
    trimmedSeg &&
    !trimmedSeg.includes("/") &&
    trimmedSeg.length >= 4 &&
    trimmedSeg.length <= 16 &&
    !RESERVED_APP_SEGMENTS.has(trimmedSeg.toLowerCase()) &&
    !/\.[a-z0-9]{2,5}$/i.test(trimmedSeg)
  ) {
    const dest = request.nextUrl.clone();
    dest.pathname = `/l/${trimmedSeg}`;
    dest.search = search;
    return NextResponse.rewrite(dest);
  }

  return NextResponse.next();
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
