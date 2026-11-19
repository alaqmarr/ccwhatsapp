import { getRawLibSqlClient } from "./handles";

export interface AiTrainingExampleRecord {
  id: string;
  title: string;
  category: string;
  guidanceType: "INSTRUCTION" | "FIXED_ANSWER";
  customerQuestion: string;
  idealAnswer: string;
  doNotSay: string;
  productSlug: string;
  priority: "HIGH" | "NORMAL";
  isEnabled: boolean;
  usageCount: number;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

export interface AiTrainingRuleRecord {
  id: string;
  title: string;
  ruleText: string;
  scope: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT";
  isEnabled: boolean;
  createdByName: string;
  createdAt: string;
  updatedAt: string;
}

async function ensureAiTrainingTables(): Promise<void> {
  const conv = getRawLibSqlClient("conversations");
  await conv.batch(
    [
      `CREATE TABLE IF NOT EXISTS ai_training_examples (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        category TEXT NOT NULL DEFAULT 'Product Knowledge',
        guidance_type TEXT NOT NULL DEFAULT 'FIXED_ANSWER',
        customer_question TEXT NOT NULL,
        ideal_answer TEXT NOT NULL,
        do_not_say TEXT DEFAULT '',
        product_slug TEXT DEFAULT '',
        priority TEXT NOT NULL DEFAULT 'NORMAL',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        usage_count INTEGER NOT NULL DEFAULT 0,
        created_by_name TEXT NOT NULL DEFAULT 'Team',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
      `CREATE TABLE IF NOT EXISTS ai_training_rules (
        id TEXT PRIMARY KEY,
        title TEXT NOT NULL,
        rule_text TEXT NOT NULL,
        scope TEXT NOT NULL DEFAULT 'BOTH',
        is_enabled INTEGER NOT NULL DEFAULT 1,
        created_by_name TEXT NOT NULL DEFAULT 'Team',
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      )`,
    ],
    "write"
  );
  try {
    await conv.execute(
      `ALTER TABLE ai_training_examples ADD COLUMN guidance_type TEXT NOT NULL DEFAULT 'FIXED_ANSWER'`
    );
  } catch {
    // Column already exists on migrated databases
  }
}

export async function listAiTrainingData(): Promise<{
  examples: AiTrainingExampleRecord[];
  rules: AiTrainingRuleRecord[];
}> {
  await ensureAiTrainingTables();
  const conv = getRawLibSqlClient("conversations");
  const [exRes, ruleRes] = await Promise.all([
    conv.execute(
      `SELECT * FROM ai_training_examples ORDER BY CASE WHEN priority = 'HIGH' THEN 0 ELSE 1 END, updated_at DESC`
    ),
    conv.execute(`SELECT * FROM ai_training_rules ORDER BY updated_at DESC`),
  ]);

  return {
    examples: exRes.rows.map((r) => ({
      id: String(r.id),
      title: String(r.title || ""),
      category: String(r.category || "Product Knowledge"),
      guidanceType:
        String(r.guidance_type) === "INSTRUCTION"
          ? "INSTRUCTION"
          : "FIXED_ANSWER",
      customerQuestion: String(r.customer_question || ""),
      idealAnswer: String(r.ideal_answer || ""),
      doNotSay: String(r.do_not_say || ""),
      productSlug: String(r.product_slug || ""),
      priority: String(r.priority) === "HIGH" ? "HIGH" : "NORMAL",
      isEnabled: Number(r.is_enabled ?? 1) === 1,
      usageCount: Number(r.usage_count ?? 0),
      createdByName: String(r.created_by_name || "Team"),
      createdAt: String(r.created_at || ""),
      updatedAt: String(r.updated_at || ""),
    })),
    rules: ruleRes.rows.map((r) => ({
      id: String(r.id),
      title: String(r.title || ""),
      ruleText: String(r.rule_text || ""),
      scope:
        String(r.scope) === "CUSTOMER_CHAT" || String(r.scope) === "STAFF_COPILOT"
          ? (String(r.scope) as "CUSTOMER_CHAT" | "STAFF_COPILOT")
          : "BOTH",
      isEnabled: Number(r.is_enabled ?? 1) === 1,
      createdByName: String(r.created_by_name || "Team"),
      createdAt: String(r.created_at || ""),
      updatedAt: String(r.updated_at || ""),
    })),
  };
}

export async function upsertAiTrainingExample(params: {
  id?: string;
  title: string;
  category?: string;
  guidanceType?: "INSTRUCTION" | "FIXED_ANSWER";
  customerQuestion: string;
  idealAnswer: string;
  doNotSay?: string;
  productSlug?: string;
  priority?: "HIGH" | "NORMAL";
  isEnabled?: boolean;
  createdByName?: string;
}): Promise<AiTrainingExampleRecord> {
  await ensureAiTrainingTables();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const id = params.id?.trim() || `ait_${Math.random().toString(36).slice(2, 10)}`;
  const existing = params.id
    ? await conv.execute({ sql: `SELECT created_at, usage_count FROM ai_training_examples WHERE id = ?`, args: [id] })
    : { rows: [] as any[] };
  const createdAt = existing.rows[0]?.created_at ? String(existing.rows[0].created_at) : nowIso;
  const usageCount = Number(existing.rows[0]?.usage_count ?? 0);
  const guidanceType = params.guidanceType === "INSTRUCTION" ? "INSTRUCTION" : "FIXED_ANSWER";

  await conv.execute({
    sql: `INSERT INTO ai_training_examples (
      id, title, category, guidance_type, customer_question, ideal_answer, do_not_say, product_slug,
      priority, is_enabled, usage_count, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      category = excluded.category,
      guidance_type = excluded.guidance_type,
      customer_question = excluded.customer_question,
      ideal_answer = excluded.ideal_answer,
      do_not_say = excluded.do_not_say,
      product_slug = excluded.product_slug,
      priority = excluded.priority,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at`,
    args: [
      id,
      params.title.trim(),
      (params.category || "Product Knowledge").trim(),
      guidanceType,
      params.customerQuestion.trim(),
      params.idealAnswer.trim(),
      (params.doNotSay || "").trim(),
      (params.productSlug || "").trim(),
      params.priority === "HIGH" ? "HIGH" : "NORMAL",
      params.isEnabled === false ? 0 : 1,
      usageCount,
      (params.createdByName || "Team").trim(),
      createdAt,
      nowIso,
    ],
  });

  const { examples } = await listAiTrainingData();
  return examples.find((e) => e.id === id)!;
}

export async function deleteAiTrainingExample(id: string): Promise<void> {
  await ensureAiTrainingTables();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute({ sql: `DELETE FROM ai_training_examples WHERE id = ?`, args: [id] });
}

export async function upsertAiTrainingRule(params: {
  id?: string;
  title: string;
  ruleText: string;
  scope?: "BOTH" | "CUSTOMER_CHAT" | "STAFF_COPILOT";
  isEnabled?: boolean;
  createdByName?: string;
}): Promise<AiTrainingRuleRecord> {
  await ensureAiTrainingTables();
  const conv = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();
  const id = params.id?.trim() || `air_${Math.random().toString(36).slice(2, 10)}`;
  const existing = params.id
    ? await conv.execute({ sql: `SELECT created_at FROM ai_training_rules WHERE id = ?`, args: [id] })
    : { rows: [] as any[] };
  const createdAt = existing.rows[0]?.created_at ? String(existing.rows[0].created_at) : nowIso;

  await conv.execute({
    sql: `INSERT INTO ai_training_rules (
      id, title, rule_text, scope, is_enabled, created_by_name, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(id) DO UPDATE SET
      title = excluded.title,
      rule_text = excluded.rule_text,
      scope = excluded.scope,
      is_enabled = excluded.is_enabled,
      updated_at = excluded.updated_at`,
    args: [
      id,
      params.title.trim(),
      params.ruleText.trim(),
      params.scope || "BOTH",
      params.isEnabled === false ? 0 : 1,
      (params.createdByName || "Team").trim(),
      createdAt,
      nowIso,
    ],
  });

  const { rules } = await listAiTrainingData();
  return rules.find((r) => r.id === id)!;
}

export async function deleteAiTrainingRule(id: string): Promise<void> {
  await ensureAiTrainingTables();
  const conv = getRawLibSqlClient("conversations");
  await conv.execute({ sql: `DELETE FROM ai_training_rules WHERE id = ?`, args: [id] });
}

export async function findMatchingAiTrainingGuidance(params: {
  queryText: string;
  scope?: "CUSTOMER_CHAT" | "STAFF_COPILOT";
  activeProductSlug?: string | null;
}): Promise<{
  rules: AiTrainingRuleRecord[];
  examples: AiTrainingExampleRecord[];
  promptBlock: string;
}> {
  const { examples, rules } = await listAiTrainingData().catch(() => ({
    examples: [] as AiTrainingExampleRecord[],
    rules: [] as AiTrainingRuleRecord[],
  }));

  const targetScope = params.scope || "CUSTOMER_CHAT";
  const activeRules = rules.filter(
    (r) => r.isEnabled && (r.scope === "BOTH" || r.scope === targetScope)
  );

  const tokens = String(params.queryText || "")
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter((t) => t.length >= 3);
  const queryLower = String(params.queryText || "").toLowerCase();

  const scoredExamples = examples
    .filter((ex) => ex.isEnabled)
    .map((ex) => {
      let score = ex.priority === "HIGH" ? 2 : 0;
      if (
        params.activeProductSlug &&
        ex.productSlug &&
        ex.productSlug.toLowerCase() === params.activeProductSlug.toLowerCase()
      ) {
        score += 10;
      }
      const hay = `${ex.title} ${ex.category} ${ex.customerQuestion}`.toLowerCase();
      for (const tok of tokens) {
        if (hay.includes(tok)) score += 3;
      }
      if (ex.customerQuestion.toLowerCase().includes(queryLower) && queryLower.length >= 4) {
        score += 8;
      }
      return { ex, score };
    })
    .filter((x) => x.score >= 3 || x.ex.priority === "HIGH")
    .sort((a, b) => b.score - a.score)
    .slice(0, 6)
    .map((x) => x.ex);

  if (activeRules.length === 0 && scoredExamples.length === 0) {
    return { rules: [], examples: [], promptBlock: "" };
  }

  const lines: string[] = [];
  if (activeRules.length > 0) {
    lines.push("TEAM-TRAINED BEHAVIORAL RULES (MUST FOLLOW STRICTLY):");
    for (const r of activeRules.slice(0, 12)) {
      lines.push(`• ${r.title}: ${r.ruleText}`);
    }
  }
  const instructionExamples = scoredExamples.filter(
    (ex) => ex.guidanceType === "INSTRUCTION"
  );
  const fixedExamples = scoredExamples.filter(
    (ex) => ex.guidanceType !== "INSTRUCTION"
  );

  if (instructionExamples.length > 0) {
    lines.push(
      "TEAM-TRAINED SITUATION INSTRUCTIONS (WHEN THE MESSAGE OR SITUATION MATCHES, FOLLOW THESE ACTIONS AND ADAPT YOUR REPLY NATURALLY. NEVER TREAT THESE INSTRUCTIONS AS A VERBATIM SCRIPT.):"
    );
    for (const ex of instructionExamples) {
      lines.push(
        `• Situation (${ex.title} | ${ex.category}): When triggered by "${ex.customerQuestion}"\n  What ACRIO MUST DO (Action Instruction): ${ex.idealAnswer}${ex.doNotSay ? `\n  DO NOT DO OR SAY: ${ex.doNotSay}` : ""}`
      );
    }
  }

  if (fixedExamples.length > 0) {
    lines.push("TEAM-TRAINED Q&A EXAMPLES (USE AS OFFICIAL REFERENCE ANSWERS):");
    for (const ex of fixedExamples) {
      lines.push(
        `• Q (${ex.title}): "${ex.customerQuestion}"\n  Ideal Answer: ${ex.idealAnswer}${ex.doNotSay ? `\n  DO NOT SAY: ${ex.doNotSay}` : ""}`
      );
    }
  }

  return {
    rules: activeRules,
    examples: scoredExamples,
    promptBlock: lines.join("\n"),
  };
}
