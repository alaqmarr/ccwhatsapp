import assert from "node:assert";
import { getSessionUserByToken, SESSION_COOKIE_NAME, type AuthenticatedUser } from "@cc/auth";
import { sessionContextStorage } from "./session-shim";

export interface TestRequestOptions {
  url?: string;
  method?: "GET" | "POST" | "PUT" | "PATCH" | "DELETE" | string;
  headers?: Record<string, string>;
  body?: unknown;
  query?: Record<string, string | number | boolean | null | undefined>;
  cookies?: Record<string, string>;
  sessionToken?: string;
}

export interface RouteContext {
  params?: Record<string, string> | Promise<Record<string, string>>;
}

export type RouteHandler = (
  req: Request,
  context?: { params: Promise<Record<string, string>> | Record<string, string> }
) => Promise<Response> | Response;

export interface RouteModule {
  GET?: RouteHandler;
  POST?: RouteHandler;
  PUT?: RouteHandler;
  PATCH?: RouteHandler;
  DELETE?: RouteHandler;
  default?: {
    GET?: RouteHandler;
    POST?: RouteHandler;
    PUT?: RouteHandler;
    PATCH?: RouteHandler;
    DELETE?: RouteHandler;
    [key: string]: unknown;
  };
  [key: string]: unknown;
}

/**
 * Enhanced test response wrapper providing assertions and ergonomic deserialization.
 */
export class TestResponse {
  readonly raw: Response;
  readonly status: number;
  readonly ok: boolean;
  readonly headers: Headers;
  private cachedText: string | null = null;
  private cachedJson: unknown = null;

  constructor(raw: Response) {
    this.raw = raw;
    this.status = raw.status;
    this.ok = raw.ok;
    this.headers = raw.headers;
  }

  async text(): Promise<string> {
    if (this.cachedText === null) {
      this.cachedText = await this.raw.text();
    }
    return this.cachedText;
  }

  async json<T = unknown>(): Promise<T> {
    if (this.cachedJson === null) {
      const rawText = await this.text();
      try {
        this.cachedJson = JSON.parse(rawText);
      } catch (err) {
        throw new Error(
          `Failed to parse response body as JSON (status ${this.status}). Raw body: "${rawText.slice(0, 300)}"`
        );
      }
    }
    return this.cachedJson as T;
  }

  cookie(name: string): string | undefined {
    return this.cookies()[name];
  }

  cookies(): Record<string, string> {
    const cookies: Record<string, string> = {};
    const setCookieHeaders = this.headers.getSetCookie
      ? this.headers.getSetCookie()
      : [this.headers.get("set-cookie")].filter(Boolean) as string[];

    for (const raw of setCookieHeaders) {
      const firstPart = raw.split(";")[0]?.trim();
      if (firstPart) {
        const [k, ...v] = firstPart.split("=");
        if (k) cookies[k.trim()] = decodeURIComponent(v.join("=").trim());
      }
    }
    return cookies;
  }

  assertStatus(expected: number, customMessage?: string): this {
    assert.strictEqual(
      this.status,
      expected,
      customMessage || `Expected HTTP status ${expected}, received ${this.status}`
    );
    return this;
  }

  assertOk(customMessage?: string): this {
    assert.ok(
      this.ok,
      customMessage || `Expected response to be ok (2xx), received status ${this.status}`
    );
    return this;
  }

  async assertJson(expectedSubset?: Record<string, unknown>): Promise<any> {
    const data = await this.json<Record<string, unknown>>();
    if (expectedSubset) {
      for (const [key, value] of Object.entries(expectedSubset)) {
        assert.deepStrictEqual(
          data[key],
          value,
          `Response JSON field "${key}" does not match. Expected ${JSON.stringify(value)}, got ${JSON.stringify(data[key])}`
        );
      }
    }
    return data;
  }
}

/**
 * Builds a standard Web API Request object suitable for in-process App Router testing.
 */
export function createTestRequest(options?: TestRequestOptions): Request {
  const method = (options?.method || "GET").toUpperCase();
  let urlStr = options?.url || "http://localhost/";

  if (urlStr.startsWith("/")) {
    urlStr = `http://localhost${urlStr}`;
  }

  const url = new URL(urlStr);

  if (options?.query) {
    for (const [k, v] of Object.entries(options.query)) {
      if (v !== undefined && v !== null) {
        url.searchParams.set(k, String(v));
      }
    }
  }

  const headers = new Headers(options?.headers || {});

  // Handle session cookie
  const cookieMap: Record<string, string> = { ...(options?.cookies || {}) };
  if (options?.sessionToken) {
    cookieMap[SESSION_COOKIE_NAME] = options.sessionToken;
  }

  const cookiePairs = Object.entries(cookieMap)
    .filter(([_, v]) => Boolean(v))
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`);

  if (cookiePairs.length > 0) {
    const existingCookie = headers.get("cookie");
    headers.set("cookie", existingCookie ? `${existingCookie}; ${cookiePairs.join("; ")}` : cookiePairs.join("; "));
  }

  let body: BodyInit | null = null;
  if (options?.body !== undefined && options?.body !== null && method !== "GET" && method !== "HEAD") {
    if (typeof options.body === "string" || options.body instanceof Blob) {
      body = options.body;
    } else if (options.body instanceof Uint8Array || Buffer.isBuffer(options.body)) {
      body = options.body as unknown as BodyInit;
    } else {
      if (!headers.has("content-type")) {
        headers.set("content-type", "application/json");
      }
      body = JSON.stringify(options.body);
    }
  }

  return new Request(url.toString(), {
    method,
    headers,
    body,
  });
}

/**
 * Shorthand to create a JSON POST request.
 */
export function createJsonRequest(
  url: string,
  body: unknown,
  options?: Omit<TestRequestOptions, "url" | "body" | "method">
): Request {
  return createTestRequest({
    ...options,
    url,
    method: "POST",
    body,
  });
}

/**
 * In-process invoker for Next.js App Router route handlers.
 * Extracts the appropriate HTTP method handler and calls it directly without TCP networking.
 */
export async function callRoute(
  handlerOrModule: RouteHandler | RouteModule,
  req: Request,
  context?: RouteContext
): Promise<TestResponse> {
  const method = req.method.toUpperCase();
  let fn: RouteHandler | undefined;

  if (typeof handlerOrModule === "function") {
    fn = handlerOrModule;
  } else if (handlerOrModule && typeof handlerOrModule === "object") {
    // Check direct export (e.g. export async function GET)
    fn = handlerOrModule[method] as RouteHandler | undefined;

    // Check default export (e.g. export default { GET })
    if (!fn && handlerOrModule.default && typeof handlerOrModule.default === "object") {
      fn = handlerOrModule.default[method] as RouteHandler | undefined;
    }
  }

  if (!fn || typeof fn !== "function") {
    throw new Error(
      `Route handler does not export a function for method "${method}". Available keys: ${Object.keys(
        handlerOrModule || {}
      ).join(", ")}`
    );
  }

  const rawParams = context?.params || {};
  const paramsPromise = rawParams instanceof Promise ? rawParams : Promise.resolve(rawParams);
  const routeContext = { params: paramsPromise };

  // Resolve session user from request cookie
  const cookieHeader = req.headers.get("cookie") || "";
  let requestUser: AuthenticatedUser | null = null;
  const match = cookieHeader.match(new RegExp(`${SESSION_COOKIE_NAME}=([^;]+)`));
  if (match) {
    const token = decodeURIComponent(match[1].trim());
    requestUser = await getSessionUserByToken(token);
  }

  const rawRes = await sessionContextStorage.run(requestUser, () => fn(req, routeContext));
  return new TestResponse(rawRes);
}

/**
 * Shorthand helper for route GET requests.
 */
export async function routeGet(
  handlerOrModule: RouteHandler | RouteModule,
  url: string,
  options?: Omit<TestRequestOptions, "url" | "method">,
  context?: RouteContext
): Promise<TestResponse> {
  const req = createTestRequest({ ...options, url, method: "GET" });
  return callRoute(handlerOrModule, req, context);
}

/**
 * Shorthand helper for route POST requests.
 */
export async function routePost(
  handlerOrModule: RouteHandler | RouteModule,
  url: string,
  body?: unknown,
  options?: Omit<TestRequestOptions, "url" | "body" | "method">,
  context?: RouteContext
): Promise<TestResponse> {
  const req = createTestRequest({ ...options, url, method: "POST", body });
  return callRoute(handlerOrModule, req, context);
}

/**
 * Shorthand helper for route PUT requests.
 */
export async function routePut(
  handlerOrModule: RouteHandler | RouteModule,
  url: string,
  body?: unknown,
  options?: Omit<TestRequestOptions, "url" | "body" | "method">,
  context?: RouteContext
): Promise<TestResponse> {
  const req = createTestRequest({ ...options, url, method: "PUT", body });
  return callRoute(handlerOrModule, req, context);
}

/**
 * Shorthand helper for route PATCH requests.
 */
export async function routePatch(
  handlerOrModule: RouteHandler | RouteModule,
  url: string,
  body?: unknown,
  options?: Omit<TestRequestOptions, "url" | "body" | "method">,
  context?: RouteContext
): Promise<TestResponse> {
  const req = createTestRequest({ ...options, url, method: "PATCH", body });
  return callRoute(handlerOrModule, req, context);
}

/**
 * Shorthand helper for route DELETE requests.
 */
export async function routeDelete(
  handlerOrModule: RouteHandler | RouteModule,
  url: string,
  options?: Omit<TestRequestOptions, "url" | "method">,
  context?: RouteContext
): Promise<TestResponse> {
  const req = createTestRequest({ ...options, url, method: "DELETE" });
  return callRoute(handlerOrModule, req, context);
}
