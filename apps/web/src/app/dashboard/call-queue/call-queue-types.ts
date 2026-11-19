export type AssignmentMode =
  | "AUTO_PERFORMANCE"
  | "AUTO_RANDOM"
  | "PREFERRED_OR_PAST"
  | "OPEN_POOL"
  | "MANUAL";

export interface CallDispatchItem {
  id: string;
  customerPhone: string;
  customerName: string;
  source: string;
  productTopic: string;
  notes: string;
  recordingUrl: string;
  recordingFileName: string;
  recordingMimeType: string;
  attachmentUrl: string;
  attachmentName: string;
  assignmentMode: AssignmentMode;
  assignmentReason: string;
  assignedStaffId: string | null;
  assignedStaffName: string;
  status: "PENDING" | "IN_PROGRESS" | "RESOLVED";
  priority: "URGENT" | "HIGH" | "NORMAL";
  conversationId: string | null;
  resolutionNotes: string;
  submittedById: string | null;
  submittedByName: string;
  pickedUpAt: string | null;
  resolvedAt: string | null;
  resolvedByName: string;
  createdAt: string;
}

export interface RankedStaff {
  staffId: string;
  staffName: string;
  role: string;
  resolved30d: number;
  avgFirstResponseSec: number | null;
  openLoad: number;
  performanceScore: number;
}

export interface StaffMember {
  id: string;
  name: string;
  role: string;
}

export function formatSec(sec: number | null): string {
  if (sec === null || sec === undefined) return "No data";
  if (sec < 60) return `${sec}s`;
  const mins = Math.round(sec / 60);
  if (mins < 60) return `${mins}m`;
  return `${Math.round(mins / 60)}h`;
}
