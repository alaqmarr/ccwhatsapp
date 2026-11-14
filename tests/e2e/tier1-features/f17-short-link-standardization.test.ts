import fs from "node:fs";
import path from "node:path";
import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  createTestRequest,
  callRoute,
} from "../harness";
import { buildPublicShortUrl, getRawLibSqlClient } from "@cc/database";

describe("F17: Short Link Standardization & ccapl.cc Origin (Tier 1 Feature Coverage)", () => {
  it("T1-F17-01: buildPublicShortUrl generates standardized https://ccapl.cc/<6-char-id> URLs", () => {
    const code = "x7K9pQ";
    const shortUrl = buildPublicShortUrl(code);

    assertStrictEqual(shortUrl, "https://ccapl.cc/x7K9pQ");
    assertOk(/^https:\/\/ccapl\.cc\/[A-Za-z0-9_-]{6,}$/.test(shortUrl));
  });

  it("T1-F17-02: verifies Next.js config declares authorized dev origins for ccapl ecosystem", () => {
    const nextConfigPath = path.resolve(process.cwd(), "apps/web/next.config.ts");
    assertOk(fs.existsSync(nextConfigPath), "apps/web/next.config.ts must exist");
    const source = fs.readFileSync(nextConfigPath, "utf-8");

    assertOk(
      source.includes("allowedDevOrigins") && source.includes("ccapl"),
      "next.config.ts must specify allowedDevOrigins for ccapl domains"
    );
  });

  it("T1-F17-03: verifies backwards-compatible /l/[code] routing format support", async () => {
    const lCodeRoute = await import("../../../apps/web/src/app/l/[code]/route");
    const targetUrl = "https://classicconcepts.in/products/acrylic-lectern-clear";
    const testCode = "x7K9pQ";

    const conv = getRawLibSqlClient("conversations");
    await conv.execute({
      sql: `INSERT OR REPLACE INTO custom_links (
        id, code, title, target_url, link_type, clicks_count, created_by_name, created_at
      ) VALUES ('link_l_code_test', ?, 'Acrylic Lectern', ?, 'PRODUCT', 0, 'Admin', datetime('now'))`,
      args: [testCode, targetUrl],
    });

    try {
      const req = createTestRequest({
        url: `/l/${testCode}`,
        method: "GET",
      });

      const res = await callRoute(lCodeRoute, req, { params: { code: testCode } });
      assertStrictEqual(res.status, 307, "Legacy /l/[code] route must return HTTP 307 temporary redirect");
      assertStrictEqual(res.headers.get("location"), targetUrl, "Redirect location header must match destination URL");
    } finally {
      await conv.execute({
        sql: `DELETE FROM custom_links WHERE code = ?`,
        args: [testCode],
      });
    }
  });

  it("T1-F17-04: persists and queries short links in custom_links database table", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testCode = `t_${Math.random().toString(36).slice(2, 6)}`;
    const linkId = `link_${Date.now()}`;
    const targetUrl = "https://classicconcepts.in/products/acrylic-podium-model-53";

    await conv.execute({
      sql: `INSERT INTO custom_links (
        id, code, title, target_url, link_type, clicks_count, created_by_name, created_at
      ) VALUES (?, ?, 'Acrylic Podium 53', ?, 'PRODUCT', 0, 'Sales Admin', datetime('now'))`,
      args: [linkId, testCode, targetUrl],
    });

    const res = await conv.execute({
      sql: `SELECT id, code, target_url, clicks_count FROM custom_links WHERE code = ? LIMIT 1`,
      args: [testCode],
    });

    assertOk(res.rows.length === 1);
    const link = res.rows[0] as Record<string, unknown>;
    assertStrictEqual(link.code, testCode);
    assertStrictEqual(link.target_url, targetUrl);
    assertStrictEqual(Number(link.clicks_count), 0);
  });

  it("T1-F17-05: increments click count and records last_clicked_at timestamp monotonically", async () => {
    const conv = getRawLibSqlClient("conversations");
    const testCode = `c_${Math.random().toString(36).slice(2, 6)}`;
    const linkId = `link_${Date.now() + 1}`;
    const targetUrl = "https://classicconcepts.in/acrylic-sheets";

    await conv.execute({
      sql: `INSERT INTO custom_links (
        id, code, title, target_url, link_type, clicks_count, created_by_name, created_at
      ) VALUES (?, ?, 'Sheets', ?, 'PRODUCT', 0, 'Sales Admin', datetime('now'))`,
      args: [linkId, testCode, targetUrl],
    });

    const nowUtcIso = new Date().toISOString();
    await conv.execute({
      sql: `UPDATE custom_links SET clicks_count = clicks_count + 1, last_clicked_at = ? WHERE id = ?`,
      args: [nowUtcIso, linkId],
    });

    const res = await conv.execute({
      sql: `SELECT clicks_count, last_clicked_at FROM custom_links WHERE id = ? LIMIT 1`,
      args: [linkId],
    });

    assertOk(res.rows.length === 1);
    const link = res.rows[0] as Record<string, unknown>;
    assertStrictEqual(Number(link.clicks_count), 1);
    assertUtcIso(link.last_clicked_at);
  });
});
