import type { MainWebsiteEnquiry } from "./catalog-types";
import { getClassicEdgeClient, getMainCatalogClient } from "./handles";

export async function fetchWebsiteEnquiriesForCustomer(
  phoneDigitsOrEmail: string
): Promise<MainWebsiteEnquiry[]> {
  if (!phoneDigitsOrEmail) return [];
  const last10 = phoneDigitsOrEmail.replace(/\D/g, "").slice(-10);
  const emailVal = phoneDigitsOrEmail.includes("@") ? phoneDigitsOrEmail.trim() : "";
  if (last10.length < 7 && !emailVal) return [];

  const ccClient = getMainCatalogClient();
  const ceClient = getClassicEdgeClient();

  const [ccRes, ceRes] = await Promise.all([
    ccClient
      ? ccClient
          .execute({
            sql: `
              SELECT id, name, email, phone, message, source, status, createdAt
              FROM Enquiry
              WHERE (? != '' AND phone LIKE ?) OR (? != '' AND LOWER(email) = LOWER(?))
              ORDER BY createdAt DESC
              LIMIT 6
            `,
            args: [last10, `%${last10}%`, emailVal, emailVal],
          })
          .catch(() => null)
      : Promise.resolve(null),
    ceClient
      ? ceClient
          .execute({
            sql: `
              SELECT id, name, email, phone, message, productName, repliedAt, createdAt
              FROM Enquiry
              WHERE (? != '' AND phone LIKE ?) OR (? != '' AND LOWER(email) = LOWER(?))
              ORDER BY createdAt DESC
              LIMIT 6
            `,
            args: [last10, `%${last10}%`, emailVal, emailVal],
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const combined: MainWebsiteEnquiry[] = [];

  if (ccRes) {
    for (const r of ccRes.rows) {
      combined.push({
        id: `cc_${String(r.id)}`,
        name: String(r.name || ""),
        email: String(r.email || ""),
        phone: String(r.phone || ""),
        message: String(r.message || ""),
        source: `classicconcepts.in (${String(r.source || "Website")})`,
        status: String(r.status || "New"),
        createdAt: String(r.createdAt || ""),
      });
    }
  }

  if (ceRes) {
    for (const r of ceRes.rows) {
      const prod = r.productName ? String(r.productName) : "";
      combined.push({
        id: `ce_${String(r.id)}`,
        name: String(r.name || ""),
        email: String(r.email || ""),
        phone: String(r.phone || ""),
        message: prod ? `[Machine: ${prod}] ${String(r.message || "")}` : String(r.message || ""),
        source: `classicedge53.com${prod ? ` (${prod})` : ""}`,
        status: r.repliedAt ? "Replied" : "New",
        createdAt: String(r.createdAt || ""),
      });
    }
  }

  combined.sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)));
  return combined.slice(0, 8);
}

export async function fetchAllEcosystemWebsiteEnquiries(
  limit = 500
): Promise<MainWebsiteEnquiry[]> {
  const ccClient = getMainCatalogClient();
  const ceClient = getClassicEdgeClient();

  const [ccRes, ceRes] = await Promise.all([
    ccClient
      ? ccClient
          .execute({
            sql: `SELECT id, name, email, phone, message, source, status, createdAt
                  FROM Enquiry
                  WHERE phone IS NOT NULL AND TRIM(phone) != ''
                  ORDER BY createdAt DESC
                  LIMIT ?`,
            args: [limit],
          })
          .catch(() => null)
      : Promise.resolve(null),
    ceClient
      ? ceClient
          .execute({
            sql: `SELECT id, name, email, phone, message, productName, repliedAt, createdAt
                  FROM Enquiry
                  WHERE phone IS NOT NULL AND TRIM(phone) != ''
                  ORDER BY createdAt DESC
                  LIMIT ?`,
            args: [limit],
          })
          .catch(() => null)
      : Promise.resolve(null),
  ]);

  const combined: MainWebsiteEnquiry[] = [];

  if (ccRes) {
    for (const r of ccRes.rows) {
      combined.push({
        id: `cc_${String(r.id)}`,
        name: String(r.name || ""),
        email: String(r.email || ""),
        phone: String(r.phone || ""),
        message: String(r.message || ""),
        source: `classicconcepts.in`,
        status: String(r.status || "New"),
        createdAt: String(r.createdAt || ""),
      });
    }
  }

  if (ceRes) {
    for (const r of ceRes.rows) {
      const prod = r.productName ? String(r.productName) : "";
      combined.push({
        id: `ce_${String(r.id)}`,
        name: String(r.name || ""),
        email: String(r.email || ""),
        phone: String(r.phone || ""),
        message: prod ? `[Machine: ${prod}] ${String(r.message || "")}` : String(r.message || ""),
        source: `classicedge53.com`,
        status: r.repliedAt ? "Replied" : "New",
        createdAt: String(r.createdAt || ""),
      });
    }
  }

  return combined;
}
