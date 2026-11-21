import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  getRawLibSqlClient,
  listActiveNonClientStaff,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
} from "@cc/database";
import {
  mergeUniqueNotes,
  parseAndSanitizeContactsImport,
  pickHigherFunnelStage,
  sanitizeCsvText,
  sanitizeNoteText,
} from "./csv-parser";
import { parseJsonArray } from "./get-handler";

export async function handleUpsertContact(body: Record<string, unknown>) {
  const tags = Array.isArray(body.tags)
    ? body.tags.map((t) => sanitizeCsvText(t, 60)).filter(Boolean)
    : typeof body.tags === "string"
    ? body.tags
        .split(",")
        .map((t: string) => sanitizeCsvText(t, 60))
        .filter(Boolean)
    : undefined;

  const groups = Array.isArray(body.groups) ? body.groups.map(String) : undefined;

  let resolvedPrefId =
    body.preferredStaffId !== undefined ? String(body.preferredStaffId).trim() : undefined;
  let resolvedPrefName =
    body.preferredStaffName !== undefined
      ? sanitizeCsvText(body.preferredStaffName, 80)
      : undefined;
  if ((resolvedPrefId || resolvedPrefName) && (!resolvedPrefId || !resolvedPrefName)) {
    const roster = await listActiveNonClientStaff();
    const matched = resolveStaffMemberByQuery(
      resolvedPrefId || resolvedPrefName || "",
      roster
    );
    if (matched) {
      resolvedPrefId = matched.id;
      resolvedPrefName = matched.name;
    }
  }

  const res = await upsertSyncedContact({
    phone: String(body.phone || ""),
    name: body.name !== undefined ? sanitizeCsvText(body.name, 140) : undefined,
    whatsappName:
      body.whatsappName !== undefined
        ? sanitizeCsvText(body.whatsappName, 140)
        : undefined,
    email:
      body.email !== undefined
        ? sanitizeCsvText(body.email, 120).toLowerCase()
        : undefined,
    companyName:
      body.companyName !== undefined
        ? sanitizeCsvText(body.companyName, 160)
        : undefined,
    designation:
      body.designation !== undefined
        ? sanitizeCsvText(body.designation, 80)
        : undefined,
    organizationType:
      body.organizationType !== undefined
        ? sanitizeCsvText(body.organizationType, 60)
        : undefined,
    city: body.city !== undefined ? sanitizeCsvText(body.city, 80) : undefined,
    state: body.state !== undefined ? sanitizeCsvText(body.state, 60) : undefined,
    country:
      body.country !== undefined ? sanitizeCsvText(body.country, 60) : undefined,
    gstNumber:
      body.gstNumber !== undefined
        ? sanitizeCsvText(body.gstNumber, 30).toUpperCase()
        : undefined,
    source: body.source !== undefined ? String(body.source) : undefined,
    stage: body.stage !== undefined ? String(body.stage) : undefined,
    acrioSegment: body.acrioSegment !== undefined ? String(body.acrioSegment) : undefined,
    tags,
    groups,
    preferredStaffId: resolvedPrefId,
    preferredStaffName: resolvedPrefName,
    optInMarketing:
      body.optInMarketing !== undefined ? Boolean(body.optInMarketing) : undefined,
    optOutReason:
      body.optOutReason !== undefined
        ? sanitizeCsvText(body.optOutReason, 200)
        : undefined,
    notes: body.notes !== undefined ? sanitizeNoteText(body.notes) : undefined,
  });

  if (!res.ok) {
    return NextResponse.json({ ok: false, error: res.error }, { status: 400 });
  }
  return NextResponse.json({ ok: true, id: res.id, phone: res.phone, isNew: res.isNew });
}

export async function handleBulkImport(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const rawText = String(body.csvText || "").trim();
  const defaultGroupId = String(body.groupId || "").trim();
  const defaultTag = String(body.defaultTag || "").trim();
  const sourceLabel = String(body.sourceLabel || "CSV / Bulk Paste Import").trim();
  const defaultPreferredStaffId = String(body.defaultPreferredStaffId || "").trim();
  const preferredStaffMode =
    String(body.preferredStaffMode || "").trim() === "override" ? "override" : "fallback";
  const rawStaffMappings =
    body.staffMappings && typeof body.staffMappings === "object" && !Array.isArray(body.staffMappings)
      ? (body.staffMappings as Record<string, unknown>)
      : {};

  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: "Please paste or upload at least one contact row." },
      { status: 400 }
    );
  }

  const parsed = parseAndSanitizeContactsImport(rawText, { defaultTag });
  if (parsed.rows.length === 0 && parsed.skippedRowCount === 0) {
    return NextResponse.json(
      { ok: false, error: "No non-empty rows found in import input." },
      { status: 400 }
    );
  }

  const staffRoster = await listActiveNonClientStaff();
  const defaultStaff = defaultPreferredStaffId
    ? staffRoster.find((s) => s.id === defaultPreferredStaffId) ||
      resolveStaffMemberByQuery(defaultPreferredStaffId, staffRoster)
    : null;
  const normalizedMappings = new Map<string, (typeof staffRoster)[number]>();
  for (const [rawKey, targetId] of Object.entries(rawStaffMappings)) {
    const cleanKey = sanitizeCsvText(rawKey, 80).toLowerCase();
    const cleanTargetId = String(targetId || "").trim();
    if (!cleanKey || !cleanTargetId) continue;
    const mapped =
      staffRoster.find((s) => s.id === cleanTargetId) ||
      resolveStaffMemberByQuery(cleanTargetId, staffRoster);
    if (mapped) {
      normalizedMappings.set(cleanKey, mapped);
    }
  }

  const contactsDb = getRawLibSqlClient("contacts");

  const validPhones = parsed.rows.map((r) => r.phone);
  const existingByPhone = new Map<
    string,
    {
      name: string;
      email: string;
      companyName: string;
      designation: string;
      organizationType: string;
      city: string;
      state: string;
      gstNumber: string;
      stage: string;
      preferredStaffId: string;
      preferredStaffName: string;
      notes: string;
      tags: string[];
      groups: string[];
      lastContactedAt: string;
    }
  >();

  for (let i = 0; i < validPhones.length; i += 400) {
    const chunk = validPhones.slice(i, i + 400);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await contactsDb.execute({
      sql: `SELECT phone, name, email, company_name, designation, organization_type, city, state, gst_number, stage, preferred_staff_id, preferred_staff_name, notes, tags_json, groups_json, last_contacted_at
            FROM contacts
            WHERE phone IN (${placeholders})`,
      args: chunk,
    });
    for (const row of res.rows) {
      existingByPhone.set(String(row.phone), {
        name: String(row.name || ""),
        email: String(row.email || ""),
        companyName: String(row.company_name || ""),
        designation: String(row.designation || ""),
        organizationType: String(row.organization_type || ""),
        city: String(row.city || ""),
        state: String(row.state || ""),
        gstNumber: String(row.gst_number || ""),
        stage: String(row.stage || ""),
        preferredStaffId: String(row.preferred_staff_id || ""),
        preferredStaffName: String(row.preferred_staff_name || ""),
        notes: String(row.notes || ""),
        tags: parseJsonArray(row.tags_json),
        groups: parseJsonArray(row.groups_json),
        lastContactedAt: String(row.last_contacted_at || ""),
      });
    }
  }

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = parsed.skippedRowCount;
  let preferredStaffAssignedCount = 0;

  for (const row of parsed.rows) {
    const prev = existingByPhone.get(row.phone);
    const prevTags = prev?.tags || [];
    const prevGroups = prev?.groups || [];
    const mergedTags = Array.from(new Set([...prevTags, ...row.tags]));
    const mergedGroups = defaultGroupId
      ? Array.from(new Set([...prevGroups, defaultGroupId]))
      : prevGroups;
    const mergedNotes = mergeUniqueNotes(prev?.notes || "", row.notesLines);
    const mergedStage = pickHigherFunnelStage(prev?.stage, row.stage);

    const csvQueryKey = row.preferredStaffQuery.trim().toLowerCase();
    const mappedCsvStaff = csvQueryKey ? normalizedMappings.get(csvQueryKey) || null : null;
    const autoMatchedCsvStaff = row.preferredStaffQuery
      ? resolveStaffMemberByQuery(row.preferredStaffQuery, staffRoster)
      : null;

    let chosenStaff: (typeof staffRoster)[number] | null = null;
    if (preferredStaffMode === "override" && defaultStaff) {
      chosenStaff = defaultStaff;
    } else if (mappedCsvStaff) {
      chosenStaff = mappedCsvStaff;
    } else if (autoMatchedCsvStaff) {
      chosenStaff = autoMatchedCsvStaff;
    } else if (defaultStaff && !prev?.preferredStaffId) {
      chosenStaff = defaultStaff;
    }

    const existingRealName =
      prev?.name && prev.name !== row.phone ? prev.name : "";
    const resolvedName =
      row.name && (!existingRealName || row.name.length >= existingRealName.length)
        ? row.name
        : existingRealName || row.name || undefined;

    const latestContacted =
      row.lastContactedAt &&
      (!prev?.lastContactedAt || row.lastContactedAt > prev.lastContactedAt)
        ? row.lastContactedAt
        : undefined;

    const upRes = await upsertSyncedContact({
      phone: row.phone,
      name: resolvedName,
      companyName: row.companyName || undefined,
      designation: row.designation || undefined,
      email: row.email || undefined,
      city: row.city || undefined,
      state: row.state || undefined,
      gstNumber: row.gstNumber || undefined,
      organizationType: row.organizationType || undefined,
      stage: mergedStage,
      acrioSegment: row.acrioSegment,
      preferredStaffId: chosenStaff ? chosenStaff.id : undefined,
      preferredStaffName: chosenStaff
        ? chosenStaff.name
        : !prev?.preferredStaffId && row.preferredStaffQuery
        ? row.preferredStaffQuery
        : undefined,
      notes: mergedNotes || undefined,
      optInMarketing: row.optInMarketing,
      tags: mergedTags,
      groups: mergedGroups,
      lastContactedAt: latestContacted,
      source: "CSV_IMPORT",
    });

    if (upRes.ok) {
      if (upRes.isNew) importedCount++;
      else updatedCount++;
      if (chosenStaff) preferredStaffAssignedCount++;
    } else {
      skippedCount++;
    }
  }

  await contactsDb.execute({
    sql: `INSERT INTO contact_import_logs (
      id, source_label, imported_count, updated_count, skipped_count, imported_by_name, created_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    args: [
      `imp_${crypto.randomUUID().slice(0, 8)}`,
      sourceLabel,
      importedCount,
      updatedCount,
      skippedCount,
      user.name,
      nowIso,
    ],
  });

  return NextResponse.json({
    ok: true,
    importedCount,
    updatedCount,
    skippedCount,
    preferredStaffAssignedCount,
    multiNumberRowCount: parsed.multiNumberRowCount,
    headerSectionsDetected: parsed.headerSectionsDetected,
  });
}
