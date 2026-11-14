import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import nodemailer from "nodemailer";
import {
  ensureDatabasesBootstrapped,
  fetchClassicCatalogProducts,
  getRawLibSqlClient,
  resolveBackupDirectory,
  snapshotAllDatabasesToFolder,
} from "@cc/database";
import { socketHub } from "@cc/sockets";

const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;

function sanitizePlainEnglish(text: string): string {
  return text
    .replace(/\u2014/g, ", ")
    .replace(/\s+\u2013\s+/g, ", ")
    .replace(/--+/g, ", ")
    .replace(/\bbespoke\b/gi, "custom-made")
    .replace(/\bmeticulous(?:ly)?\b/gi, "careful")
    .replace(/\bseamless(?:ly)?\b/gi, "smooth")
    .replace(/\butilize\b/gi, "use")
    .replace(/\bleverage\b/gi, "use")
    .replace(/\bstate-of-the-art\b/gi, "modern")
    .replace(/\s{2,}/g, " ")
    .trim();
}

// ============================================================================
// 1. META WHATSAPP CLOUD API CONNECTOR + SANDBOX SIMULATOR
// ============================================================================
export interface OutboundWhatsAppSendResult {
  ok: boolean;
  waMessageId: string;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  deliveryStatus: "SENT" | "DELIVERED" | "FAILED";
  error?: string;
}

export async function sendWhatsAppCloudMessage(params: {
  toPhone: string;
  bodyText: string;
  templateName?: string;
  languageCode?: string;
}): Promise<OutboundWhatsAppSendResult> {
  await ensureDatabasesBootstrapped();
  const auth = getRawLibSqlClient("core_auth");
  const cfgRes = await auth.execute(
    `SELECT value_json FROM setup_state WHERE key = 'facebook_whatsapp_config' LIMIT 1`
  );

  let cfg: Record<string, unknown> = {};
  if (cfgRes.rows[0]?.value_json) {
    try {
      cfg = JSON.parse(String(cfgRes.rows[0].value_json));
    } catch {
      cfg = {};
    }
  }

  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const phoneNumberId = String(cfg.phoneNumberId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const recipientDigits = params.toPhone.replace(/\D/g, "");

  if (mode === "LIVE_META_CLOUD" && phoneNumberId && accessToken) {
    try {
      const payload = params.templateName
        ? {
            messaging_product: "whatsapp",
            to: recipientDigits,
            type: "template",
            template: {
              name: params.templateName,
              language: { code: params.languageCode || "en" },
            },
          }
        : {
            messaging_product: "whatsapp",
            recipient_type: "individual",
            to: recipientDigits,
            type: "text",
            text: { preview_url: true, body: params.bodyText },
          };

      const res = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(phoneNumberId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(payload),
          signal: AbortSignal.timeout(15000),
        }
      );

      const data: any = await res.json().catch(() => ({}));
      if (!res.ok) {
        return {
          ok: false,
          waMessageId: "",
          mode: "LIVE_META_CLOUD",
          deliveryStatus: "FAILED",
          error: data?.error?.message || `Meta Graph HTTP ${res.status}`,
        };
      }

      const waId =
        String(data?.messages?.[0]?.id || "") ||
        `wamid.live_${crypto.randomUUID().slice(0, 12)}`;
      return {
        ok: true,
        waMessageId: waId,
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "SENT",
      };
    } catch (err: any) {
      return {
        ok: false,
        waMessageId: "",
        mode: "LIVE_META_CLOUD",
        deliveryStatus: "FAILED",
        error: err?.message || "Meta Cloud network error",
      };
    }
  }

  // Sandbox Simulator Mode: generates authentic wamid and simulates DELIVERED status
  const simulatedId = `wamid.sim_${Date.now()}_${crypto.randomBytes(4).toString("hex")}`;
  return {
    ok: true,
    waMessageId: simulatedId,
    mode: "SANDBOX_SIMULATOR",
    deliveryStatus: "DELIVERED",
  };
}

export function verifyMetaWebhookSignature(
  rawBody: string,
  signatureHeader: string | null,
  appSecret: string
): boolean {
  if (!appSecret) return true;
  if (!signatureHeader || !signatureHeader.startsWith("sha256=")) return false;
  const expected =
    "sha256=" +
    crypto.createHmac("sha256", appSecret).update(rawBody, "utf8").digest("hex");
  try {
    return crypto.timingSafeEqual(
      Buffer.from(signatureHeader),
      Buffer.from(expected)
    );
  } catch {
    return false;
  }
}

// ============================================================================
// 2. ACRIO WHATSAPP AI CO-PILOT (Chat Replies, Smart Resolutions & Marketing Lists)
// ============================================================================
export interface AcrioChatCopilotResult {
  engineLabel: string;
  smartCategory: string;
  priority: "URGENT" | "HIGH" | "NORMAL" | "LOW";
  suggestedReplies: string[];
  recommendedProducts: {
    name: string;
    slug: string;
    sku: string | null;
    priceInr: number | null;
    url: string;
  }[];
  resolutionDraft: string;
}

export async function runAcrioChatCopilot(params: {
  customerName: string;
  organizationType?: string;
  recentMessages: { direction: string; body: string }[];
  ordersSummary?: string[];
}): Promise<AcrioChatCopilotResult> {
  const lastInbound =
    [...params.recentMessages]
      .reverse()
      .find((m) => m.direction === "INBOUND")?.body ||
    params.recentMessages[params.recentMessages.length - 1]?.body ||
    "";

  const lower = lastInbound.toLowerCase();
  const catalog = await fetchClassicCatalogProducts(lastInbound, 3);

  // Smart intent & category classification
  let smartCategory = "General Enquiry";
  let priority: AcrioChatCopilotResult["priority"] = "NORMAL";

  if (/podium|lectern|pulpit|stage|auditorium|conference/i.test(lower)) {
    smartCategory = "Podiums & Stage";
    priority = /friday|urgent|tomorrow|week/i.test(lower) ? "URGENT" : "HIGH";
  } else if (/trophy|trophies|memento|award|student|convocation|plaque/i.test(lower)) {
    smartCategory = "Awards & Trophies";
    priority = /\b\d{2,4}\b|bulk/i.test(lower) ? "HIGH" : "NORMAL";
  } else if (/hotel|banquet|menu|qr|resort|hospitality/i.test(lower)) {
    smartCategory = "Hotel & Banquet";
    priority = "HIGH";
  } else if (/cover|guard|enclosure|cnc|drawing|custom|mm|inch/i.test(lower)) {
    smartCategory = "Custom Fabrication";
    priority = "HIGH";
  } else if (/order|dispatch|delivery|invoice|advance|payment/i.test(lower)) {
    smartCategory = "Order & Delivery";
  }

  const firstName = params.customerName.split(/[\s(]/)[0] || "there";
  const topProduct = catalog[0];

  const apiKey =
    process.env.ANTHROPIC_ADMIN_API_KEY ||
    process.env.ANTHROPIC_CLIENT_API_KEY ||
    "";

  if (apiKey) {
    try {
      const response = await fetch("https://api.anthropic.com/v1/messages", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-api-key": apiKey,
          "anthropic-version": "2023-06-01",
        },
        body: JSON.stringify({
          model: LOCKED_CLAUDE_MODEL,
          max_tokens: 450,
          temperature: 0.2,
          system: `You are ACRIO, Classic Concepts' WhatsApp Staff Assistant running on Claude Haiku 5.5.
Write strictly in simple everyday layman English. NEVER use em dashes ("—"), "--", or robotic AI words (bespoke, meticulous, seamless, leverage, utilize).
Return ONLY valid JSON:
{
  "smartCategory": "Podiums & Stage | Awards & Trophies | Hotel & Banquet | Custom Fabrication | Order & Delivery | General Enquiry",
  "priority": "URGENT | HIGH | NORMAL",
  "suggestedReplies": ["Short warm WhatsApp reply 1", "Reply option 2 with product/link", "Reply option 3 asking size/quantity"],
  "resolutionDraft": "1-2 plain English sentences summarizing chat resolution"
}`,
          messages: [
            {
              role: "user",
              content: `Customer: ${params.customerName} (${params.organizationType || "Client"})
Past orders: ${(params.ordersSummary || []).join("; ") || "None yet"}
Matching catalog items: ${catalog.map((c) => `${c.name} (${c.basePrice ? `Rs ${c.basePrice}` : "Price on Request"}, /shop/p/${c.slug})`).join("; ")}
Recent chat:
${params.recentMessages.slice(-5).map((m) => `${m.direction}: ${m.body}`).join("\n")}`,
            },
          ],
        }),
        signal: AbortSignal.timeout(10000),
      });

      if (response.ok) {
        const json: any = await response.json();
        const text = json?.content?.[0]?.text || "";
        const start = text.indexOf("{");
        const end = text.lastIndexOf("}");
        if (start !== -1 && end > start) {
          const parsed = JSON.parse(text.slice(start, end + 1));
          if (Array.isArray(parsed.suggestedReplies) && parsed.suggestedReplies.length > 0) {
            return {
              engineLabel: "Claude Haiku 5.5 • Live AI",
              smartCategory: parsed.smartCategory || smartCategory,
              priority: parsed.priority || priority,
              suggestedReplies: parsed.suggestedReplies
                .slice(0, 3)
                .map((s: string) => sanitizePlainEnglish(s)),
              recommendedProducts: catalog.map((c) => ({
                name: c.name,
                slug: c.slug,
                sku: c.sku,
                priceInr: c.basePrice,
                url: `https://www.classicconcepts.in/shop/p/${c.slug}`,
              })),
              resolutionDraft: sanitizePlainEnglish(
                parsed.resolutionDraft ||
                  `Assisted ${firstName} with ${smartCategory.toLowerCase()} options and shared catalog details.`
              ),
            };
          }
        }
      }
    } catch {
      // Fall through cleanly to local ACRIO Smart Catalog Engine
    }
  }

  // Instant Plain-English ACRIO Local Drafts tailored to the conversation
  const localReplies: string[] = [];
  if (smartCategory === "Podiums & Stage") {
    localReplies.push(
      `Hi ${firstName}! Yes, we have wide-top clear stage podiums ready and can add your front logo before dispatch. Shall I share our ready models and sizes?`,
      `Hello ${firstName}, here is our podium collection link: https://whatsapp.ccapl.cc/l/stage-podiums. Let us know your preferred height or logo file and we will confirm delivery.`,
      `Hi ${firstName}, our team checked stock availability. Share your event date and delivery city so we can reserve it right away.`
    );
  } else if (smartCategory === "Awards & Trophies") {
    localReplies.push(
      `Hello ${firstName}! For student and event awards, we have clear acrylic mementos and plaques within your budget, including logo printing: https://whatsapp.ccapl.cc/l/student-awards`,
      `Hi ${firstName}, please share the total quantity and event date, plus your logo file, so we can send 3 matching trophy designs with bulk pricing.`,
      topProduct
        ? `Hello ${firstName}, our ${topProduct.name}${topProduct.basePrice ? ` (Rs ${topProduct.basePrice})` : ""} is very popular for ceremonies. Would you like a sample layout with your logo?`
        : `Hello ${firstName}, we can print your institution logo and student names on clear acrylic awards. What quantity do you need?`
    );
  } else if (smartCategory === "Custom Fabrication") {
    localReplies.push(
      `Hello ${firstName}! Please share the exact length, width, height, and thickness in mm (or a rough sketch) and our production desk will send a quote.`,
      `Hi ${firstName}, thank you for confirming! Once the advance is received, we will share the final size sheet for your approval before making it.`,
      `Hello ${firstName}, we make clear acrylic covers and boxes to exact measurements. Let us know how many pieces you need.`
    );
  } else {
    localReplies.push(
      `Hello ${firstName}! Thank you for messaging Classic Concepts. Tell us the item, size, or quantity you need and I will share the closest options right away.`,
      topProduct
        ? `Hi ${firstName}, based on your message, take a look at ${topProduct.name}: https://www.classicconcepts.in/shop/p/${topProduct.slug}`
        : `Hi ${firstName}, here is our main catalog link: https://whatsapp.ccapl.cc/l/stage-podiums. Let me know if you need podiums, stands, boxes, or awards!`,
      `Hi ${firstName}, I am checking this with our production team and will update you shortly.`
    );
  }

  return {
    engineLabel: "ACRIO",
    smartCategory,
    priority,
    suggestedReplies: localReplies.map(sanitizePlainEnglish),
    recommendedProducts: catalog.map((c) => ({
      name: c.name,
      slug: c.slug,
      sku: c.sku,
      priceInr: c.basePrice,
      url: `https://www.classicconcepts.in/shop/p/${c.slug}`,
    })),
    resolutionDraft: sanitizePlainEnglish(
      `Shared ${smartCategory.toLowerCase()} options and pricing details with ${params.customerName}, and updated customer follow-up notes.`
    ),
  };
}

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
  await ensureDatabasesBootstrapped();
  const crm = getRawLibSqlClient("crm_orders");
  const res = await crm.execute(
    `SELECT * FROM customers WHERE opt_in_marketing = 1 ORDER BY lifetime_value_inr DESC`
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
    filterExplanation: sanitizePlainEnglish(
      `Matched ${filtered.length} opted-in contacts based on organization category, past order history, and ACRIO conversation tags.`
    ),
  };
}

// ============================================================================
// 3. GOOGLE DRIVE MIDNIGHT MULTI-DB BACKUP CONNECTOR
// ============================================================================
async function getGoogleDriveAccessToken(cfg: {
  serviceAccountEmail: string;
  privateKey: string;
  oauthRefreshToken: string;
  clientId: string;
  clientSecret: string;
}): Promise<string | null> {
  // Option A: OAuth2 Refresh Token
  if (cfg.oauthRefreshToken && cfg.clientId && cfg.clientSecret) {
    const body = new URLSearchParams({
      client_id: cfg.clientId,
      client_secret: cfg.clientSecret,
      refresh_token: cfg.oauthRefreshToken,
      grant_type: "refresh_token",
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  // Option B: Google Service Account JWT (RS256)
  if (cfg.serviceAccountEmail && cfg.privateKey) {
    const nowSec = Math.floor(Date.now() / 1000);
    const header = Buffer.from(
      JSON.stringify({ alg: "RS256", typ: "JWT" })
    ).toString("base64url");
    const claim = Buffer.from(
      JSON.stringify({
        iss: cfg.serviceAccountEmail,
        scope: "https://www.googleapis.com/auth/drive.file",
        aud: "https://oauth2.googleapis.com/token",
        exp: nowSec + 3600,
        iat: nowSec,
      })
    ).toString("base64url");
    const normalizedKey = cfg.privateKey.replace(/\\n/g, "\n");
    const signer = crypto.createSign("RSA-SHA256");
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(normalizedKey, "base64url");
    const assertion = `${header}.${claim}.${signature}`;

    const body = new URLSearchParams({
      grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer",
      assertion,
    });
    const res = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (res.ok) {
      const json: any = await res.json();
      if (json.access_token) return String(json.access_token);
    }
  }

  return null;
}

export async function executeMultiDatabaseBackup(
  triggerSource: "MIDNIGHT_CRON" | "MANUAL_DEV"
): Promise<{
  ok: boolean;
  status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" | "FAILED";
  databasesCount: number;
  totalBytes: number;
  localFolderPath: string;
  googleDriveFileId?: string;
  googleDriveLink?: string;
  detailsMessage: string;
}> {
  await ensureDatabasesBootstrapped();
  const bill = getRawLibSqlClient("billing_ops");
  const startedAt = new Date().toISOString();
  const stamp = startedAt.replace(/[:.]/g, "-");
  const backupRoot = resolveBackupDirectory();
  const runFolder = path.join(backupRoot, `snapshot_${stamp}`);

  try {
    const cfgRes = await bill.execute(
      `SELECT * FROM backup_settings WHERE id = 'default' LIMIT 1`
    );
    const cfg = (cfgRes.rows[0] || {}) as Record<string, unknown>;
    const includeMain = Number(cfg.include_main_website_db ?? 1) === 1;
    const retentionDays = Math.max(1, Number(cfg.retention_days ?? 30));

    const snap = await snapshotAllDatabasesToFolder(runFolder, includeMain);

    // Bundle all SQLite snapshots into a compressed .json.gz archive ready for Google Drive upload
    const bundlePayload = {
      createdAt: startedAt,
      triggerSource,
      databases: snap.files.map((f) => ({
        domain: f.domain,
        fileName: path.basename(f.filePath),
        sizeBytes: f.sizeBytes,
        base64: fs.readFileSync(f.filePath).toString("base64"),
      })),
    };
    const compressedArchive = zlib.gzipSync(
      Buffer.from(JSON.stringify(bundlePayload), "utf8")
    );
    const archiveName = `ccwhatsapp_libsql_backup_${stamp}.json.gz`;
    const archivePath = path.join(runFolder, archiveName);
    fs.writeFileSync(archivePath, compressedArchive);

    let status: "UPLOADED_TO_GDRIVE" | "SAVED_LOCAL_SNAPSHOT" =
      "SAVED_LOCAL_SNAPSHOT";
    let gdriveFileId: string | undefined;
    let gdriveLink: string | undefined;
    let detailsMessage = `Saved backup of ${snap.files.length} databases (${(
      snap.totalBytes / 1024
    ).toFixed(1)} KB) on server. Add Google Drive settings below to upload automatically every midnight.`;

    const token = await getGoogleDriveAccessToken({
      serviceAccountEmail: String(cfg.google_service_account_email || "").trim(),
      privateKey: String(cfg.google_private_key || "").trim(),
      oauthRefreshToken: String(cfg.google_oauth_refresh_token || "").trim(),
      clientId: String(cfg.google_client_id || "").trim(),
      clientSecret: String(cfg.google_client_secret || "").trim(),
    }).catch(() => null);

    if (token) {
      const folderId = String(cfg.google_drive_folder_id || "").trim();
      const metadata = {
        name: archiveName,
        mimeType: "application/gzip",
        ...(folderId ? { parents: [folderId] } : {}),
      };
      const boundary = `ccbackup_${crypto.randomBytes(8).toString("hex")}`;
      const multipartBody = Buffer.concat([
        Buffer.from(
          `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(
            metadata
          )}\r\n--${boundary}\r\nContent-Type: application/gzip\r\n\r\n`,
          "utf8"
        ),
        compressedArchive,
        Buffer.from(`\r\n--${boundary}--`, "utf8"),
      ]);

      const upRes = await fetch(
        "https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,webViewLink",
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${token}`,
            "Content-Type": `multipart/related; boundary=${boundary}`,
          },
          body: multipartBody,
          signal: AbortSignal.timeout(30000),
        }
      );

      if (upRes.ok) {
        const upJson: any = await upRes.json();
        gdriveFileId = String(upJson.id || "");
        gdriveLink = upJson.webViewLink ? String(upJson.webViewLink) : undefined;
        status = "UPLOADED_TO_GDRIVE";
        detailsMessage = `Uploaded ${snap.files.length} databases (${(
          compressedArchive.length / 1024
        ).toFixed(1)} KB) to Google Drive.`;
      } else {
        const errTxt = await upRes.text().catch(() => "");
        detailsMessage = `Saved local backup (${snap.files.length} databases), but Google Drive upload returned HTTP ${upRes.status}: ${errTxt.slice(0, 140)}`;
      }
    }

    // Prune local snapshots older than retentionDays
    const cutoffMs = Date.now() - retentionDays * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(backupRoot, { withFileTypes: true })) {
      if (entry.isDirectory() && entry.name.startsWith("snapshot_")) {
        const full = path.join(backupRoot, entry.name);
        const st = fs.statSync(full);
        if (st.mtimeMs < cutoffMs) {
          fs.rmSync(full, { recursive: true, force: true });
        }
      }
    }

    const completedAt = new Date().toISOString();
    await bill.batch(
      [
        {
          sql: `INSERT INTO backup_logs (
            id, started_at, completed_at, trigger_source, status, databases_count,
            total_bytes, local_folder_path, google_drive_file_id, google_drive_link, details_message
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          args: [
            `bkp_${crypto.randomUUID().slice(0, 8)}`,
            startedAt,
            completedAt,
            triggerSource,
            status,
            snap.files.length,
            snap.totalBytes,
            runFolder,
            gdriveFileId || null,
            gdriveLink || null,
            detailsMessage,
          ],
        },
        {
          sql: `UPDATE backup_settings SET last_run_at = ?, last_run_status = ?, updated_at = ? WHERE id = 'default'`,
          args: [completedAt, status, completedAt],
        },
      ],
      "write"
    );

    socketHub.emit("backup:completed", {
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      completedAt,
    });

    return {
      ok: true,
      status,
      databasesCount: snap.files.length,
      totalBytes: snap.totalBytes,
      localFolderPath: runFolder,
      googleDriveFileId: gdriveFileId,
      googleDriveLink: gdriveLink,
      detailsMessage,
    };
  } catch (err: any) {
    const completedAt = new Date().toISOString();
    const msg = err?.message || "Backup error";
    await bill.execute({
      sql: `INSERT INTO backup_logs (
        id, started_at, completed_at, trigger_source, status, databases_count,
        total_bytes, local_folder_path, details_message
      ) VALUES (?, ?, ?, ?, 'FAILED', 0, 0, ?, ?)`,
      args: [
        `bkp_${crypto.randomUUID().slice(0, 8)}`,
        startedAt,
        completedAt,
        triggerSource,
        runFolder,
        msg,
      ],
    });
    return {
      ok: false,
      status: "FAILED",
      databasesCount: 0,
      totalBytes: 0,
      localFolderPath: runFolder,
      detailsMessage: msg,
    };
  }
}

// ============================================================================
// 4. STAFF EMAIL OTP DELIVERY CONNECTOR
// ============================================================================
export async function sendStaffVerificationEmail(params: {
  email: string;
  staffName: string;
  otpCode: string;
}): Promise<{ deliveredViaSmtp: boolean; devPreviewCode?: string }> {
  const host = process.env.SMTP_HOST?.trim();
  const user = process.env.SMTP_USER?.trim();
  const pass = process.env.SMTP_PASS?.trim();

  if (host && user && pass) {
    try {
      const transporter = nodemailer.createTransport({
        host,
        port: Number(process.env.SMTP_PORT || 587),
        secure: Number(process.env.SMTP_PORT || 587) === 465,
        auth: { user, pass },
      });

      await transporter.sendMail({
        from: process.env.SMTP_FROM || `"Classic Concepts WhatsApp Hub" <${user}>`,
        to: params.email,
        subject: `${params.otpCode} is your Classic Concepts Staff Verification Code`,
        text: `Hello ${params.staffName},\n\nYour 6-digit email verification code for Classic Concepts WhatsApp Staff Hub is: ${params.otpCode}\n\nThis code is valid for 15 minutes. Once verified, your account will be sent to a Superadmin/Dev for final activation.\n`,
      });
      return { deliveredViaSmtp: true };
    } catch {
      return { deliveredViaSmtp: false, devPreviewCode: params.otpCode };
    }
  }

  return { deliveredViaSmtp: false, devPreviewCode: params.otpCode };
}
