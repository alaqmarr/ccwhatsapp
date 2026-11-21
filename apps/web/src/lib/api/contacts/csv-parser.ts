import { normalizeWhatsAppPhone } from "@cc/database";

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

export interface ParsedContactRecord {
  phone: string;
  alternatePhones: string[];
  name: string;
  companyName: string;
  designation: string;
  email: string;
  city: string;
  state: string;
  gstNumber: string;
  organizationType: string;
  stage?: string;
  acrioSegment?: string;
  preferredStaffQuery: string;
  tags: string[];
  notesLines: string[];
  optInMarketing?: boolean;
  lastContactedAt?: string;
}

export interface ContactsImportParseResult {
  rows: ParsedContactRecord[];
  multiNumberRowCount: number;
  skippedRowCount: number;
  headerSectionsDetected: number;
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

function addNormalizedPhoneIfValid(candidate: string, out: string[], seen: Set<string>): void {
  const trimmed = candidate.trim();
  const digits = trimmed.replace(/\D/g, "");
  if (digits.length < 10) return;

  // Reject explicit "+91..." values with fewer than 10 subscriber digits (e.g. "+9140280329" has only 8 after 91),
  // as well as 10-digit Indian landline numbers starting with 0..5.
  if (trimmed.startsWith("+") && digits.startsWith("91") && digits.length !== 12) {
    return;
  }
  if (digits.length === 10 && !/^[6-9]/.test(digits)) return;
  if (digits.length === 12 && digits.startsWith("91") && !/^91[6-9]/.test(digits)) {
    return;
  }

  const normalized = normalizeWhatsAppPhone(candidate);
  if (!normalized || seen.has(normalized)) return;
  seen.add(normalized);
  out.push(normalized);
}

/**
 * Extracts all valid WhatsApp phone numbers and embedded emails from messy CRM cells
 * (handles '.', "'", '/', ';', labels like "Account '887...' (School Father 81031 21699)",
 * spaced digits like "+91 63063 66024", invisible Unicode markers, and emails).
 */
export function extractPhonesAndEmailsFromCell(
  rawNumberCell: string,
  extraNotesText = ""
): { phones: string[]; emails: string[] } {
  const cleanedCell = stripInvisibleChars(rawNumberCell);
  const cleanedNotes = stripInvisibleChars(extraNotesText);
  const emails: string[] = [];
  const emailSeen = new Set<string>();

  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
  for (const src of [cleanedCell, cleanedNotes]) {
    for (const m of src.matchAll(emailRe)) {
      const e = m[0].toLowerCase().trim();
      if (e && !emailSeen.has(e)) {
        emailSeen.add(e);
        emails.push(e);
      }
    }
  }

  const withoutEmails = cleanedCell.replace(emailRe, " ");
  const phones: string[] = [];
  const seen = new Set<string>();

  // First split by hard non-phone separators: '.', "'", '/', ';', '|', ',', '(', ')'
  const segments = withoutEmails
    .split(/[.'\/;|,\n()]+/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const seg of segments) {
    // Collapse intra-number splits ("+91 63063 66024", "81031 21699", "+91 9060484843")
    // while keeping whitespace boundaries between separate full numbers intact.
    const collapsed = seg
      .replace(/(\+91|91)\s+([6-9]\d{4})\s+(\d{5})\b/g, "$1$2$3")
      .replace(/\b([6-9]\d{4})\s+(\d{5})\b/g, "$1$2")
      .replace(/(\+\d{1,3})\s+(?=\d)/g, "$1");

    const matches = collapsed.match(/\+?\d[\d-]{8,16}\d/g) || [];
    if (matches.length > 0) {
      for (const m of matches) {
        addNormalizedPhoneIfValid(m, phones, seen);
      }
    } else {
      addNormalizedPhoneIfValid(collapsed, phones, seen);
    }
  }

  // Also mine explicit WhatsApp/mobile/alternate phone mentions from Cust Voice / Notes
  if (cleanedNotes) {
    const notePhoneRe =
      /(?:whatsapp|whatup|wa|alt(?:ernate)?|mob(?:ile)?|phone|num(?:ber)?|call)\s*(?:no\.?|number|:|-|is)?\s*(\+?91[\s-]?)?([6-9]\d{4}[\s-]?\d{5}|[6-9]\d{9})\b/gi;
    for (const m of cleanedNotes.matchAll(notePhoneRe)) {
      const rawCandidate = `${m[1] || ""}${m[2] || ""}`;
      addNormalizedPhoneIfValid(rawCandidate, phones, seen);
    }
  }

  return { phones, emails };
}

function cleanCustomerAndCompanyNames(
  rawCustomer: string,
  rawCompany: string
): { name: string; companyName: string; embeddedEmails: string[] } {
  const embeddedEmails: string[] = [];
  const emailRe = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;

  let cust = stripInvisibleChars(rawCustomer);
  for (const m of cust.matchAll(emailRe)) {
    embeddedEmails.push(m[0].toLowerCase().trim());
  }
  cust = cust
    .replace(/\(\s*[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\s*\)/g, " ")
    .replace(emailRe, " ");

  let company = sanitizeCsvText(rawCompany, 160);
  cust = sanitizeCsvText(cust, 140);

  // If Customer Name contains "Name ( Company )" and Company Name is empty, extract clean company
  const parenMatch = cust.match(/^(.+?)\s*\(\s*([^()]{3,60})\s*\)$/);
  if (parenMatch) {
    const baseName = sanitizeCsvText(parenMatch[1], 100);
    const inside = sanitizeCsvText(parenMatch[2], 80);
    if (
      inside &&
      !/^old cust$/i.test(inside) &&
      (!company || company.toLowerCase() === cust.toLowerCase()) &&
      !/^(abdul|ram|sharma|sir|madam)$/i.test(inside)
    ) {
      company = inside;
      cust = baseName;
    }
  }

  if (!cust && company) {
    cust = company;
  }

  return {
    name: cust,
    companyName: company,
    embeddedEmails: Array.from(new Set(embeddedEmails)),
  };
}

function mapLegacyCallStatusToStage(
  rawStageOrStatus: string
): { stage?: string; segment?: string } {
  const s = sanitizeCsvText(rawStageOrStatus, 60).toLowerCase();
  if (!s) return {};
  if (/(order\s*closed|closed\s*won|won|paid|booked|customer)/i.test(s)) {
    return { stage: "CUSTOMER", segment: "Converted Customer" };
  }
  if (/repeat/i.test(s)) return { stage: "REPEAT_BUYER" };
  if (/vip/i.test(s)) return { stage: "VIP" };
  if (/quot/i.test(s)) return { stage: "QUOTED" };
  if (/(follow\s*up|later|call\s*back|qualified|interested)/i.test(s)) {
    return { stage: "QUALIFIED" };
  }
  if (/(inactive|dead|lost|drop|not\s*interested)/i.test(s)) {
    return { stage: "INACTIVE" };
  }
  if (s === "new_lead" || s === "new lead") return { stage: "NEW_LEAD" };
  const upper = s.toUpperCase().replace(/\s+/g, "_");
  if (["NEW_LEAD", "QUALIFIED", "QUOTED", "CUSTOMER", "REPEAT_BUYER", "VIP", "INACTIVE"].includes(upper)) {
    return { stage: upper };
  }
  return {};
}

function parseImportDateToIso(rawDate: string): string | undefined {
  const clean = sanitizeCsvText(rawDate, 40);
  if (!clean) return undefined;
  if (/^\d{4}-\d{2}-\d{2}$/.test(clean)) {
    const dt = new Date(`${clean}T10:00:00+05:30`);
    if (!Number.isNaN(dt.getTime())) return dt.toISOString();
  }
  const dt = new Date(clean);
  if (!Number.isNaN(dt.getTime()) && dt.getFullYear() >= 2015 && dt.getFullYear() <= 2035) {
    return dt.toISOString();
  }
  return undefined;
}

const STAGE_PRIORITY: Record<string, number> = {
  INACTIVE: 0,
  NEW_LEAD: 1,
  QUALIFIED: 2,
  QUOTED: 3,
  CUSTOMER: 4,
  REPEAT_BUYER: 5,
  VIP: 6,
};

export function pickHigherFunnelStage(
  existingStage?: string | null,
  incomingStage?: string | null
): string | undefined {
  const a = existingStage ? existingStage.toUpperCase() : "";
  const b = incomingStage ? incomingStage.toUpperCase() : "";
  if (!a) return b || undefined;
  if (!b) return a || undefined;
  return (STAGE_PRIORITY[b] ?? 1) >= (STAGE_PRIORITY[a] ?? 1) ? b : a;
}

export function mergeUniqueNotes(existingNotes: string, newLines: string[]): string {
  const seen = new Set<string>();
  const merged: string[] = [];
  const pushLine = (line: string) => {
    const trimmed = line.trim();
    if (!trimmed) return;
    const key = trimmed.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(trimmed);
  };
  for (const line of String(existingNotes || "").split(/\r?\n/)) {
    pushLine(line);
  }
  for (const line of newLines) {
    pushLine(line);
  }
  return merged.join("\n").slice(0, 3500);
}

/**
 * Parses and sanitizes simple or multi-section legacy CRM CSV exports, expanding
 * multi-number cells into linked E.164 WhatsApp contacts and merging duplicate rows.
 */
export function parseAndSanitizeContactsImport(
  rawText: string,
  options?: { defaultTag?: string }
): ContactsImportParseResult {
  const { records } = parseCsvRecords(rawText);
  const defaultTag = sanitizeCsvText(options?.defaultTag || "", 60);

  let activeMap: CsvColumnMap | null = null;
  let headerSectionsDetected = 0;
  let multiNumberRowCount = 0;
  let skippedRowCount = 0;

  const byPhone = new Map<string, ParsedContactRecord>();

  const upsertIntoBatch = (rec: ParsedContactRecord) => {
    const prev = byPhone.get(rec.phone);
    if (!prev) {
      byPhone.set(rec.phone, {
        ...rec,
        alternatePhones: Array.from(new Set(rec.alternatePhones)),
        tags: Array.from(new Set(rec.tags)),
        notesLines: Array.from(new Set(rec.notesLines)),
      });
      return;
    }

    // Prefer fuller person name (not a raw phone number or shorter partial alias)
    const cleanPrevName = prev.name && prev.name !== prev.phone ? prev.name : "";
    const cleanNextName = rec.name && rec.name !== rec.phone ? rec.name : "";
    if (!cleanPrevName && cleanNextName) {
      prev.name = cleanNextName;
    } else if (
      cleanNextName &&
      cleanPrevName &&
      cleanNextName.length > cleanPrevName.length &&
      cleanNextName.toLowerCase().includes(cleanPrevName.toLowerCase())
    ) {
      prev.name = cleanNextName;
    }

    if (!prev.companyName && rec.companyName) prev.companyName = rec.companyName;
    if (!prev.designation && rec.designation) prev.designation = rec.designation;
    if (!prev.email && rec.email) prev.email = rec.email;
    if (!prev.city && rec.city) prev.city = rec.city;
    if (!prev.state && rec.state) prev.state = rec.state;
    if (!prev.gstNumber && rec.gstNumber) prev.gstNumber = rec.gstNumber;
    if (!prev.organizationType && rec.organizationType) {
      prev.organizationType = rec.organizationType;
    }
    if (!prev.preferredStaffQuery && rec.preferredStaffQuery) {
      prev.preferredStaffQuery = rec.preferredStaffQuery;
    }
    prev.stage = pickHigherFunnelStage(prev.stage, rec.stage);
    if (rec.acrioSegment === "Converted Customer") {
      prev.acrioSegment = "Converted Customer";
    }
    if (rec.optInMarketing !== undefined) {
      prev.optInMarketing = rec.optInMarketing;
    }
    if (
      rec.lastContactedAt &&
      (!prev.lastContactedAt || rec.lastContactedAt > prev.lastContactedAt)
    ) {
      prev.lastContactedAt = rec.lastContactedAt;
    }

    prev.alternatePhones = Array.from(
      new Set([...prev.alternatePhones, ...rec.alternatePhones])
    );
    prev.tags = Array.from(new Set([...prev.tags, ...rec.tags]));
    prev.notesLines = Array.from(new Set([...prev.notesLines, ...rec.notesLines]));
  };

  for (const cols of records) {
    const detectedHeader = detectCsvHeaderMap(cols);
    if (detectedHeader) {
      activeMap = detectedHeader;
      headerSectionsDetected++;
      continue;
    }

    const colAt = (idx: number) => (idx >= 0 && idx < cols.length ? cols[idx] || "" : "");

    let rawPhoneCell = "";
    let rawAltPhoneCell = "";
    let rawCustomerCell = "";
    let rawCompanyCell = "";

    if (activeMap) {
      rawPhoneCell = colAt(activeMap.idxPhone);
      rawAltPhoneCell = colAt(activeMap.idxAltPhone);
      rawCustomerCell = colAt(activeMap.idxName);
      rawCompanyCell = colAt(activeMap.idxCompany);
    } else if (cols.length === 1) {
      rawPhoneCell = cols[0] || "";
    } else {
      const c0Digits = stripInvisibleChars(cols[0]).replace(/\D/g, "");
      const c1Digits = stripInvisibleChars(cols[1]).replace(/\D/g, "");
      if (c0Digits.length >= 10 && c1Digits.length < 10) {
        rawPhoneCell = cols[0] || "";
        rawCustomerCell = cols[1] || "";
      } else {
        rawCustomerCell = cols[0] || "";
        rawPhoneCell = cols[1] || "";
      }
      rawCompanyCell = cols[2] || "";
    }

    const rawNotes = activeMap ? sanitizeNoteText(colAt(activeMap.idxNotes)) : "";
    const combinedPhoneInput = [rawPhoneCell, rawAltPhoneCell].filter(Boolean).join(" / ");
    const { phones, emails: cellEmails } = extractPhonesAndEmailsFromCell(
      combinedPhoneInput,
      rawNotes
    );

    if (phones.length === 0) {
      skippedRowCount++;
      continue;
    }

    const { name, companyName, embeddedEmails } = cleanCustomerAndCompanyNames(
      rawCustomerCell,
      rawCompanyCell
    );

    const rawEmailCol = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxEmail), 120).toLowerCase()
      : "";
    const email =
      (rawEmailCol && rawEmailCol.includes("@") ? rawEmailCol : "") ||
      embeddedEmails[0] ||
      cellEmails[0] ||
      "";

    const city = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxCity), 80)
      : sanitizeCsvText(cols[4] || "", 80);
    const state = activeMap ? sanitizeCsvText(colAt(activeMap.idxState), 60) : "";
    const designation = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxDesignation), 80)
      : "";
    const gstNumber = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxGst), 30).toUpperCase()
      : "";
    const organizationType = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxOrgType), 60)
      : "";
    const rawStage = activeMap ? colAt(activeMap.idxStage) : "";
    const { stage, segment } = mapLegacyCallStatusToStage(rawStage);

    const rawSource = activeMap ? sanitizeCsvText(colAt(activeMap.idxSource), 60) : "";
    const rawReq = activeMap ? sanitizeCsvText(colAt(activeMap.idxRequirement), 80) : "";
    const rawQty = activeMap ? sanitizeCsvText(colAt(activeMap.idxQuantity), 30) : "";
    const rawDate = activeMap ? colAt(activeMap.idxDate) : "";
    const lastContactedAt = parseImportDateToIso(rawDate);

    const preferredStaffQuery = activeMap
      ? sanitizeCsvText(colAt(activeMap.idxPreferredStaff), 80)
      : "";

    const rawTagsCol = activeMap ? colAt(activeMap.idxTags) : "";
    const rowTags = rawTagsCol
      ? rawTagsCol
          .split(/[|;,]/)
          .map((t) => sanitizeCsvText(t, 45))
          .filter(Boolean)
      : [];
    if (defaultTag) rowTags.push(defaultTag);
    if (rawSource) rowTags.push(rawSource);
    if (rawReq) rowTags.push(rawReq);

    const optInRaw = activeMap ? sanitizeCsvText(colAt(activeMap.idxOptIn), 20).toLowerCase() : "";
    const optInMarketing =
      optInRaw === "0" || optInRaw === "false" || optInRaw === "no" || optInRaw === "optout"
        ? false
        : undefined;

    const noteParts: string[] = [];
    const headerMetaParts: string[] = [];
    if (rawDate) headerMetaParts.push(sanitizeCsvText(rawDate, 20));
    if (rawSource) headerMetaParts.push(rawSource);
    if (rawStage) headerMetaParts.push(sanitizeCsvText(rawStage, 30));
    if (rawReq) headerMetaParts.push(`Req: ${rawReq}${rawQty ? ` (${rawQty})` : ""}`);
    const prefix = headerMetaParts.length > 0 ? `[${headerMetaParts.join(" | ")}] ` : "";

    if (rawNotes) {
      noteParts.push(`${prefix}${rawNotes}`);
    } else if (prefix) {
      noteParts.push(prefix.trim());
    }

    if (phones.length > 1) {
      multiNumberRowCount++;
    }

    const primaryPhone = phones[0];
    for (let i = 0; i < phones.length; i++) {
      const thisPhone = phones[i];
      const otherPhones = phones.filter((p) => p !== thisPhone);
      const linkedNotes = [...noteParts];
      if (otherPhones.length > 0) {
        linkedNotes.push(
          i === 0
            ? `Alternate number(s) for ${name || companyName || "contact"}: ${otherPhones.join(", ")}`
            : `Linked to primary number ${primaryPhone}${name ? ` (${name})` : ""}`
        );
      }

      upsertIntoBatch({
        phone: thisPhone,
        alternatePhones: otherPhones,
        name,
        companyName,
        designation,
        email,
        city,
        state,
        gstNumber,
        organizationType,
        stage,
        acrioSegment: segment,
        preferredStaffQuery,
        tags: [...rowTags, ...(otherPhones.length > 0 ? ["Multi-Number"] : [])],
        notesLines: linkedNotes,
        optInMarketing,
        lastContactedAt,
      });
    }
  }

  return {
    rows: Array.from(byPhone.values()),
    multiNumberRowCount,
    skippedRowCount,
    headerSectionsDetected,
  };
}
