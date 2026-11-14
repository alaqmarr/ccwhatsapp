import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { callClaudeHaikuMessages } from "@cc/connections";

describe("F15: AI Model Strict Lock - Boundary & Corner Cases", () => {
  it("callClaudeHaikuMessages strictly specifies model claude-haiku-5-5 in request body", async () => {
    mockMeta.reset();
    mockMeta.setClaudeResponse("We manufacture acrylic displays.");

    const res = await callClaudeHaikuMessages({
      apiKey: "test_anthropic_api_key",
      system: "You are an acrylic sales assistant.",
      messages: [{ role: "user", content: "Do you make acrylic podiums?" }],
    });

    assertStrictEqual(res, "We manufacture acrylic displays.");
    const lastClaudeCall = mockMeta.getLastClaudeCall();
    assertOk(lastClaudeCall);
    assertStrictEqual(lastClaudeCall.model, "claude-haiku-5-5", "Outbound model must strictly be claude-haiku-5-5");
  });

  it("missing Anthropic API key returns null immediately without making HTTP fetch call", async () => {
    mockMeta.reset();
    const res = await callClaudeHaikuMessages({
      apiKey: "", // Empty API key
      system: "System prompt",
      messages: [{ role: "user", content: "Hello" }],
    });

    assertStrictEqual(res, null);
    assertStrictEqual(mockMeta.claudeCalls.length, 0, "No network request should be dispatched");
  });

  it("handles empty content array in Anthropic response JSON safely without crashing", async () => {
    mockMeta.reset();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ content: [] }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const res = await callClaudeHaikuMessages({
        apiKey: "test_key",
        system: "System",
        messages: [{ role: "user", content: "Hello" }],
      });
      assertStrictEqual(res, null, "Should return null when content array is empty");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles HTTP 429 Too Many Requests rate limit from Anthropic API safely", async () => {
    mockMeta.reset();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async () => {
      return new Response(JSON.stringify({ error: { message: "Rate limit exceeded" } }), {
        status: 429,
        headers: { "content-type": "application/json" },
      });
    };

    try {
      const res = await callClaudeHaikuMessages({
        apiKey: "test_key",
        system: "System",
        messages: [{ role: "user", content: "Hi" }],
      });
      assertStrictEqual(res, null, "Rate limit should return null without throwing exception");
    } finally {
      globalThis.fetch = originalFetch;
    }
  });

  it("handles AbortSignal timeout on slow Anthropic API response cleanly", async () => {
    mockMeta.reset();
    const originalFetch = globalThis.fetch;
    globalThis.fetch = async (_input, init) => {
      return new Promise((_resolve, reject) => {
        if (init?.signal) {
          init.signal.addEventListener("abort", () => {
            const err = new Error("The operation was aborted");
            err.name = "AbortError";
            reject(err);
          });
        }
      });
    };

    try {
      try {
        const res = await callClaudeHaikuMessages({
          apiKey: "test_key",
          system: "System",
          messages: [{ role: "user", content: "Hi" }],
          timeoutMs: 30,
        });
        assertStrictEqual(res, null);
      } catch (err: unknown) {
        assertOk(err instanceof Error);
        assertOk(err.name === "AbortError" || err.message.includes("aborted"));
      }
    } finally {
      globalThis.fetch = originalFetch;
    }
  });
});
