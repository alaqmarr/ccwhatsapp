import { NextResponse } from "next/server";

interface BucketEntry {
  count: number;
  resetAt: number;
}

const MAX_RATE_LIMIT_KEYS = 10_000;

const globalLimiterRef = globalThis as unknown as {
  __ccPublicRateBuckets?: Map<string, BucketEntry>;
};

function getBuckets(): Map<string, BucketEntry> {
  if (!globalLimiterRef.__ccPublicRateBuckets) {
    globalLimiterRef.__ccPublicRateBuckets = new Map<string, BucketEntry>();
  }
  return globalLimiterRef.__ccPublicRateBuckets;
}

export function extractClientIp(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    const first = forwarded.split(",")[0]?.trim();
    if (first) return first;
  }
  const realIp = req.headers.get("x-real-ip")?.trim();
  if (realIp) return realIp;
  return "127.0.0.1";
}

/**
 * Lightweight bounded in-memory sliding-window rate limiter for unauthenticated public routes.
 */
export function enforcePublicRateLimit(
  req: Request,
  options: {
    bucket: string;
    maxRequests: number;
    windowMs: number;
    subjectKey?: string;
  }
): NextResponse | null {
  const now = Date.now();
  const buckets = getBuckets();
  const ip = extractClientIp(req);
  const key = options.subjectKey
    ? `${options.bucket}:${ip}:${options.subjectKey}`
    : `${options.bucket}:${ip}`;

  const existing = buckets.get(key);
  if (!existing || now >= existing.resetAt) {
    if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
      for (const [k, v] of buckets.entries()) {
        if (now >= v.resetAt) buckets.delete(k);
        if (buckets.size < MAX_RATE_LIMIT_KEYS * 0.8) break;
      }
      if (buckets.size >= MAX_RATE_LIMIT_KEYS) {
        const oldestKey = buckets.keys().next().value;
        if (oldestKey) buckets.delete(oldestKey);
      }
    }
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return null;
  }

  existing.count += 1;
  if (existing.count > options.maxRequests) {
    const retryAfterSeconds = Math.max(1, Math.ceil((existing.resetAt - now) / 1000));
    return NextResponse.json(
      {
        ok: false,
        error: "Too many requests. Please wait a moment and try again.",
      },
      {
        status: 429,
        headers: {
          "Retry-After": String(retryAfterSeconds),
        },
      }
    );
  }

  return null;
}
