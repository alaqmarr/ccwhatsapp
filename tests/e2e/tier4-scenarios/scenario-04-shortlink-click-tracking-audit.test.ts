import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertMatch,
  assertUtcIso,
  createTestRequest,
  callRoute,
  mockMeta,
} from "../harness";
import { getRawLibSqlClient } from "@cc/database";
import { createCustomAdminLink, resolveAndTrackCustomLink } from "@cc/storage";
import { formatDateTimeIst, formatDateIst, formatTimeIst } from "@cc/ui";
import { sendWhatsAppCloudMessage } from "@cc/connections";
import { generateUniquePhone } from "../tier3-pairwise/tier3-helper";
import * as lCodeRoute from "../../../apps/web/src/app/l/[code]/route";

describe("Scenario 04: Order Tracking Short Link & Backwards-Compatible Redirection (F17 + F2 + F4 + F12)", () => {
  it("executes full shortlink audit: create 6-char link -> dispatch in WhatsApp -> resolve via /l/ fallback -> log clicks in UTC -> IST report", async () => {
    mockMeta.reset();
    const phone = generateUniquePhone();
    const shortCode = `d7K2${Math.random().toString(36).slice(2, 4)}`;
    const awbNumber = "1490827364512";
    const targetUrl = `https://www.classicconcepts.in/tracking/${awbNumber}`;

    // 1. Warehouse staff creates order tracking short link
    const createRes = await createCustomAdminLink({
      code: shortCode,
      title: `Delhivery Tracking AWB ${awbNumber}`,
      targetUrl,
      createdByName: "Warehouse Dispatch Desk",
    });

    assertStrictEqual(createRes.ok, true, "Link creation must succeed");
    assertOk(createRes.link, "Must return created link metadata");
    assertStrictEqual(createRes.link.code, shortCode);

    // 2. Validate standard 6-character short URL format
    const fullShortUrl = `https://ccapl.cc/${shortCode}`;
    assertMatch(
      fullShortUrl,
      /^https:\/\/ccapl\.cc\/[a-zA-Z0-9]{6}$/,
      "Short link must strictly match https://ccapl.cc/[6-char-code]"
    );

    // 3. Dispatch outbound WhatsApp notification with the tracking link
    const outboundText = `Your acrylic display order has been dispatched via Delhivery (AWB ${awbNumber}). Track your shipment: ${fullShortUrl}`;
    const sendRes = await sendWhatsAppCloudMessage({
      toPhone: phone,
      bodyText: outboundText,
    });
    assertStrictEqual(sendRes.ok, true, "Outbound WhatsApp send must succeed");

    // 4. Initial state in custom_links database
    const conv = getRawLibSqlClient("conversations");
    const linkInitial = (
      await conv.execute({
        sql: `SELECT clicks_count, last_clicked_at, target_url FROM custom_links WHERE code = ?`,
        args: [shortCode],
      })
    ).rows[0] as any;

    assertStrictEqual(Number(linkInitial.clicks_count || 0), 0, "Initial clicks must be 0");

    // 5. Customer clicks backwards-compatible fallback URL: https://ccapl.cc/l/d7K2xx
    const click1Req = createTestRequest({
      url: `/l/${shortCode}`,
      method: "GET",
    });
    const click1Res = await callRoute(lCodeRoute, click1Req, { params: { code: shortCode } });
    assertOk(
      click1Res.status === 302 || click1Res.status === 307,
      `Redirect status must be 302 or 307, got ${click1Res.status}`
    );
    assertStrictEqual(click1Res.headers.get("location"), targetUrl);

    // Verify first click count incremented to 1 and last_clicked_at recorded in UTC ISO
    let linkAfter1 = (
      await conv.execute({
        sql: `SELECT clicks_count, last_clicked_at FROM custom_links WHERE code = ?`,
        args: [shortCode],
      })
    ).rows[0] as any;
    assertStrictEqual(Number(linkAfter1.clicks_count), 1, "Click count must be 1 after first visit");
    assertOk(linkAfter1.last_clicked_at, "last_clicked_at must be populated");
    assertUtcIso(String(linkAfter1.last_clicked_at));

    // 6. Customer clicks a second time from another device
    const click2Req = createTestRequest({
      url: `/l/${shortCode}`,
      method: "GET",
    });
    const click2Res = await callRoute(lCodeRoute, click2Req, { params: { code: shortCode } });
    assertOk(click2Res.status === 302 || click2Res.status === 307);

    let linkAfter2 = (
      await conv.execute({
        sql: `SELECT clicks_count, last_clicked_at FROM custom_links WHERE code = ?`,
        args: [shortCode],
      })
    ).rows[0] as any;
    assertStrictEqual(Number(linkAfter2.clicks_count), 2, "Click count must be 2 after second visit");

    // 7. Analytics reporting in IST
    const lastClickedUtc = String(linkAfter2.last_clicked_at);
    const istTime = formatTimeIst(lastClickedUtc);
    const istDate = formatDateIst(lastClickedUtc);
    const istFull = formatDateTimeIst(lastClickedUtc);

    assertOk(istTime.length > 0, "IST time string must be generated");
    assertOk(istDate.length > 0, "IST date string must be generated");
    assertOk(istFull.includes(istTime), "Full datetime must contain formatted time");
  });

  it("safely handles non-existent short link codes redirecting to fallback catalog", async () => {
    const unknownReq = createTestRequest({
      url: `/l/non_existent_code_999`,
      method: "GET",
    });

    const unknownRes = await callRoute(lCodeRoute, unknownReq, {
      params: { code: "non_existent_code_999" },
    });

    // Should redirect to fallback shop URL rather than 500 error
    assertOk(
      unknownRes.status === 302 || unknownRes.status === 307,
      `Should redirect unknown links, got ${unknownRes.status}`
    );
    assertOk(
      unknownRes.headers.get("location")?.includes("/shop"),
      "Should redirect unknown short link to shop fallback"
    );
  });
});
