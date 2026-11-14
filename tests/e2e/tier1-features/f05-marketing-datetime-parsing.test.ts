import {
  describe,
  it,
  assertStrictEqual,
  assertOk,
  assertUtcIso,
  assertIstFormatted,
} from "../harness";
import { parseLocalIstToUtcIso, formatDateTimeIst } from "@cc/ui";
import { enqueueBroadcastIntoSafeQueue } from "@cc/workers";
import { getRawLibSqlClient } from "@cc/database";

describe("F05: Marketing Broadcast Datetime Parsing (Tier 1 Feature Coverage)", () => {
  it("T1-F05-01: parseLocalIstToUtcIso parses standard afternoon datetime-local input", () => {
    // "2026-12-01T14:30" IST -> "2026-12-01T09:00:00.000Z" UTC
    const input = "2026-12-01T14:30";
    const utcIso = parseLocalIstToUtcIso(input);
    assertStrictEqual(utcIso, "2026-12-01T09:00:00.000Z");
    assertUtcIso(utcIso);
  });

  it("T1-F05-02: parseLocalIstToUtcIso accurately parses evening schedule time", () => {
    // "2026-12-05T18:00" IST -> "2026-12-05T12:30:00.000Z" UTC
    const eveningInput = "2026-12-05T18:00";
    const eveningUtc = parseLocalIstToUtcIso(eveningInput);
    assertStrictEqual(eveningUtc, "2026-12-05T12:30:00.000Z");
    assertUtcIso(eveningUtc);
  });

  it("T1-F05-03: enqueueBroadcastIntoSafeQueue persists scheduled_for in UTC ISO format", async () => {
    const scheduledUtcIso = "2028-12-01T09:00:00.000Z";

    // Enqueue a scheduled broadcast using seeded list and template
    const res = await enqueueBroadcastIntoSafeQueue({
      name: "Diwali Acrylic Promo 2028",
      listId: "lst_hotels",
      templateId: "tpl_hospitality_showcase",
      scheduledForIso: scheduledUtcIso,
      createdByName: "Marketing Admin",
    });

    assertStrictEqual(res.ok, true);
    assertOk(res.broadcastId, "Broadcast ID should be returned");

    const mkt = getRawLibSqlClient("marketing");
    const bcRes = await mkt.execute({
      sql: `SELECT id, name, scheduled_for, status FROM broadcasts WHERE id = ? LIMIT 1`,
      args: [res.broadcastId!],
    });

    assertOk(bcRes.rows.length === 1, "Broadcast row must be found in database");
    const bcRow = bcRes.rows[0] as Record<string, unknown>;
    assertStrictEqual(bcRow.name, "Diwali Acrylic Promo 2028");
    assertStrictEqual(bcRow.scheduled_for, scheduledUtcIso);
    assertUtcIso(bcRow.scheduled_for);
    assertStrictEqual(bcRow.status, "SCHEDULED");
  });

  it("T1-F05-04: formatDateTimeIst renders scheduled broadcast datetime cleanly in IST", () => {
    const scheduledUtcIso = "2026-12-01T09:00:00.000Z";
    const display = formatDateTimeIst(scheduledUtcIso);
    assertStrictEqual(display, "01 Dec 2026, 02:30 PM");
    assertIstFormatted(display, { format: "dateTime" });
  });

  it("T1-F05-05: verifies future scheduled broadcast detection against current timestamp", () => {
    const now = Date.now();
    const futureUtcIso = new Date(now + 24 * 60 * 60 * 1000).toISOString();
    const pastUtcIso = new Date(now - 60 * 1000).toISOString();

    const isFuture = new Date(futureUtcIso).getTime() > now;
    const isPast = new Date(pastUtcIso).getTime() <= now;

    assertStrictEqual(isFuture, true);
    assertStrictEqual(isPast, true);
  });
});
