import { formatInTimeZone } from "date-fns-tz";
import { getRawLibSqlClient, type InternalStaffCallerProfile } from "@cc/database";
import { ensureLeadForwardsTable } from "./desk-data";
import { fmtTime, suffix10, TZ } from "./types";

const GREETING_RE =
  /^(?:hi+|hello+|hey+|hii+|helo|good\s*(?:morning|afternoon|evening)|gm|namaste|namaskar|salaam|salam|assalam(?:u)?\s*alaikum|start|online|present)\W*$/i;

export function isStaffGreeting(text: string): boolean {
  return GREETING_RE.test(String(text || "").trim().toLowerCase());
}

export async function countPendingLeadForwards(staffPhone: string): Promise<number> {
  await ensureLeadForwardsTable();
  const suffix = suffix10(staffPhone);
  if (suffix.length < 10) return 0;
  const res = await getRawLibSqlClient("conversations").execute(
    `SELECT staff_phone FROM lead_forwards WHERE delivery_status = 'PENDING_WINDOW' LIMIT 200`
  );
  return res.rows.filter((r) => suffix10(String(r.staff_phone)) === suffix).length;
}

function greetingWord(): string {
  const hour = Number(formatInTimeZone(new Date(), TZ, "H"));
  if (hour < 12) return "Good morning";
  if (hour < 17) return "Good afternoon";
  return "Good evening";
}

export async function handleStaffDeskMessage(p: {
  staff: InternalStaffCallerProfile;
  text: string;
  hubBase: string;
  /** Delivers any lead that was waiting on a locked chat. Returns how many were sent. */
  flushLeads: () => Promise<number>;
  reply: (text: string) => Promise<void>;
}): Promise<boolean> {
  const lower = p.text.trim().toLowerCase();

  if (GREETING_RE.test(lower)) {
    const pending = await countPendingLeadForwards(p.staff.phone).catch(() => 0);
    const until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    const lines = [
      `${greetingWord()}, *${p.staff.firstName}*! Your desk chat is unlocked until ${fmtTime(until)}.`,
      "Leads from the owner will reach you here straight away.",
    ];
    if (pending > 0) {
      lines.push(
        `You had ${pending} lead${pending === 1 ? "" : "s"} waiting. ${pending === 1 ? "It is" : "They are"} on the way now.`
      );
    }
    lines.push("Reply *my leads* to see your forwarded leads, or *my chats* for your open chats.");
    await p.reply(lines.join("\n"));
    if (pending > 0) await p.flushLeads();
    return true;
  }

  if (/^(?:my\s*leads?|leads?|forwarded\s*leads?|my\s*forwarded\s*leads?)\W*$/i.test(lower)) {
    await ensureLeadForwardsTable();
    const conv = getRawLibSqlClient("conversations");
    const suffix = suffix10(p.staff.phone);
    const since = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const res = await conv.execute({
      sql: `SELECT staff_phone, staff_id, owner_name, lead_text, customer_name, customer_phone, delivery_status, created_at
            FROM lead_forwards WHERE created_at >= ? ORDER BY created_at DESC LIMIT 80`,
      args: [since],
    });
    const mine = res.rows
      .filter(
        (r) =>
          suffix10(String(r.staff_phone)) === suffix ||
          (p.staff.hubUserId && String(r.staff_id) === p.staff.hubUserId)
      )
      .slice(0, 8);
    if (mine.length === 0) {
      await p.reply(`Hey *${p.staff.firstName}*, no leads have been forwarded to you in the last 7 days.`);
      return true;
    }
    const items = mine
      .map((r, i) => {
        const snippet = String(r.lead_text || "").replace(/\s+/g, " ").slice(0, 110);
        const who = [String(r.customer_name || ""), String(r.customer_phone || "")].filter(Boolean).join(" ");
        return `${i + 1}. ${fmtTime(String(r.created_at))}${who ? ` | ${who}` : ""}\n   ${snippet}`;
      })
      .join("\n\n");
    await p.reply(`*Leads forwarded to you (last 7 days)*\n\n${items}`);
    return true;
  }

  return false;
}
