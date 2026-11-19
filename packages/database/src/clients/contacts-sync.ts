import { getRawLibSqlClient } from "./handles";

export function normalizeWhatsAppPhone(raw: string): string {
  const trimmed = String(raw || "").trim();
  const digits = trimmed.replace(/\D/g, "");
  if (!digits) return "";
  if (digits.length === 10 && /^[6-9]/.test(digits)) {
    return `+91${digits}`;
  }
  if (digits.length === 11 && digits.startsWith("0")) {
    return `+91${digits.slice(1)}`;
  }
  if (digits.length >= 10 && digits.length <= 15) {
    return `+${digits}`;
  }
  return "";
}

export interface UpsertSyncedContactInput {
  phone: string;
  name?: string;
  whatsappName?: string;
  email?: string;
  companyName?: string;
  designation?: string;
  organizationType?: string;
  city?: string;
  state?: string;
  country?: string;
  gstNumber?: string;
  source?: string;
  stage?: string;
  acrioSegment?: string;
  tags?: string[];
  groups?: string[];
  optInMarketing?: boolean;
  optOutReason?: string;
  assignedOwnerId?: string | null;
  assignedOwnerName?: string;
  preferredStaffId?: string | null;
  preferredStaffName?: string;
  lifetimeValueInr?: number;
  totalOrdersCount?: number;
  notes?: string;
  lastContactedAt?: string;
}

/**
 * Keeps contacts.db, crm_orders.db (customers), and conversations.db (customer_name)
 * synchronized whenever a contact is created or updated anywhere in the app.
 */
export async function upsertSyncedContact(
  input: UpsertSyncedContactInput
): Promise<{ ok: boolean; id?: string; phone?: string; isNew?: boolean; error?: string }> {
  const phone = normalizeWhatsAppPhone(input.phone);
  if (!phone) {
    return { ok: false, error: "Please enter a valid 10 to 15 digit WhatsApp phone number." };
  }

  const contactsClient = getRawLibSqlClient("contacts");
  const crmClient = getRawLibSqlClient("crm_orders");
  const convClient = getRawLibSqlClient("conversations");
  const nowIso = new Date().toISOString();

  const existingRes = await contactsClient.execute({
    sql: `SELECT * FROM contacts WHERE phone = ? LIMIT 1`,
    args: [phone],
  });
  const ex = existingRes.rows[0] as Record<string, unknown> | undefined;
  const isNew = !ex;

  const parseArr = (raw: unknown): string[] => {
    try {
      const parsed = JSON.parse(String(raw || "[]"));
      return Array.isArray(parsed) ? parsed.map(String).filter(Boolean) : [];
    } catch {
      return [];
    }
  };

  const id = ex ? String(ex.id) : `cnt_${Math.random().toString(36).slice(2, 10)}`;
  const cleanName = (input.name ?? "").trim();
  const finalName =
    cleanName ||
    (ex && String(ex.name || "").trim() && String(ex.name) !== phone
      ? String(ex.name)
      : (input.whatsappName || "").trim() || phone);
  const finalWaName =
    input.whatsappName !== undefined
      ? input.whatsappName.trim()
      : String(ex?.whatsapp_name || "");
  const finalEmail =
    input.email !== undefined ? input.email.trim() : String(ex?.email || "");
  const finalCompany =
    input.companyName !== undefined
      ? input.companyName.trim()
      : String(ex?.company_name || "");
  const finalDesignation =
    input.designation !== undefined
      ? input.designation.trim()
      : String(ex?.designation || "");
  const finalOrgType =
    input.organizationType !== undefined && input.organizationType.trim()
      ? input.organizationType.trim()
      : String(ex?.organization_type || "Business");
  const finalCity =
    input.city !== undefined ? input.city.trim() : String(ex?.city || "");
  const finalState =
    input.state !== undefined ? input.state.trim() : String(ex?.state || "");
  const finalCountry =
    input.country !== undefined && input.country.trim()
      ? input.country.trim()
      : String(ex?.country || "India");
  const finalGst =
    input.gstNumber !== undefined
      ? input.gstNumber.trim().toUpperCase()
      : String(ex?.gst_number || "");
  const finalSource =
    input.source !== undefined && input.source.trim()
      ? input.source.trim()
      : String(ex?.source || "MANUAL");
  const finalStage =
    input.stage !== undefined && input.stage.trim()
      ? input.stage.trim()
      : String(ex?.stage || "NEW_LEAD");
  const finalSegment =
    input.acrioSegment !== undefined && input.acrioSegment.trim()
      ? input.acrioSegment.trim()
      : String(ex?.acrio_segment || "Active Prospect");

  const finalTags =
    input.tags !== undefined
      ? Array.from(new Set(input.tags.map((t) => t.trim()).filter(Boolean)))
      : parseArr(ex?.tags_json);
  const finalGroups =
    input.groups !== undefined
      ? Array.from(new Set(input.groups.map((g) => g.trim()).filter(Boolean)))
      : parseArr(ex?.groups_json);

  const finalOptIn =
    input.optInMarketing !== undefined
      ? input.optInMarketing
        ? 1
        : 0
      : Number(ex?.opt_in_marketing ?? 1);
  const finalOptOutReason =
    input.optOutReason !== undefined
      ? input.optOutReason.trim()
      : finalOptIn === 1
      ? ""
      : String(ex?.opt_out_reason || "");
  const finalPreferredStaffId =
    input.preferredStaffId !== undefined
      ? input.preferredStaffId || null
      : ex?.preferred_staff_id
      ? String(ex.preferred_staff_id)
      : input.assignedOwnerId !== undefined
      ? input.assignedOwnerId || null
      : null;
  const finalPreferredStaffName =
    input.preferredStaffName !== undefined
      ? input.preferredStaffName.trim()
      : String(ex?.preferred_staff_name || "") ||
        (input.assignedOwnerName !== undefined ? input.assignedOwnerName.trim() : "");
  const finalOwnerId =
    input.assignedOwnerId !== undefined
      ? input.assignedOwnerId
      : ex?.assigned_owner_id
      ? String(ex.assigned_owner_id)
      : finalPreferredStaffId;
  const finalOwnerName =
    input.assignedOwnerName !== undefined
      ? input.assignedOwnerName.trim()
      : String(ex?.assigned_owner_name || "") || finalPreferredStaffName;
  const finalLtv =
    input.lifetimeValueInr !== undefined
      ? Number(input.lifetimeValueInr)
      : Number(ex?.lifetime_value_inr ?? 0);
  const finalOrders =
    input.totalOrdersCount !== undefined
      ? Number(input.totalOrdersCount)
      : Number(ex?.total_orders_count ?? 0);
  const finalNotes =
    input.notes !== undefined ? input.notes.trim() : String(ex?.notes || "");
  const finalLastContacted =
    input.lastContactedAt || (ex?.last_contacted_at ? String(ex.last_contacted_at) : nowIso);
  const createdAt = ex?.created_at ? String(ex.created_at) : nowIso;

  await contactsClient.execute({
    sql: `INSERT INTO contacts (
      id, phone, whatsapp_name, name, email, company_name, designation,
      organization_type, city, state, country, gst_number, source, stage,
      acrio_segment, tags_json, groups_json, opt_in_marketing, opt_out_reason,
      assigned_owner_id, assigned_owner_name, preferred_staff_id, preferred_staff_name,
      lifetime_value_inr, total_orders_count,
      notes, last_contacted_at, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      whatsapp_name = excluded.whatsapp_name,
      name = excluded.name,
      email = excluded.email,
      company_name = excluded.company_name,
      designation = excluded.designation,
      organization_type = excluded.organization_type,
      city = excluded.city,
      state = excluded.state,
      country = excluded.country,
      gst_number = excluded.gst_number,
      source = excluded.source,
      stage = excluded.stage,
      acrio_segment = excluded.acrio_segment,
      tags_json = excluded.tags_json,
      groups_json = excluded.groups_json,
      opt_in_marketing = excluded.opt_in_marketing,
      opt_out_reason = excluded.opt_out_reason,
      assigned_owner_id = excluded.assigned_owner_id,
      assigned_owner_name = excluded.assigned_owner_name,
      preferred_staff_id = excluded.preferred_staff_id,
      preferred_staff_name = excluded.preferred_staff_name,
      lifetime_value_inr = excluded.lifetime_value_inr,
      total_orders_count = excluded.total_orders_count,
      notes = excluded.notes,
      last_contacted_at = excluded.last_contacted_at,
      updated_at = excluded.updated_at`,
    args: [
      id,
      phone,
      finalWaName,
      finalName,
      finalEmail,
      finalCompany,
      finalDesignation,
      finalOrgType,
      finalCity,
      finalState,
      finalCountry,
      finalGst,
      finalSource,
      finalStage,
      finalSegment,
      JSON.stringify(finalTags),
      JSON.stringify(finalGroups),
      finalOptIn,
      finalOptOutReason,
      finalOwnerId,
      finalOwnerName,
      finalPreferredStaffId,
      finalPreferredStaffName,
      finalLtv,
      finalOrders,
      finalNotes,
      finalLastContacted,
      createdAt,
      nowIso,
    ],
  });

  // Mirror into crm_orders.db (customers) so Broadcast Queue, ACRIO Lists, and Inbox 360 stay synced
  const custRes = await crmClient.execute({
    sql: `SELECT id FROM customers WHERE phone = ? LIMIT 1`,
    args: [phone],
  });
  const custId = custRes.rows[0] ? String(custRes.rows[0].id) : `cust_${id.replace(/^cnt_/, "")}`;

  await crmClient.execute({
    sql: `INSERT INTO customers (
      id, phone, name, email, company_name, organization_type, city, gst_number,
      acrio_segment, tags_json, preferred_staff_id, preferred_staff_name,
      lifetime_value_inr, total_orders_count,
      opt_in_marketing, notes, last_interaction_at, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(phone) DO UPDATE SET
      name = excluded.name,
      email = excluded.email,
      company_name = excluded.company_name,
      organization_type = excluded.organization_type,
      city = excluded.city,
      gst_number = excluded.gst_number,
      acrio_segment = excluded.acrio_segment,
      tags_json = excluded.tags_json,
      preferred_staff_id = excluded.preferred_staff_id,
      preferred_staff_name = excluded.preferred_staff_name,
      lifetime_value_inr = excluded.lifetime_value_inr,
      total_orders_count = excluded.total_orders_count,
      opt_in_marketing = excluded.opt_in_marketing,
      notes = excluded.notes,
      last_interaction_at = excluded.last_interaction_at`,
    args: [
      custId,
      phone,
      finalName,
      finalEmail || null,
      finalCompany || null,
      finalOrgType,
      finalCity || null,
      finalGst || null,
      finalSegment,
      JSON.stringify(finalTags),
      finalPreferredStaffId,
      finalPreferredStaffName,
      finalLtv,
      finalOrders,
      finalOptIn,
      finalNotes,
      finalLastContacted,
      createdAt,
    ],
  });

  // Also keep active conversation display name & customer_id aligned if a chat thread exists
  if (finalName && finalName !== phone) {
    await convClient
      .execute({
        sql: `UPDATE conversations SET customer_name = ?, customer_id = COALESCE(customer_id, ?) WHERE customer_phone = ?`,
        args: [finalName, custId, phone],
      })
      .catch(() => {});
  }

  return { ok: true, id, phone, isNew };
}
