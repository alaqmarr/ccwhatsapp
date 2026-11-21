import crypto from "node:crypto";
import { getRawLibSqlClient } from "@cc/database";
import { loadMetaWhatsAppSetupConfig } from "./config";
import { uploadSampleMediaForTemplateHeader } from "./media";
import {
  buildMetaGraphTemplatePayload,
  validateWhatsAppTemplateRules,
} from "./templates-validation";
import type {
  WhatsAppTemplateButton,
  WhatsAppTemplateCategory,
  WhatsAppTemplateDefinition,
} from "./types";

export async function submitTemplateToMetaCloud(
  tpl: WhatsAppTemplateDefinition
): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  metaTemplateId: string;
  approvalStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" | "DRAFT";
  message: string;
  error?: string;
  effectiveCategory?: WhatsAppTemplateCategory;
  effectiveBodyText?: string;
  effectiveFooterText?: string | null;
  effectiveButtons?: WhatsAppTemplateButton[];
}> {
  const validation = validateWhatsAppTemplateRules(tpl);
  if (!validation.valid) {
    return {
      ok: false,
      mode: "SANDBOX_SIMULATOR",
      metaTemplateId: "",
      approvalStatus: "REJECTED",
      message: validation.errors[0],
      error: validation.errors.join(" "),
    };
  }

  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const metaAppId = String(cfg.metaAppId || "").trim();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let resolvedHeaderHandle: string | undefined;
      if (
        (tpl.headerType === "IMAGE" ||
          tpl.headerType === "VIDEO" ||
          tpl.headerType === "DOCUMENT") &&
        tpl.headerMediaUrl?.trim()
      ) {
        resolvedHeaderHandle = await uploadSampleMediaForTemplateHeader({
          mediaUrl: tpl.headerMediaUrl.trim(),
          headerType: tpl.headerType,
          accessToken,
          metaAppId,
        });
      }

      const metaPayload = buildMetaGraphTemplatePayload(
        tpl,
        resolvedHeaderHandle
      );

      const response = await fetch(
        `https://graph.facebook.com/v21.0/${encodeURIComponent(
          wabaId
        )}/message_templates`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${accessToken}`,
            "Content-Type": "application/json",
          },
          body: JSON.stringify(metaPayload),
          signal: AbortSignal.timeout(20000),
        }
      );
      const data: any = await response.json().catch(() => ({}));

      if (!response.ok) {
        const subcode = Number(data?.error?.error_subcode || 0);
        const rawErrMsg = String(
          data?.error?.error_user_msg ||
            data?.error?.message ||
            `Meta Graph HTTP ${response.status}`
        );

        if (
          tpl.category === "AUTHENTICATION" &&
          (subcode === 2388185 ||
            /permission to create message template/i.test(rawErrMsg))
        ) {
          return {
            ok: true,
            mode: "LIVE_META_CLOUD",
            metaTemplateId: "",
            approvalStatus: "DRAFT",
            message:
              "Saved as Draft: Meta has temporarily paused Authentication (OTP) template creation on this WhatsApp Business Account until display name approval completes. Marketing and Utility templates submit normally right now.",
          };
        }

        const friendlyError =
          subcode === 2388185
            ? `${rawErrMsg}. Check in Meta Business Settings that your System User token has Full Control on WhatsApp Business Account ${wabaId}.`
            : rawErrMsg;

        return {
          ok: false,
          mode: "LIVE_META_CLOUD",
          metaTemplateId: "",
          approvalStatus: "REJECTED",
          message: friendlyError,
          error: friendlyError,
        };
      }

      const rawStatus = String(data?.status || "PENDING").toUpperCase();
      const mappedStatus: "APPROVED" | "PENDING_APPROVAL" | "REJECTED" =
        rawStatus === "APPROVED"
          ? "APPROVED"
          : rawStatus === "REJECTED"
          ? "REJECTED"
          : "PENDING_APPROVAL";

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: String(data?.id || `meta_${Date.now()}`),
        approvalStatus: mappedStatus,
        message:
          mappedStatus === "APPROVED"
            ? "Template approved immediately by Meta!"
            : "Submitted to Meta for review. Only Meta-approved templates can be sent.",
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        metaTemplateId: "",
        approvalStatus: "REJECTED",
        message: err?.message || "Could not connect to Meta Graph API.",
        error: err?.message || "Could not connect to Meta Graph API.",
      };
    }
  }

  const allowDemoApproval =
    process.env.SEED_DEMO_DATA === "1" ||
    process.env.WHATSAPP_ALLOW_SANDBOX_TEMPLATE_APPROVAL === "1";

  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    metaTemplateId: allowDemoApproval
      ? `sim_tpl_${crypto.randomBytes(5).toString("hex")}`
      : "",
    approvalStatus: allowDemoApproval ? "APPROVED" : "DRAFT",
    message: allowDemoApproval
      ? "Validated template rules in demo sandbox."
      : "Template saved as a verified Draft (with button flows). Connect your live Meta WABA ID & System Access Token in Facebook Setup to submit for official Meta approval before sending.",
  };
}

export async function syncTemplatesFromMetaCloud(): Promise<{
  ok: boolean;
  mode: "LIVE_META_CLOUD" | "SANDBOX_SIMULATOR";
  syncedCount: number;
  message: string;
}> {
  const cfg = await loadMetaWhatsAppSetupConfig();
  const mode = String(cfg.mode || "SANDBOX_SIMULATOR");
  const wabaId = String(cfg.wabaId || "").trim();
  const accessToken = String(cfg.systemUserAccessToken || "").trim();
  const mkt = getRawLibSqlClient("marketing");
  const nowIso = new Date().toISOString();

  if (mode === "LIVE_META_CLOUD" && wabaId && accessToken) {
    try {
      let nextUrl: string | null = `https://graph.facebook.com/v21.0/${encodeURIComponent(
        wabaId
      )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100`;
      const allItems: any[] = [];
      let pageCount = 0;
      const MAX_PAGES = 10;

      while (nextUrl && pageCount < MAX_PAGES) {
        pageCount++;
        const res = await fetch(nextUrl, {
          headers: { Authorization: `Bearer ${accessToken}` },
          signal: AbortSignal.timeout(20000),
        });
        const json: any = await res.json().catch(() => ({}));
        if (!res.ok) {
          if (pageCount === 1) {
            return {
              ok: false,
              mode: "LIVE_META_CLOUD",
              syncedCount: 0,
              message:
                json?.error?.message || `Meta template sync failed (HTTP ${res.status}).`,
            };
          }
          break;
        }
        const pageItems: any[] = Array.isArray(json?.data) ? json.data : [];
        allItems.push(...pageItems);
        if (json?.paging?.next && typeof json.paging.next === "string") {
          nextUrl = json.paging.next;
        } else if (json?.paging?.cursors?.after && pageItems.length >= 100) {
          nextUrl = `https://graph.facebook.com/v21.0/${encodeURIComponent(
            wabaId
          )}/message_templates?fields=id,name,language,category,status,quality_score,rejected_reason,components&limit=100&after=${encodeURIComponent(
            json.paging.cursors.after
          )}`;
        } else {
          nextUrl = null;
        }
      }

      let synced = 0;
      for (const item of allItems) {
        const name = String(item.name || "").trim();
        if (!name) continue;
        const metaId = String(item.id || "");
        const rawStatus = String(item.status || "APPROVED").toUpperCase();
        const approvalStatus =
          rawStatus === "APPROVED"
            ? "APPROVED"
            : rawStatus === "REJECTED"
            ? "REJECTED"
            : rawStatus === "PAUSED"
            ? "PAUSED"
            : "PENDING_APPROVAL";
        const quality = String(
          item?.quality_score?.score || "GREEN"
        ).toUpperCase();
        const rejReason =
          item.rejected_reason && item.rejected_reason !== "NONE"
            ? String(item.rejected_reason)
            : null;

        const comps: any[] = Array.isArray(item.components)
          ? item.components
          : [];
        const headerComp = comps.find((c) => c.type === "HEADER");
        const bodyComp = comps.find((c) => c.type === "BODY");
        const footerComp = comps.find((c) => c.type === "FOOTER");
        const btnComp = comps.find((c) => c.type === "BUTTONS");

        const bodyText = String(bodyComp?.text || name);
        const bodyMatches = Array.from(bodyText.matchAll(/\{\{(\d+)\}\}/g)).map((m) =>
          Number(m[1])
        );
        const exampleValues: string[] = Array.isArray(bodyComp?.example?.body_text?.[0])
          ? bodyComp.example.body_text[0].map((x: unknown) => String(x || "").trim())
          : [];
        const uniqueVarNums = Array.from(new Set(bodyMatches)).sort((a, b) => a - b);
        const lowerName = name.toLowerCase();
        const varSpecs = uniqueVarNums.map((num) => {
          const exampleVal = exampleValues[num - 1] || "";
          const tokenPos = bodyText.indexOf(`{{${num}}}`);
          const snippetBefore =
            tokenPos >= 0
              ? bodyText.slice(Math.max(0, tokenPos - 65), tokenPos).toLowerCase()
              : "";

          if (item.category === "AUTHENTICATION" && num === 1) {
            return {
              index: 1,
              label: "Verification Code",
              sourceField: "custom" as const,
              sampleValue: exampleVal || "482910",
            };
          }
          if (num === 1) {
            return {
              index: 1,
              label: "Customer First Name",
              sourceField: "customer.firstName" as const,
              sampleValue: exampleVal || "Rahul",
            };
          }

          if (
            lowerName === "cc_contact_form_reply" ||
            /\b(?:reply|sent you|response|custom message)\b/i.test(snippetBefore)
          ) {
            return {
              index: num,
              label: "Custom Message",
              sourceField: "custom" as const,
              sampleValue: exampleVal || "Type your reply message for the client",
            };
          }

          if (
            /\border(?:\s*(?:id|no|number|#))?\b/i.test(snippetBefore) ||
            /\b(?:order_status|order_tracking|dispatch|order_update)\b/i.test(lowerName)
          ) {
            return {
              index: num,
              label: "Order Number",
              sourceField: "order.latestNumber" as const,
              sampleValue: exampleVal || "CC-2026-1089",
            };
          }

          if (/\b(?:company|business|organization|firm)\b/i.test(snippetBefore)) {
            return {
              index: num,
              label: "Company Name",
              sourceField: "customer.companyName" as const,
              sampleValue: exampleVal || "Classic Concepts",
            };
          }

          if (/\b(?:city|location|town)\b/i.test(snippetBefore)) {
            return {
              index: num,
              label: "City",
              sourceField: "customer.city" as const,
              sampleValue: exampleVal || "Hyderabad",
            };
          }

          return {
            index: num,
            label: num === 2 ? "Custom Message" : `Detail ${num}`,
            sourceField: "custom" as const,
            sampleValue: exampleVal || "Enter value",
          };
        });
        const variablesSchemaJson = JSON.stringify(varSpecs);

        const headerType = headerComp?.format ? String(headerComp.format).toUpperCase() : "NONE";
        const headerText = headerComp?.text ? String(headerComp.text) : null;
        const rawHandle = headerComp?.example?.header_handle?.[0]
          ? String(headerComp.example.header_handle[0]).trim()
          : "";
        // Meta returns opaque "4::..." upload handles alongside CDN URLs; only store real HTTP(S) URLs for message sends
        const headerMediaUrl = /^https?:\/\//i.test(rawHandle) ? rawHandle : null;
        const footerText = footerComp?.text ? String(footerComp.text) : null;
        const category = String(item.category || "MARKETING").toUpperCase();
        const language = String(item.language || "en");

        const existing = await mkt.execute({
          sql: `SELECT id, buttons_json, variables_schema_json FROM templates WHERE name = ? LIMIT 1`,
          args: [name],
        });

        let prevButtons: WhatsAppTemplateButton[] = [];
        if (existing.rows[0]?.buttons_json) {
          try {
            const parsed = JSON.parse(String(existing.rows[0].buttons_json));
            if (Array.isArray(parsed)) prevButtons = parsed;
          } catch {
            prevButtons = [];
          }
        }

        const buttons: WhatsAppTemplateButton[] = Array.isArray(
          btnComp?.buttons
        )
          ? btnComp.buttons.map((b: any, idx: number) => {
              const btnText = String(b.text || "Open");
              const prevMatch = prevButtons.find(
                (pb) =>
                  pb.text.trim().toLowerCase() === btnText.trim().toLowerCase()
              );
              return {
                id: prevMatch?.id || `btn_meta_${idx}`,
                type:
                  b.type === "URL"
                    ? "URL"
                    : b.type === "PHONE_NUMBER"
                    ? "PHONE_NUMBER"
                    : b.type === "COPY_CODE"
                    ? "COPY_CODE"
                    : "QUICK_REPLY",
                text: btnText,
                url: b.url ? String(b.url) : prevMatch?.url,
                phoneNumber: b.phone_number
                  ? String(b.phone_number)
                  : prevMatch?.phoneNumber,
                flowAction: prevMatch?.flowAction,
              };
            })
          : prevButtons;

        const firstUrlBtn = buttons.find((b) => b.type === "URL");

        if (existing.rows[0]) {
          await mkt.execute({
            sql: `UPDATE templates
                  SET meta_template_id = ?,
                      language = ?,
                      category = ?,
                      approval_status = ?,
                      meta_quality_score = ?,
                      rejection_reason = ?,
                      header_type = ?,
                      header_text = COALESCE(?, header_text),
                      header_media_url = COALESCE(?, header_media_url),
                      body_text = COALESCE(?, body_text),
                      footer_text = COALESCE(?, footer_text),
                      cta_label = COALESCE(?, cta_label),
                      cta_url = COALESCE(?, cta_url),
                      buttons_json = ?,
                      variables_schema_json = ?,
                      updated_at = ?
                  WHERE id = ?`,
            args: [
              metaId,
              language,
              category,
              approvalStatus,
              quality,
              rejReason,
              headerType,
              headerText,
              headerMediaUrl,
              bodyComp?.text ? String(bodyComp.text) : null,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              nowIso,
              String(existing.rows[0].id),
            ],
          });
          synced++;
        } else {
          await mkt.execute({
            sql: `INSERT INTO templates (
              id, name, language, category, header_type, header_text, body_text,
              header_media_url, footer_text, cta_label, cta_url, buttons_json,
              variables_schema_json, meta_template_id,
              meta_quality_score, approval_status, rejection_reason, created_by_name,
              updated_at, created_at
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'Meta Sync', ?, ?)`,
            args: [
              `tpl_${crypto.randomUUID().slice(0, 8)}`,
              name,
              language,
              category,
              headerType,
              headerText,
              bodyText,
              headerMediaUrl,
              footerText,
              firstUrlBtn?.text || null,
              firstUrlBtn?.url || null,
              JSON.stringify(buttons),
              variablesSchemaJson,
              metaId,
              quality,
              approvalStatus,
              rejReason,
              nowIso,
              nowIso,
            ],
          });
          synced++;
        }
      }

      return {
        ok: true,
        mode: "LIVE_META_CLOUD",
        syncedCount: synced,
        message: `Synced ${synced} official WhatsApp templates from Meta (preserving button flow mappings).`,
      };
    } catch (err: any) {
      return {
        ok: false,
        mode: "LIVE_META_CLOUD",
        syncedCount: 0,
        message: err?.message || "Network error while syncing from Meta.",
      };
    }
  }

  const countRes = await mkt.execute(`SELECT COUNT(*) as cnt FROM templates`);
  return {
    ok: true,
    mode: "SANDBOX_SIMULATOR",
    syncedCount: Number(countRes.rows[0]?.cnt ?? 0),
    message:
      "Checked local templates (Sandbox mode active. Connect live WABA ID in Facebook Setup to pull templates from Meta).",
  };
}
