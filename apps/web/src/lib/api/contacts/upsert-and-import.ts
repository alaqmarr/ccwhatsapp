import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import {
  getRawLibSqlClient,
  listActiveNonClientStaff,
  normalizeWhatsAppPhone,
  resolveStaffMemberByQuery,
  upsertSyncedContact,
} from "@cc/database";
import { parseJsonArray } from "./get-handler";

function parseCsvLine(line: string, delimiter: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        cur += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      out.push(cur.trim());
      cur = "";
    } else {
      cur += ch;
    }
  }
  out.push(cur.trim());
  return out;
}

export async function handleUpsertContact(body: Record<string, unknown>) {
  const tags = Array.isArray(body.tags)
    ? body.tags.map(String)
    : typeof body.tags === "string"
    ? body.tags
        .split(",")
        .map((t: string) => t.trim())
        .filter(Boolean)
    : undefined;

  const groups = Array.isArray(body.groups) ? body.groups.map(String) : undefined;

  let resolvedPrefId =
    body.preferredStaffId !== undefined ? String(body.preferredStaffId).trim() : undefined;
  let resolvedPrefName =
    body.preferredStaffName !== undefined
      ? String(body.preferredStaffName).trim()
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
    name: body.name !== undefined ? String(body.name) : undefined,
    whatsappName: body.whatsappName !== undefined ? String(body.whatsappName) : undefined,
    email: body.email !== undefined ? String(body.email) : undefined,
    companyName: body.companyName !== undefined ? String(body.companyName) : undefined,
    designation: body.designation !== undefined ? String(body.designation) : undefined,
    organizationType:
      body.organizationType !== undefined ? String(body.organizationType) : undefined,
    city: body.city !== undefined ? String(body.city) : undefined,
    state: body.state !== undefined ? String(body.state) : undefined,
    country: body.country !== undefined ? String(body.country) : undefined,
    gstNumber: body.gstNumber !== undefined ? String(body.gstNumber) : undefined,
    source: body.source !== undefined ? String(body.source) : undefined,
    stage: body.stage !== undefined ? String(body.stage) : undefined,
    acrioSegment: body.acrioSegment !== undefined ? String(body.acrioSegment) : undefined,
    tags,
    groups,
    preferredStaffId: resolvedPrefId,
    preferredStaffName: resolvedPrefName,
    optInMarketing:
      body.optInMarketing !== undefined ? Boolean(body.optInMarketing) : undefined,
    optOutReason: body.optOutReason !== undefined ? String(body.optOutReason) : undefined,
    notes: body.notes !== undefined ? String(body.notes) : undefined,
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

  if (!rawText) {
    return NextResponse.json(
      { ok: false, error: "Please paste or upload at least one contact row." },
      { status: 400 }
    );
  }

  const lines = rawText
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  if (lines.length === 0) {
    return NextResponse.json(
      { ok: false, error: "No non-empty rows found in import input." },
      { status: 400 }
    );
  }

  const delimiter = lines[0].includes("\t")
    ? "\t"
    : lines[0].includes(";") && !lines[0].includes(",")
    ? ";"
    : ",";

  const firstRowCols = parseCsvLine(lines[0], delimiter).map((h) =>
    h.toLowerCase().replace(/[^a-z0-9]/g, "")
  );
  const hasHeader = firstRowCols.some((h) =>
    [
      "phone",
      "mobile",
      "whatsapp",
      "whatsappnumber",
      "phonenumber",
      "number",
      "name",
      "fullname",
      "customername",
    ].includes(h)
  );

  const findIdx = (candidates: string[]) =>
    firstRowCols.findIndex((c) => candidates.includes(c));

  const idxPhone = hasHeader
    ? findIdx([
        "phone",
        "mobile",
        "whatsapp",
        "whatsappnumber",
        "phonenumber",
        "contactnumber",
        "number",
      ])
    : -1;
  const idxName = hasHeader
    ? findIdx(["name", "fullname", "customername", "contactname", "person"])
    : -1;
  const idxCompany = hasHeader
    ? findIdx(["company", "companyname", "organization", "firm", "business"])
    : -1;
  const idxEmail = hasHeader ? findIdx(["email", "emailaddress", "mail"]) : -1;
  const idxCity = hasHeader ? findIdx(["city", "location", "town"]) : -1;
  const idxState = hasHeader ? findIdx(["state", "province", "region"]) : -1;
  const idxGst = hasHeader ? findIdx(["gst", "gstin", "gstnumber"]) : -1;
  const idxOrgType = hasHeader
    ? findIdx(["organizationtype", "orgtype", "type", "industry"])
    : -1;
  const idxStage = hasHeader ? findIdx(["stage", "status", "leadstage"]) : -1;
  const idxTags = hasHeader ? findIdx(["tags", "tag", "labels"]) : -1;
  const idxPreferredStaff = hasHeader
    ? findIdx([
        "preferredstaff",
        "preferredstaffname",
        "preferredstaffmember",
        "preferredstaffmembername",
        "staffpreference",
        "assignedstaff",
        "assignedowner",
        "owner",
        "salesperson",
        "representative",
        "accountmanager",
        "handledby",
        "staffname",
        "staff",
      ])
    : -1;
  const idxNotes = hasHeader ? findIdx(["notes", "note", "remarks", "comment"]) : -1;
  const idxOptIn = hasHeader ? findIdx(["optin", "optinmarketing", "marketing"]) : -1;

  const staffRoster = await listActiveNonClientStaff();
  const contactsDb = getRawLibSqlClient("contacts");
  const dataLines = hasHeader ? lines.slice(1) : lines;

  // Pre-parse rows so we can batch-fetch existing tags/groups in chunked IN queries
  const parsedRows = dataLines.map((line) => {
    const cols = parseCsvLine(line, delimiter);
    let rawPhone = "";
    let rawName = "";
    if (hasHeader && idxPhone >= 0) {
      rawPhone = cols[idxPhone] || "";
      rawName = idxName >= 0 ? cols[idxName] || "" : "";
    } else if (cols.length === 1) {
      rawPhone = cols[0];
    } else {
      const c0Digits = (cols[0] || "").replace(/\D/g, "");
      const c1Digits = (cols[1] || "").replace(/\D/g, "");
      if (c0Digits.length >= 10 && c1Digits.length < 10) {
        rawPhone = cols[0];
        rawName = cols[1] || "";
      } else {
        rawName = cols[0] || "";
        rawPhone = cols[1] || "";
      }
    }
    return { cols, normPhone: normalizeWhatsAppPhone(rawPhone), rawName };
  });

  const validPhones = Array.from(
    new Set(parsedRows.map((r) => r.normPhone).filter(Boolean))
  );
  const existingMetaByPhone = new Map<string, { tags: string[]; groups: string[] }>();
  for (let i = 0; i < validPhones.length; i += 400) {
    const chunk = validPhones.slice(i, i + 400);
    const placeholders = chunk.map(() => "?").join(",");
    const res = await contactsDb.execute({
      sql: `SELECT phone, tags_json, groups_json FROM contacts WHERE phone IN (${placeholders})`,
      args: chunk,
    });
    for (const row of res.rows) {
      existingMetaByPhone.set(String(row.phone), {
        tags: parseJsonArray(row.tags_json),
        groups: parseJsonArray(row.groups_json),
      });
    }
  }

  let importedCount = 0;
  let updatedCount = 0;
  let skippedCount = 0;

  for (const { cols, normPhone, rawName } of parsedRows) {
    if (!normPhone) {
      skippedCount++;
      continue;
    }

    const prevMeta = existingMetaByPhone.get(normPhone);
    const prevTags = prevMeta?.tags || [];
    const prevGroups = prevMeta?.groups || [];

    const rowTags =
      hasHeader && idxTags >= 0 && cols[idxTags]
        ? cols[idxTags]
            .split(/[|;,]/)
            .map((s) => s.trim())
            .filter(Boolean)
        : [];
    if (defaultTag) rowTags.push(defaultTag);
    const mergedTags = Array.from(new Set([...prevTags, ...rowTags]));
    const mergedGroups = defaultGroupId
      ? Array.from(new Set([...prevGroups, defaultGroupId]))
      : prevGroups;
    existingMetaByPhone.set(normPhone, { tags: mergedTags, groups: mergedGroups });

    const optInRaw =
      hasHeader && idxOptIn >= 0 ? (cols[idxOptIn] || "").toLowerCase() : "";
    const optInVal =
      optInRaw === "0" || optInRaw === "false" || optInRaw === "no" || optInRaw === "optout"
        ? false
        : undefined;

    const rawPrefStaff =
      hasHeader && idxPreferredStaff >= 0 && cols[idxPreferredStaff]
        ? cols[idxPreferredStaff].trim()
        : "";
    const matchedPrefStaff = rawPrefStaff
      ? resolveStaffMemberByQuery(rawPrefStaff, staffRoster)
      : null;

    const upRes = await upsertSyncedContact({
      phone: normPhone,
      name: rawName || undefined,
      companyName:
        hasHeader && idxCompany >= 0 && cols[idxCompany]
          ? cols[idxCompany]
          : !hasHeader && cols[2]
          ? cols[2]
          : undefined,
      email:
        hasHeader && idxEmail >= 0 && cols[idxEmail]
          ? cols[idxEmail]
          : !hasHeader && cols[3] && cols[3].includes("@")
          ? cols[3]
          : undefined,
      city:
        hasHeader && idxCity >= 0 && cols[idxCity]
          ? cols[idxCity]
          : !hasHeader && cols[4]
          ? cols[4]
          : undefined,
      state: hasHeader && idxState >= 0 && cols[idxState] ? cols[idxState] : undefined,
      gstNumber: hasHeader && idxGst >= 0 && cols[idxGst] ? cols[idxGst] : undefined,
      organizationType:
        hasHeader && idxOrgType >= 0 && cols[idxOrgType] ? cols[idxOrgType] : undefined,
      stage:
        hasHeader && idxStage >= 0 && cols[idxStage]
          ? cols[idxStage].toUpperCase().replace(/\s+/g, "_")
          : undefined,
      preferredStaffId: matchedPrefStaff ? matchedPrefStaff.id : undefined,
      preferredStaffName: matchedPrefStaff
        ? matchedPrefStaff.name
        : rawPrefStaff || undefined,
      notes: hasHeader && idxNotes >= 0 && cols[idxNotes] ? cols[idxNotes] : undefined,
      optInMarketing: optInVal,
      tags: mergedTags,
      groups: mergedGroups,
      source: "CSV_IMPORT",
    });

    if (upRes.ok) {
      if (upRes.isNew) importedCount++;
      else updatedCount++;
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
  });
}
