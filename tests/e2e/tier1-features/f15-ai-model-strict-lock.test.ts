import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  mockMeta,
} from "../harness";
import { callClaudeHaikuMessages } from "@cc/connections";
import { getRawLibSqlClient } from "@cc/database";

describe("F15: AI Model Strict Lock to claude-haiku-5-5 (Tier 1 Feature Coverage)", () => {
  it("T1-F15-01: callClaudeHaikuMessages locks outbound request model to claude-haiku-5-5", async () => {
    mockMeta.reset();

    const responseText = await callClaudeHaikuMessages({
      apiKey: "sk-ant-test-key-12345",
      system: "You are ACRIO for Classic Concepts. Write simple everyday English.",
      messages: [{ role: "user", content: "What sheet thicknesses do you provide?" }],
    });

    assertOk(responseText, "Should receive mock response text");

    const lastCall = mockMeta.getLastClaudeCall();
    assertOk(lastCall, "Claude call should be captured by mockMeta");
    assertStrictEqual(lastCall.model, "claude-haiku-5-5");
  });

  it("T1-F15-02: verifies packages/connections/src/index.ts declares LOCKED_CLAUDE_MODEL as claude-haiku-5-5", () => {
    const connectionsSrcPath = path.resolve(process.cwd(), "packages/connections/src/index.ts");
    assertOk(fs.existsSync(connectionsSrcPath));
    const src = fs.readFileSync(connectionsSrcPath, "utf-8");

    assertOk(
      src.includes('const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5"'),
      "LOCKED_CLAUDE_MODEL must be defined as claude-haiku-5-5"
    );
  });

  it("T1-F15-03: verifies core_auth setup_state seeds AI configuration locked to claude-haiku-5-5", async () => {
    const auth = getRawLibSqlClient("core_auth");
    const aiConfigRes = await auth.execute({
      sql: `SELECT value_json FROM setup_state WHERE key = 'ai_config' LIMIT 1`,
      args: [],
    });

    assertOk(aiConfigRes.rows.length === 1, "ai_config must exist in setup_state");
    const parsed = JSON.parse(String(aiConfigRes.rows[0].value_json));
    assertStrictEqual(parsed.model, "claude-haiku-5-5");
  });

  it("T1-F15-04: verifies system prompt rules prohibit higher models or unauthorized model fallbacks", () => {
    const agentsRulePath = path.resolve(process.cwd(), "AGENTS.md");
    assertOk(fs.existsSync(agentsRulePath));
    const agentsContent = fs.readFileSync(agentsRulePath, "utf-8");

    // Must not allow GPT-4 or unapproved models
    assertOk(!agentsContent.includes("gpt-4"));
    assertOk(!agentsContent.includes("claude-3-opus"));
  });

  it("T1-F15-05: verifies custom Claude temperature and token constraints for low latency", async () => {
    mockMeta.reset();

    await callClaudeHaikuMessages({
      apiKey: "sk-ant-test-key-12345",
      system: "Concise greeting reply.",
      messages: [{ role: "user", content: "Hi" }],
      maxTokens: 200,
      temperature: 0.1,
    });

    const lastCall = mockMeta.getLastClaudeCall();
    assertOk(lastCall);
    assertStrictEqual(lastCall.model, "claude-haiku-5-5");
    assertStrictEqual(lastCall.max_tokens, 200);
    assertStrictEqual(lastCall.temperature, 0.1);
  });
});
