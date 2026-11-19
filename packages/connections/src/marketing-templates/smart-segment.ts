import {
  ensureDatabasesBootstrapped,
  getRawLibSqlClient,
  resolveSharedAnthropicApiKey,
  type AiTokenUsage,
  type AiTraceStep,
} from "@cc/database";
import {
  LOCKED_CLAUDE_MODEL,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  recordAndBroadcastAiLog,
  sanitizePlainEnglish,
} from "@cc/connections/initialise.acrio.ai";

export async function buildAcrioSmartMarketingSegment(prompt: string): Promise<{
  suggestedName: string;
  description: string;
  matchedCustomers: {
    id: string;
    name: string;
    phone: string;
    companyName: string | null;
    organizationType: string | null;
    acrioSegment: string;
    lifetimeValueInr: number;
  }[];
  filterExplanation: string;
}> {
  const started = Date.now();
  const steps: AiTraceStep[] = [];
  await ensureDatabasesBootstrapped();
  const crm = getRawLibSqlClient("crm_orders");
  const res = await crm.execute(
    `SELECT id, name, phone, company_name, organization_type, acrio_segment, tags_json, notes, lifetime_value_inr FROM customers WHERE opt_in_marketing = 1 ORDER BY lifetime_value_inr DESC`
  );

  const p = prompt.trim().toLowerCase();
  const all = res.rows.map((r) => ({
    id: String(r.id),
    name: String(r.name),
    phone: String(r.phone),
    companyName: r.company_name ? String(r.company_name) : null,
    organizationType: r.organization_type ? String(r.organization_type) : null,
    acrioSegment: String(r.acrio_segment || ""),
    tagsJson: String(r.tags_json || "[]"),
    notes: String(r.notes || ""),
    lifetimeValueInr: Number(r.lifetime_value_inr ?? 0),
  }));

  steps.push({
    stepNumber: 1,
    label: "Loaded opted-in CRM contacts",
    detail: `${all.length} opted-in contacts scanned`,
    durationMs: Date.now() - started,
    status: "OK",
  });

  const minLtvMatch = p.match(/(?:over|above|more than)\s*(?:rs\.?|inr|₹)?\s*(\d{3,7})/i);
  const minLtv = minLtvMatch ? Number(minLtvMatch[1]) : 0;

  let filtered = all.filter((c) => {
    if (minLtv > 0 && c.lifetimeValueInr < minLtv) return false;
    const blob =
      `${c.name} ${c.companyName || ""} ${c.organizationType || ""} ${c.acrioSegment} ${c.tagsJson} ${c.notes}`.toLowerCase();

    if (/hotel|banquet|hospitality|resort|menu/.test(p)) {
      return /hotel|banquet|hospitality|resort|menu/.test(blob);
    }
    if (/school|college|student|education|award|trophy|memento|convocation/.test(p)) {
      return /school|college|student|education|award|trophy|convocation/.test(blob);
    }
    if (/engineer|industrial|machine|cnc|custom|enclosure|cover/.test(p)) {
      return /engineer|industrial|machine|cnc|custom|enclosure|guard/.test(blob);
    }
    if (/vip|repeat|high value/.test(p)) {
      return c.lifetimeValueInr >= 30000 || /vip|repeat/.test(blob);
    }
    return true;
  });

  if (filtered.length === 0) {
    filtered = all;
  }

  let suggestedName = "ACRIO Targeted Segment";
  if (/hotel|banquet/.test(p)) suggestedName = "ACRIO: Hotels & Banquet Buyers";
  else if (/school|college|student|award/.test(p))
    suggestedName = "ACRIO: Schools, Colleges & Award Leads";
  else if (/engineer|custom|cnc/.test(p))
    suggestedName = "ACRIO: Industrial & Custom Fabrication Clients";
  else if (/vip|repeat/.test(p)) suggestedName = "ACRIO: High-Value Repeat Clients";

  let filterExplanation = `Matched ${filtered.length} opted-in contacts based on organization category, past order history, and ACRIO conversation tags.`;
  let usedLiveAi = false;
  let usage: AiTokenUsage | null = null;
  let aiErr: string | null = null;

  const { apiKey: adminApiKey } = await resolveSharedAnthropicApiKey("admin");
  if (adminApiKey && prompt.trim().length > 6 && all.length > 0) {
    const aiCall = await callClaudeHaikuMessagesDetailed({
      apiKey: adminApiKey,
      maxTokens: 1600,
      effort: "medium",
      timeoutMs: 20000,
      system: `You are ACRIO Admin Assistant for Classic Concepts. Write in plain everyday English (zero em-dashes, zero buzzwords). Given a marketing list prompt and CRM contacts, pick matching contact IDs and return ONLY valid JSON: {"suggestedName": "Short Clear List Name", "matchedIds": ["id1"], "explanation": "Short plain explanation"}`,
      messages: [
        {
          role: "user",
          content: `Prompt: ${prompt.trim()}\nOpted-in contacts:\n${all
            .slice(0, 40)
            .map(
              (c) =>
                `${c.id} | ${c.name} | ${c.organizationType || ""} | ${c.acrioSegment} | ₹${c.lifetimeValueInr}`
            )
            .join("\n")}`,
        },
      ],
    });
    usage = aiCall.usage;
    if (aiCall.ok && aiCall.text) {
      const parsed = parseClaudeJson<any>(aiCall.text);
      if (parsed) {
        usedLiveAi = true;
        if (Array.isArray(parsed.matchedIds) && parsed.matchedIds.length > 0) {
          const idSet = new Set(parsed.matchedIds.map(String));
          const aiMatched = all.filter((c) => idSet.has(c.id));
          if (aiMatched.length > 0) {
            filtered = aiMatched;
          }
        }
        if (typeof parsed.suggestedName === "string" && parsed.suggestedName.trim()) {
          suggestedName = sanitizePlainEnglish(parsed.suggestedName.trim());
        }
        if (typeof parsed.explanation === "string" && parsed.explanation.trim()) {
          filterExplanation = sanitizePlainEnglish(parsed.explanation.trim());
        }
        steps.push({
          stepNumber: 2,
          label: "Refined segment with Claude Haiku 5.5 (effort=medium)",
          detail: `Selected ${filtered.length} contacts ("${suggestedName}")`,
          durationMs: Date.now() - started,
          status: "OK",
        });
      }
    } else {
      aiErr = aiCall.error;
      steps.push({
        stepNumber: 2,
        label: "Claude segment refinement fallback",
        detail: aiErr || "Used deterministic CRM filter",
        durationMs: Date.now() - started,
        status: "WARN",
      });
    }
  }

  recordAndBroadcastAiLog({
    website: "WHATSAPP_HUB",
    websiteLabel: "Classic Concepts WhatsApp Hub",
    feature: "ACRIO Smart Audience Segmenter",
    actor: "Marketing Admin",
    question: prompt.trim(),
    model: usedLiveAi ? LOCKED_CLAUDE_MODEL : "local-crm-filter",
    effort: usedLiveAi ? "medium" : undefined,
    outcomeSource: usedLiveAi ? "LIVE_AI" : "LOCAL_FALLBACK",
    responseCacheStatus: "BYPASS",
    catalogCacheStatus: "BYPASS",
    cacheDetails: `Scanned ${all.length} opted-in CRM contacts directly`,
    productLookupTriggered: false,
    productLookupQuery: "",
    productLookupTotalScanned: 0,
    productsLookedUp: [],
    steps,
    response: `${suggestedName} (${filtered.length} contacts): ${filterExplanation}`,
    durationMs: Date.now() - started,
    tokenUsage: usage,
    error: aiErr,
  });

  return {
    suggestedName,
    description: sanitizePlainEnglish(
      `Built by ACRIO from prompt "${prompt.trim()}" (${filtered.length} opted-in WhatsApp contacts matched).`
    ),
    matchedCustomers: filtered.map((c) => ({
      id: c.id,
      name: c.name,
      phone: c.phone,
      companyName: c.companyName,
      organizationType: c.organizationType,
      acrioSegment: c.acrioSegment,
      lifetimeValueInr: c.lifetimeValueInr,
    })),
    filterExplanation: sanitizePlainEnglish(filterExplanation),
  };
}
