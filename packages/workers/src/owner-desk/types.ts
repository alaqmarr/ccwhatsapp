import { formatInTimeZone, fromZonedTime, toZonedTime } from "date-fns-tz";

export const TZ = "Asia/Kolkata";

export function suffix10(raw: string | null | undefined): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length >= 10 ? digits.slice(-10) : digits;
}

export function ownerDisplayName(): string {
  return String(process.env.OWNER_DISPLAY_NAME || "Hussain sir").trim() || "Hussain sir";
}

export function fmtTime(iso: string | null | undefined): string {
  if (!iso) return "n/a";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "n/a";
  return formatInTimeZone(d, TZ, "d MMM, h:mm a");
}

export function todayStartIso(): string {
  const z = toZonedTime(new Date(), TZ);
  z.setHours(0, 0, 0, 0);
  return fromZonedTime(z, TZ).toISOString();
}

export interface ParsedAssignCommand {
  found: boolean;
  /** Raw staff text after the word "to", without the @ sign. Empty when the owner did not name anyone. */
  targetQuery: string;
  /** True when the owner said "staff", "someone", "sales team" or named nobody. */
  generic: boolean;
  verb: string;
  /** The enquiry text that came with the command (may be empty). */
  leadText: string;
}

export interface DeskStaff {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string;
  phone: string;
  suffix: string;
}

export interface WindowState {
  open: boolean;
  until: string | null;
  conversationId: string | null;
}

export type LeadItemKind = "TEXT" | "IMAGE" | "AUDIO" | "VIDEO" | "DOCUMENT";

/** One thing the owner sent for a lead: a written message, a voice note, a photo, a video or a file. */
export interface LeadItem {
  kind: LeadItemKind;
  /** Written words only (message text, or the caption of a file). Never a bare "[Image]" placeholder. */
  text: string;
  /** WhatsApp media id of the file the owner sent. */
  mediaId?: string;
  mimeType?: string;
  fileName?: string;
  at: number;
}

export type LogAssignmentFn = (p: {
  conversationId: string;
  customerPhone?: string;
  customerName?: string;
  fromStaffId?: string | null;
  fromStaffName?: string | null;
  fromTeamName?: string | null;
  toStaffId: string | null;
  toStaffName: string;
  toTeamId?: string | null;
  toTeamName: string;
  escalationLevel?: string;
  assignmentSource: "MANUAL_ASSIGN";
  assignedByName: string;
  reason?: string;
  assignedAt?: string;
}) => Promise<unknown>;

export interface AssignLeadParams {
  conversationId: string;
  ownerPhone: string;
  ownerName: string;
  text: string;
  currentWaMessageId?: string;
  replyToWaMessageId?: string;
  hubBase: string;
  logAssignment: LogAssignmentFn;
}
