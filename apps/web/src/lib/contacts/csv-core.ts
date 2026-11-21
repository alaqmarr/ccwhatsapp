export interface CsvColumnMap {
  idxPhone: number;
  idxAltPhone: number;
  idxName: number;
  idxCompany: number;
  idxDesignation: number;
  idxEmail: number;
  idxCity: number;
  idxState: number;
  idxGst: number;
  idxOrgType: number;
  idxStage: number;
  idxTags: number;
  idxPreferredStaff: number;
  idxSource: number;
  idxRequirement: number;
  idxQuantity: number;
  idxDate: number;
  idxNotes: number;
  idxOptIn: number;
}

export interface StaffLookupOption {
  id: string;
  name: string;
  role?: string;
  email?: string;
}

export interface CsvStaffInspection {
  totalDataRows: number;
  hasStaffColumn: boolean;
  matchedRows: number;
  blankStaffRows: number;
  unmatchedGroups: Array<{ rawName: string; rowCount: number }>;
}

const INVISIBLE_CONTROL_RE =
  /[\u200B-\u200F\u202A-\u202E\u2066-\u2069\uFEFF\uFFFD\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g;

export function stripInvisibleChars(raw: unknown): string {
  return String(raw ?? "").replace(INVISIBLE_CONTROL_RE, "");
}

export function sanitizeCsvText(raw: unknown, maxLen = 220): string {
  let cleaned = stripInvisibleChars(raw)
    .replace(/\r?\n/g, " ")
    .replace(/\t+/g, " ")
    .replace(/ {2,}/g, " ")
    .trim();

  // Remove stray quote/comma artifacts seen in legacy exports like ",'786..." or "School,"
  cleaned = cleaned
    .replace(/^["',;:\s]+/, "")
    .replace(/["',;\s]+$/, "")
    .trim();

  // Fix unbalanced trailing open parenthesis fragments like "Vijay Walia ( Ja"
  if (/\([^)]*$/.test(cleaned) && !/\([^)]{12,}$/.test(cleaned)) {
    cleaned = cleaned.replace(/\s*\([^)]*$/, "").trim();
  }

  return cleaned.slice(0, maxLen).trim();
}

export function sanitizeNoteText(raw: unknown, maxLen = 900): string {
  return stripInvisibleChars(raw)
    .replace(/\r?\n/g, " ")
    .replace(/\t+/g, " ")
    .replace(/ {2,}/g, " ")
    .replace(/^["']+|["']+$/g, "")
    .trim()
    .slice(0, maxLen);
}

/**
 * Prevents spreadsheet CSV formula execution while preserving valid phone numbers like +919849011223.
 */
export function sanitizeCsvExportCell(raw: unknown): string {
  const s = stripInvisibleChars(raw).trim();
  const safe =
    s && (/^[=@\t\r]/.test(s) || (/^[+\-]/.test(s) && !/^\+\d[\d\s()-]{6,}$/.test(s)))
      ? `'${s}`
      : s;
  return `"${safe.replace(/"/g, '""')}"`;
}

/**
 * RFC-4180 compliant CSV / TSV / semicolon parser that preserves quoted newlines
 * and recovers cleanly if a row contains an unclosed trailing quote.
 */
export function parseCsvRecords(rawText: string): {
  delimiter: string;
  records: string[][];
} {
  const cleaned = stripInvisibleChars(rawText).replace(/\r\n/g, "\n").replace(/\r/g, "\n").trim();
  if (!cleaned) return { delimiter: ",", records: [] };

  const firstNonEmptyLine = cleaned.split("\n").find((l) => l.trim().length > 0) || "";
  const delimiter = firstNonEmptyLine.includes("\t")
    ? "\t"
    : firstNonEmptyLine.includes(";") && !firstNonEmptyLine.includes(",")
    ? ";"
    : ",";

  const records: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let inQuotes = false;

  for (let i = 0; i < cleaned.length; i++) {
    const ch = cleaned[i];
    if (ch === '"') {
      if (inQuotes && cleaned[i + 1] === '"') {
        cell += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === delimiter && !inQuotes) {
      row.push(cell.trim());
      cell = "";
    } else if (ch === "\n" && !inQuotes) {
      row.push(cell.trim());
      if (row.some((c) => c.length > 0)) {
        records.push(row);
      }
      row = [];
      cell = "";
    } else {
      cell += ch;
    }
  }

  row.push(cell.trim());
  if (row.some((c) => c.length > 0)) {
    records.push(row);
  }

  return { delimiter, records };
}

function normalizeHeaderKey(raw: string): string {
  return stripInvisibleChars(raw)
    .toLowerCase()
    .replace(/[^a-z0-9]/g, "");
}

export function detectCsvHeaderMap(cols: string[]): CsvColumnMap | null {
  const norm = cols.map(normalizeHeaderKey);
  const findIdx = (candidates: string[]) => norm.findIndex((c) => candidates.includes(c));

  const idxPhone = findIdx([
    "phone",
    "mobile",
    "mobileno",
    "mobilenumber",
    "whatsapp",
    "whatsappnumber",
    "phonenumber",
    "contactnumber",
    "contactno",
    "number",
    "tel",
    "cell",
  ]);
  const idxAltPhone = findIdx([
    "alternatephone",
    "alternatephones",
    "alternatenumber",
    "altphone",
    "altnumber",
    "secondaryphone",
    "phone2",
    "number2",
    "whatsappnumber2",
  ]);
  const idxName = findIdx([
    "name",
    "fullname",
    "customername",
    "clientname",
    "contactname",
    "person",
    "leadname",
  ]);
  const idxCompany = findIdx([
    "company",
    "companyname",
    "organization",
    "firm",
    "business",
    "businessname",
    "institution",
  ]);
  const idxDesignation = findIdx(["designation", "role", "jobtitle"]);
  const idxEmail = findIdx(["email", "emailaddress", "mail", "mailid"]);
  const idxCity = findIdx(["city", "location", "town", "place"]);
  const idxState = findIdx(["state", "province", "region"]);
  const idxGst = findIdx(["gst", "gstin", "gstnumber", "gstno"]);
  const idxOrgType = findIdx(["organizationtype", "orgtype", "type", "industry"]);
  const idxStage = findIdx(["stage", "status", "leadstage", "callstatus"]);
  const idxTags = findIdx(["tags", "tag", "labels", "label"]);
  const idxPreferredStaff = findIdx([
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
    "manageby",
    "managedby",
    "empname",
    "employeename",
    "staffname",
    "staff",
  ]);
  const idxSource = findIdx(["leadsource", "source", "channel"]);
  const idxRequirement = findIdx([
    "requirment",
    "requirement",
    "requirements",
    "product",
    "interestedin",
  ]);
  const idxQuantity = findIdx(["quantity", "qty"]);
  const idxDate = findIdx([
    "date",
    "lastcontacted",
    "lastcontactedat",
    "enquirydate",
    "createddate",
  ]);
  const idxNotes = findIdx([
    "notes",
    "note",
    "remarks",
    "comment",
    "custvoice",
    "customervoice",
    "feedback",
    "summary",
  ]);
  const idxOptIn = findIdx(["optin", "optinmarketing", "marketing", "broadcastoptin"]);

  const matchedCoreFields = [
    idxPhone,
    idxName,
    idxCompany,
    idxEmail,
    idxCity,
    idxPreferredStaff,
    idxNotes,
    idxStage,
    idxSource,
    idxRequirement,
  ].filter((i) => i >= 0).length;

  const hasPhoneOrNameHeader = idxPhone >= 0 || idxName >= 0;
  if (!hasPhoneOrNameHeader || matchedCoreFields < 2) {
    return null;
  }

  return {
    idxPhone,
    idxAltPhone,
    idxName,
    idxCompany,
    idxDesignation,
    idxEmail,
    idxCity,
    idxState,
    idxGst,
    idxOrgType,
    idxStage,
    idxTags,
    idxPreferredStaff,
    idxSource,
    idxRequirement,
    idxQuantity,
    idxDate,
    idxNotes,
    idxOptIn,
  };
}

/**
 * Pure client/server helper matching an incoming staff query against active staff.
 */
export function matchStaffMemberQuery<T extends StaffLookupOption>(
  query: string,
  staffList: T[]
): T | null {
  const clean = stripInvisibleChars(query)
    .trim()
    .toLowerCase()
    .replace(/^@+/, "")
    .replace(/\s+/g, " ");
  if (!clean || clean.length < 2) return null;

  const exact = staffList.find(
    (s) =>
      s.id.toLowerCase() === clean ||
      (s.email && s.email.toLowerCase() === clean) ||
      s.name.toLowerCase().trim() === clean
  );
  if (exact) return exact;

  const byEmailLocal = staffList.find(
    (s) => s.email && s.email.split("@")[0]?.toLowerCase() === clean
  );
  if (byEmailLocal) return byEmailLocal;

  const firstCounts = new Map<string, number>();
  for (const s of staffList) {
    const first = s.name.toLowerCase().trim().split(/\s+/)[0] || "";
    if (first.length >= 3) firstCounts.set(first, (firstCounts.get(first) || 0) + 1);
  }
  const firstMatch = staffList.find((s) => {
    const first = s.name.toLowerCase().trim().split(/\s+/)[0] || "";
    return first === clean && (firstCounts.get(first) || 0) === 1;
  });
  if (firstMatch) return firstMatch;

  const subMatches = staffList.filter((s) => {
    const tokens = s.name.toLowerCase().trim().split(/\s+/);
    return tokens.some(
      (t) => t.length >= 3 && (t === clean || (clean.length >= 4 && t.includes(clean)))
    );
  });
  if (subMatches.length === 1) return subMatches[0];

  return null;
}

export function suggestStaffFromFileName<T extends StaffLookupOption>(
  fileName: string,
  staffList: T[]
): T | null {
  const base = String(fileName || "")
    .replace(/\.[a-z0-9]+$/i, "")
    .replace(/[_-]+/g, " ")
    .replace(/\b(?:contacts?|leads?|sheet|export|data|list|crm|new|final)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
  if (!base || base.length < 2) return null;
  return matchStaffMemberQuery(base, staffList);
}

/**
 * Inspects pasted or uploaded CSV rows in the browser so staff names that are missing
 * or do not cleanly match active portal users can be tagged before importing.
 */
export function inspectCsvStaffValues<T extends StaffLookupOption>(
  rawText: string,
  staffList: T[]
): CsvStaffInspection {
  const { records } = parseCsvRecords(rawText);
  let activeMap: CsvColumnMap | null = null;
  let totalDataRows = 0;
  let hasStaffColumn = false;
  let matchedRows = 0;
  let blankStaffRows = 0;
  const unmatchedMap = new Map<string, { rawName: string; rowCount: number }>();

  for (const cols of records) {
    const header = detectCsvHeaderMap(cols);
    if (header) {
      activeMap = header;
      if (header.idxPreferredStaff >= 0) {
        hasStaffColumn = true;
      }
      continue;
    }

    const rowPhoneText = activeMap
      ? [
          activeMap.idxPhone >= 0 ? cols[activeMap.idxPhone] || "" : "",
          activeMap.idxAltPhone >= 0 ? cols[activeMap.idxAltPhone] || "" : "",
          activeMap.idxNotes >= 0 ? cols[activeMap.idxNotes] || "" : "",
        ].join(" ")
      : cols.join(" ");
    const digitsCount = rowPhoneText.replace(/\D/g, "").length;
    if (digitsCount < 10) continue;

    totalDataRows++;
    const rawStaff =
      activeMap && activeMap.idxPreferredStaff >= 0
        ? sanitizeCsvText(cols[activeMap.idxPreferredStaff] || "", 80)
        : "";

    if (!rawStaff) {
      blankStaffRows++;
      continue;
    }

    const matched = matchStaffMemberQuery(rawStaff, staffList);
    if (matched) {
      matchedRows++;
    } else {
      const key = rawStaff.toLowerCase();
      const prev = unmatchedMap.get(key);
      if (prev) {
        prev.rowCount++;
      } else {
        unmatchedMap.set(key, { rawName: rawStaff, rowCount: 1 });
      }
    }
  }

  return {
    totalDataRows,
    hasStaffColumn,
    matchedRows,
    blankStaffRows,
    unmatchedGroups: Array.from(unmatchedMap.values()).sort((a, b) => b.rowCount - a.rowCount),
  };
}
