import crypto from "node:crypto";
import { NextResponse } from "next/server";
import type { AuthenticatedUser } from "@cc/auth";
import { getRawLibSqlClient, upsertSyncedContact } from "@cc/database";
import { hasPermission } from "@cc/rbac";
import { parseJsonArray } from "./get-handler";

export async function handleBulkAction(
  user: AuthenticatedUser,
  body: Record<string, unknown>,
  nowIso: string
) {
  const ids: string[] = Array.isArray(body.contactIds)
    ? body.contactIds.map(String).filter(Boolean)
    : [];
  const subAction = String(body.subAction || "");
  if (ids.length === 0) {
    return NextResponse.json(
      { ok: false, error: "Select at least one contact first." },
      { status: 400 }
    );
  }

  const contactsDb = getRawLibSqlClient("contacts");
  const crmDb = getRawLibSqlClient("crm_orders");
  const mktDb = getRawLibSqlClient("marketing");

  const placeholders = ids.map(() => "?").join(",");
  const selectedRes = await contactsDb.execute({
    sql: `SELECT id, phone, opt_in_marketing, tags_json, groups_json
          FROM contacts WHERE id IN (${placeholders})`,
    args: ids,
  });

  if (subAction === "delete") {
    if (!hasPermission(user.role, "contacts:delete", user.status)) {
      return NextResponse.json(
        { ok: false, error: "Admin or Manager permission required to delete contacts." },
        { status: 403 }
      );
    }
    const phones = selectedRes.rows.map((r) => String(r.phone));
    await contactsDb.execute({
      sql: `DELETE FROM contacts WHERE id IN (${placeholders})`,
      args: ids,
    });
    if (phones.length > 0) {
      const phMarks = phones.map(() => "?").join(",");
      await crmDb.execute({
        sql: `DELETE FROM customers WHERE phone IN (${phMarks})`,
        args: phones,
      });
    }
    return NextResponse.json({ ok: true, affected: selectedRes.rows.length });
  }

  if (subAction === "push_to_marketing_list") {
    if (!hasPermission(user.role, "marketing:manage_lists", user.status)) {
      return NextResponse.json(
        {
          ok: false,
          error: "Admin or Manager permission required to manage broadcast lists.",
        },
        { status: 403 }
      );
    }
    const optedInPhones = selectedRes.rows
      .filter((r) => Number(r.opt_in_marketing ?? 1) === 1)
      .map((r) => String(r.phone));

    if (optedInPhones.length === 0) {
      return NextResponse.json(
        { ok: false, error: "None of the selected contacts are opted in for broadcasts." },
        { status: 400 }
      );
    }

    const targetListId = String(body.listId || "").trim();
    if (targetListId && targetListId !== "NEW") {
      const lRes = await mktDb.execute({
        sql: `SELECT member_phones_json FROM marketing_lists WHERE id = ? LIMIT 1`,
        args: [targetListId],
      });
      const existingPhones = lRes.rows[0]
        ? parseJsonArray(lRes.rows[0].member_phones_json)
        : [];
      const merged = Array.from(new Set([...existingPhones, ...optedInPhones]));
      await mktDb.execute({
        sql: `UPDATE marketing_lists SET member_phones_json = ?, members_count = ?, updated_at = ? WHERE id = ?`,
        args: [JSON.stringify(merged), merged.length, nowIso, targetListId],
      });
      return NextResponse.json({
        ok: true,
        listId: targetListId,
        membersCount: merged.length,
      });
    }

    const newListName =
      String(body.newListName || "").trim() ||
      `Contacts Selection (${new Date().toLocaleDateString("en-IN")})`;
    const newId = `lst_${crypto.randomUUID().slice(0, 8)}`;
    await mktDb.execute({
      sql: `INSERT INTO marketing_lists (
        id, name, description, source_type, member_phones_json, members_count, created_by_name, updated_at, created_at
      ) VALUES (?, ?, 'Created from Contacts Database selection', 'MANUAL', ?, ?, ?, ?, ?)`,
      args: [
        newId,
        newListName,
        JSON.stringify(optedInPhones),
        optedInPhones.length,
        user.name,
        nowIso,
        nowIso,
      ],
    });
    return NextResponse.json({
      ok: true,
      listId: newId,
      membersCount: optedInPhones.length,
    });
  }

  for (const row of selectedRes.rows) {
    const phone = String(row.phone);
    const curTags = parseJsonArray(row.tags_json);
    const curGroups = parseJsonArray(row.groups_json);

    if (subAction === "add_tag") {
      const tag = String(body.tag || "").trim();
      if (tag) {
        await upsertSyncedContact({
          phone,
          tags: Array.from(new Set([...curTags, tag])),
        });
      }
    } else if (subAction === "set_stage") {
      const stage = String(body.stage || "QUALIFIED").trim();
      await upsertSyncedContact({ phone, stage });
    } else if (subAction === "set_opt_in") {
      const optIn = Boolean(body.optIn);
      await upsertSyncedContact({
        phone,
        optInMarketing: optIn,
        optOutReason: optIn ? "" : String(body.reason || "Marked opted-out by staff"),
      });
    } else if (subAction === "add_to_group") {
      const gid = String(body.groupId || "").trim();
      if (gid) {
        await upsertSyncedContact({
          phone,
          groups: Array.from(new Set([...curGroups, gid])),
        });
      }
    } else if (subAction === "remove_from_group") {
      const gid = String(body.groupId || "").trim();
      if (gid) {
        await upsertSyncedContact({
          phone,
          groups: curGroups.filter((g) => g !== gid),
        });
      }
    }
  }

  return NextResponse.json({ ok: true, affected: selectedRes.rows.length });
}
