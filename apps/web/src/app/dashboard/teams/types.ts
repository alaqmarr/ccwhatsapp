export interface TeamMemberItem {
  id: string;
  teamId: string;
  staffId: string;
  staffName: string;
  staffEmail: string;
  tier: "P0" | "P1" | "P2";
  maxActiveChats: number;
  isAvailable: boolean;
  emailAlertsEnabled?: boolean;
  activeOpenChats: number;
}

export interface TeamItem {
  id: string;
  name: string;
  description: string;
  brandScope: string;
  routingKeywords: string;
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
  autoAssignEnabled: boolean;
  waitingChatsCount: number;
  members: TeamMemberItem[];
}

export interface StaffOption {
  id: string;
  name: string;
  email: string;
  whatsappNumber: string;
  role: string;
  department: string;
  activeOpenChats: number;
}

export interface SyncInfo {
  classicConceptsCount: number;
  classicEdgeMachinesCount: number;
  classicEdgeConsumablesCount: number;
  lastSyncedAt: string | null;
  aiConnected: boolean;
  aiKeySource: string;
  aiMaskedKey: string;
}

export interface SmtpSummary {
  configured: boolean;
  source: string;
  host: string;
  port: number;
  userMasked: string;
  from: string;
}

export interface EmailDispatchLog {
  id: string;
  dispatchType: string;
  recipientEmail: string;
  recipientName: string;
  subject: string;
  conversationId: string | null;
  status: string;
  errorMessage: string | null;
  createdAt: string;
}

export interface EcosystemHealth {
  classicEdge3002: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  classicConcepts3003: {
    online: boolean;
    url: string;
    latencyMs: number;
    dbFallbackAvailable: boolean;
    smtpConfigured?: boolean;
  };
  whatsapp3007: {
    online: boolean;
    port: number;
  };
  checkedAt: string;
}

export type TeamsViewTab = "TEAMS" | "EMAIL_DISPATCH" | "BRIDGES";

export interface TeamCreateInput {
  name: string;
  description: string;
  brandScope: string;
  routingKeywords: string;
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
}

export type TeamTimerPatch = Partial<{
  priorityRank: number;
  p0WaitMinutes: number;
  p1WaitMinutes: number;
  routingKeywords: string;
  autoAssignEnabled: boolean;
}>;
