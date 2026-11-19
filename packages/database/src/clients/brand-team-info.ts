import { resolveClassicConceptsInternalUrl } from "./env-config";
import { getMainCatalogClient } from "./handles";

export const IS_TEST_OR_DEV_CONTACT_RE =
  /\b(sakina\s*manzil|tirumalgherry|alaqmarak0810|rapidshiftlabs|ananya\s*deshmukh|rohan\s*kulkarni|priya\s*menon|karthik\s*nair|arjun\s*deshmukh|98480\s*\d{5}|93467\s*63253|96184\s*43558)\b/i;

export interface ClassicConceptsTeamMemberInfo {
  name: string;
  position: string;
  phone: string;
  whatsapp: string;
  email: string;
}

export interface VerifiedGoogleMapsDetails {
  placeName: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
}

const DEFAULT_MAPS_PLACE_NAME = "Classic Concepts Acrylic Private Limited";
const DEFAULT_MAPS_LAT = 17.4947378;
const DEFAULT_MAPS_LNG = 78.496725;
const DEFAULT_MAPS_URL = `https://maps.google.com/?q=${DEFAULT_MAPS_LAT},${DEFAULT_MAPS_LNG}`;

function extractGoogleMapsDetails(params: {
  mapEmbedUrl?: string | null;
  explicitMapUrl?: string | null;
}): VerifiedGoogleMapsDetails {
  const rawEmbed = String(params.mapEmbedUrl || "").trim();
  const srcMatch = rawEmbed.match(/src=["']([^"']+)["']/i);
  const embedSrc = srcMatch?.[1] || rawEmbed;

  const latMatch = embedSrc.match(/!3d(-?\d+(?:\.\d+)?)/);
  const lngMatch = embedSrc.match(/!2d(-?\d+(?:\.\d+)?)/);
  const placeMatch = embedSrc.match(/!2s([^!&]+)/);

  const parsedLat = latMatch ? Number(latMatch[1]) : NaN;
  const parsedLng = lngMatch ? Number(lngMatch[1]) : NaN;
  const hasCoords = Number.isFinite(parsedLat) && Number.isFinite(parsedLng);

  const latitude = hasCoords ? parsedLat : DEFAULT_MAPS_LAT;
  const longitude = hasCoords ? parsedLng : DEFAULT_MAPS_LNG;

  let placeName = DEFAULT_MAPS_PLACE_NAME;
  if (placeMatch?.[1]) {
    try {
      const decoded = decodeURIComponent(placeMatch[1].replace(/\+/g, " ")).trim();
      if (decoded) placeName = decoded;
    } catch {
      // Keep default place name
    }
  }

  const explicit = String(params.explicitMapUrl || "").trim();
  const isTrusted =
    explicit.startsWith("https://maps.google.com/") ||
    explicit.startsWith("https://www.google.com/maps") ||
    explicit.startsWith("https://maps.app.goo.gl/") ||
    explicit.startsWith("https://goo.gl/maps/");

  const mapsUrl = isTrusted
    ? explicit
    : hasCoords
    ? `https://maps.google.com/?q=${latitude},${longitude}`
    : DEFAULT_MAPS_URL;

  return { placeName, mapsUrl, latitude, longitude };
}

let cachedLiveBrandTeamInfo: {
  fetchedAt: number;
  headOfficeLine: string;
  leadershipLines: string[];
  teamMembers: ClassicConceptsTeamMemberInfo[];
  officePhones: string[];
  officeEmails: string[];
  officeWhatsapp: string;
  address: string;
  businessHours: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
  placeName: string;
} | null = null;

/**
 * Fetches official professional team and contact details strictly from classicconcepts.in
 * (live `/api/brand-info` first, falling back to `classicconcepts` SQLite only if unreachable).
 * NEVER pulls private internal `ccwhatsapp` hub accounts (`core_auth.users`) into customer replies.
 */
export async function getVerifiedLiveBrandAndTeamInfo(): Promise<{
  headOfficeLine: string;
  leadershipLines: string[];
  teamMembers: ClassicConceptsTeamMemberInfo[];
  officePhones: string[];
  officeEmails: string[];
  officeWhatsapp: string;
  address: string;
  businessHours: string;
  mapsUrl: string;
  latitude: number;
  longitude: number;
  placeName: string;
}> {
  if (
    cachedLiveBrandTeamInfo &&
    Date.now() - cachedLiveBrandTeamInfo.fetchedAt < 5 * 60 * 1000
  ) {
    return cachedLiveBrandTeamInfo;
  }

  let address =
    "1-6-44/2 Muthyam Reddy Estate, Yadamma Nagar, Kanajiguda, Alwal, Secunderabad, Telangana 500015";
  let phone1 = "+91 79016 50662";
  let phone2 = "+91 79016 50663";
  let whatsappNumber = "+91 73372 20568";
  let email1 = "sales@classicconcepts.in";
  let email2 = "info@classicconcepts.in";
  let businessHours = "Monday - Saturday: 10:00 AM to 7:00 PM (Sunday: Closed)";
  let mapEmbedUrl: string | null = null;
  let explicitMapUrl: string | null = null;
  let apiMapsUrl: string | null = null;
  let apiLat: number | null = null;
  let apiLng: number | null = null;
  let apiPlaceName: string | null = null;
  const leadershipLines: string[] = [];
  const teamMembers: ClassicConceptsTeamMemberInfo[] = [];
  const seenNames = new Set<string>();

  const pushTeamMember = (raw: {
    name?: unknown;
    position?: unknown;
    role?: unknown;
    phone?: unknown;
    whatsapp?: unknown;
    email?: unknown;
  }) => {
    const name = String(raw.name || "").trim();
    if (!name || seenNames.has(name.toLowerCase()) || IS_TEST_OR_DEV_CONTACT_RE.test(name)) {
      return;
    }
    seenNames.add(name.toLowerCase());
    const pos = String(raw.position || raw.role || "Team Member").trim();
    const phone =
      raw.phone && !IS_TEST_OR_DEV_CONTACT_RE.test(String(raw.phone))
        ? String(raw.phone).replace(/\s{2,}/g, " ").trim()
        : "";
    const whatsapp =
      raw.whatsapp && !IS_TEST_OR_DEV_CONTACT_RE.test(String(raw.whatsapp))
        ? String(raw.whatsapp).replace(/\s{2,}/g, " ").trim()
        : phone;
    const email =
      raw.email && !IS_TEST_OR_DEV_CONTACT_RE.test(String(raw.email))
        ? String(raw.email).trim()
        : "";
    teamMembers.push({
      name,
      position: pos,
      phone,
      whatsapp,
      email,
    });
    leadershipLines.push(
      `• ${name} (${pos})${phone ? ` | Phone: ${phone}` : ""}${email ? ` | Email: ${email}` : ""}`
    );
  };

  const brandUrls = Array.from(
    new Set([
      "https://classicconcepts.in/api/brand-info",
      `${resolveClassicConceptsInternalUrl()}/api/brand-info`,
    ])
  );
  for (const url of brandUrls) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(3000) });
      if (!res.ok) continue;
      const data: any = await res.json().catch(() => null);
      if (!data?.success) continue;
      if (data?.contact?.address && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.address))) {
        address = String(data.contact.address).replace(/\r?\n/g, ", ").trim();
      }
      if (data?.contact?.primaryPhone && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.primaryPhone))) {
        phone1 = String(data.contact.primaryPhone).replace(/\s{2,}/g, " ").trim();
      }
      if (data?.contact?.secondaryPhone && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.secondaryPhone))) {
        phone2 = String(data.contact.secondaryPhone).replace(/\s{2,}/g, " ").trim();
      }
      if (data?.contact?.whatsappNumber && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.whatsappNumber))) {
        whatsappNumber = String(data.contact.whatsappNumber).replace(/\s{2,}/g, " ").trim();
      }
      if (data?.contact?.primaryEmail && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.primaryEmail))) {
        email1 = String(data.contact.primaryEmail).trim();
      }
      if (data?.contact?.secondaryEmail && !IS_TEST_OR_DEV_CONTACT_RE.test(String(data.contact.secondaryEmail))) {
        email2 = String(data.contact.secondaryEmail).trim();
      }
      if (data?.contact?.businessHours) {
        businessHours = String(data.contact.businessHours).replace(/\r?\n/g, " ").replace(/\s{2,}/g, " ").trim();
      }
      if (data?.contact?.mapEmbedUrl) {
        mapEmbedUrl = String(data.contact.mapEmbedUrl);
      }
      if (data?.contact?.mapsUrl) {
        apiMapsUrl = String(data.contact.mapsUrl).trim();
      }
      if (typeof data?.contact?.latitude === "number" && typeof data?.contact?.longitude === "number") {
        apiLat = data.contact.latitude;
        apiLng = data.contact.longitude;
      }
      if (data?.contact?.placeName) {
        apiPlaceName = String(data.contact.placeName).trim();
      }
      if (Array.isArray(data?.branches)) {
        const bMap = data.branches.find((b: any) => b?.mapUrl)?.mapUrl;
        if (bMap) explicitMapUrl = String(bMap);
      }
      if (Array.isArray(data?.team)) {
        for (const m of data.team) pushTeamMember(m);
      }
      if (leadershipLines.length > 0) break;
    } catch {
      // Fall through to next URL / local classicconcepts DB
    }
  }

  if (leadershipLines.length === 0) {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const [ccSettings, ccTeam, ccLocs] = await Promise.all([
        ccClient.execute(`SELECT * FROM SiteSetting LIMIT 1`).catch(() => ({ rows: [] as any[] })),
        ccClient.execute(`SELECT * FROM TeamMember ORDER BY sortOrder ASC`).catch(() => ({ rows: [] as any[] })),
        ccClient.execute(`SELECT name, mapUrl FROM InfrastructureLocation ORDER BY sortOrder ASC LIMIT 5`).catch(() => ({ rows: [] as any[] })),
      ]);

      const branchMap = ccLocs.rows.find((l) => l?.mapUrl)?.mapUrl;
      if (branchMap) explicitMapUrl = String(branchMap);

      if (ccSettings.rows.length > 0) {
        const s = ccSettings.rows[0];
        if (s.mapEmbedUrl && !mapEmbedUrl) {
          mapEmbedUrl = String(s.mapEmbedUrl);
        }
        if (s.address && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.address))) {
          address = String(s.address).replace(/\r?\n/g, ", ").trim();
        }
        if (s.phone1 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.phone1))) {
          phone1 = String(s.phone1).replace(/\s{2,}/g, " ").trim();
        }
        if (s.phone2 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.phone2))) {
          phone2 = String(s.phone2).replace(/\s{2,}/g, " ").trim();
        }
        if (s.email && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.email))) {
          email1 = String(s.email).trim();
        }
        if (s.email2 && !IS_TEST_OR_DEV_CONTACT_RE.test(String(s.email2))) {
          email2 = String(s.email2).trim();
        }
        if (s.businessHours) {
          businessHours = String(s.businessHours).replace(/\r?\n/g, " ").trim();
        }
      }

      for (const m of ccTeam.rows) {
        if (m.isActive === 0 || m.isActive === false) continue;
        pushTeamMember(m as any);
      }
    }
  }

  const extractedMap = extractGoogleMapsDetails({
    mapEmbedUrl,
    explicitMapUrl: apiMapsUrl || explicitMapUrl,
  });
  const mapsUrl = apiMapsUrl || extractedMap.mapsUrl;
  const latitude = apiLat ?? extractedMap.latitude;
  const longitude = apiLng ?? extractedMap.longitude;
  const placeName = apiPlaceName || extractedMap.placeName;

  const headOfficeLine = `• Official Company & Head Office (classicconcepts.in Live Directory): Classic Concepts Acrylic Private Limited (https://classicconcepts.in) & Classic Edge 53 (https://classicedge53.com) | Factory & Head Office: ${address} | Google Maps: ${mapsUrl} | Phones: ${phone1}${phone2 ? `, ${phone2}` : ""} | Official WhatsApp Business API: ${whatsappNumber} | Emails: ${email1}${email2 ? `, ${email2}` : ""} | Business Hours: ${businessHours}`;

  cachedLiveBrandTeamInfo = {
    fetchedAt: Date.now(),
    headOfficeLine,
    leadershipLines,
    teamMembers,
    officePhones: [phone1, phone2].filter(Boolean),
    officeEmails: [email1, email2].filter(Boolean),
    officeWhatsapp: whatsappNumber,
    address,
    businessHours,
    mapsUrl,
    latitude,
    longitude,
    placeName,
  };
  return cachedLiveBrandTeamInfo;
}
