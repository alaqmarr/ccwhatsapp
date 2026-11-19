import crypto from "node:crypto";

export function computeBufferEtag(buf: Buffer | string): string {
  const hash = crypto
    .createHash("sha1")
    .update(buf)
    .digest("base64url")
    .slice(0, 20);
  return `"${hash}"`;
}

export function computeFileStatEtag(mediaId: string, size: number, mtimeMs: number): string {
  return `"${mediaId}-${size}-${Math.trunc(mtimeMs)}"`;
}

export function matchesIfNoneMatch(req: Request, etag: string): boolean {
  const raw = req.headers.get("if-none-match");
  if (!raw) return false;
  const trimmed = raw.trim();
  if (trimmed === "*") return true;

  const normalize = (tag: string) => tag.trim().replace(/^W\//i, "");
  const target = normalize(etag);
  return trimmed.split(",").some((part) => normalize(part) === target);
}

export function buildNotModifiedResponse(
  etag: string,
  cacheControl: string
): Response {
  return new Response(null, {
    status: 304,
    headers: {
      ETag: etag,
      "Cache-Control": cacheControl,
    },
  });
}
