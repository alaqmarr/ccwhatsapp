"use client";

import React from "react";
import dynamic from "next/dynamic";
import type { UserRole } from "@cc/rbac";
import type {
  NormalizedMessageMedia,
  PreSendFileConfirmationTarget,
  StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type { NewChatModalMode } from "@/components/NewChatTemplateModal";
import type { TemplateSendPayload } from "@/components/TemplateSendDialog";
import type {
  ApprovedTemplateOption,
  ConversationDetailBundle,
  ConversationSummary,
  QuickReplyItem,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import { CANNED_QUICK_REPLIES } from "./inbox-helpers";
import type { MessagePolishModalState } from "./MessagePolishModal";

const MessagePolishModal = dynamic(
  () => import("./MessagePolishModal").then((m) => m.MessagePolishModal),
  { ssr: false }
);

const MediaPreviewLightbox = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.MediaPreviewLightbox
    ),
  { ssr: false }
);
const PreSendFileConfirmModal = dynamic(
  () =>
    import("@/components/MediaAttachmentTools").then(
      (m) => m.PreSendFileConfirmModal
    ),
  { ssr: false }
);
const NewChatTemplateModal = dynamic(
  () =>
    import("@/components/NewChatTemplateModal").then(
      (m) => m.NewChatTemplateModal
    ),
  { ssr: false }
);
const QuickRepliesModal = dynamic(
  () =>
    import("@/components/QuickRepliesModal").then((m) => m.QuickRepliesModal),
  { ssr: false }
);
const TemplateSendDialog = dynamic(
  () =>
    import("@/components/TemplateSendDialog").then((m) => m.TemplateSendDialog),
  { ssr: false }
);
const AssignTeamModal = dynamic(
  () => import("./InboxModals").then((m) => m.AssignTeamModal),
  { ssr: false }
);
const ResolveChatModal = dynamic(
  () => import("./InboxModals").then((m) => m.ResolveChatModal),
  { ssr: false }
);

export function InboxModalsHost({
  detail,
  nowMs,
  composerMode,
  templateDialogOpen,
  setTemplateDialogOpen,
  templates,
  sendTemplateMessage,
  previewMedia,
  setPreviewMedia,
  pendingSendConfirm,
  setPendingSendConfirm,
  stagedAttachment,
  replyText,
  pendingPolish,
  onSendPolishedChoice,
  onCancelPolish,
  executeComposerSend,
  showAssignModal,
  setShowAssignModal,
  teams,
  staffList,
  currentUserRole,
  assignTeamId,
  setAssignTeamId,
  assignStaffId,
  setAssignStaffId,
  assignTier,
  setAssignTier,
  handleManualAssignSubmit,
  showResolveModal,
  setShowResolveModal,
  resolveSummary,
  setResolveSummary,
  handleSmartResolve,
  showNewChatModal,
  setShowNewChatModal,
  threads,
  simPhone,
  simName,
  newChatInitialMode,
  handleSelectConversation,
  onNewChatCompleted,
  showQuickRepliesModal,
  setShowQuickRepliesModal,
  customQuickReplies,
  setCustomQuickReplies,
  showToast,
}: {
  detail: ConversationDetailBundle | null;
  nowMs: number;
  composerMode: "REPLY" | "TEMPLATE" | "NOTE";
  templateDialogOpen: boolean;
  setTemplateDialogOpen: (v: boolean) => void;
  templates: ApprovedTemplateOption[];
  sendTemplateMessage: (
    payload: TemplateSendPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  previewMedia: NormalizedMessageMedia | null;
  setPreviewMedia: (m: NormalizedMessageMedia | null) => void;
  pendingSendConfirm: PreSendFileConfirmationTarget | null;
  setPendingSendConfirm: (t: PreSendFileConfirmationTarget | null) => void;
  stagedAttachment: StagedComposerAttachment | null;
  replyText: string;
  pendingPolish: MessagePolishModalState | null;
  onSendPolishedChoice: (chosenText: string) => Promise<void>;
  onCancelPolish: () => void;
  executeComposerSend: (opts?: {
    overrideAttachment?: StagedComposerAttachment | null;
    overrideCaption?: string;
    modeOverride?: "REPLY" | "NOTE";
  }) => Promise<void>;
  showAssignModal: boolean;
  setShowAssignModal: (v: boolean) => void;
  teams: TeamOption[];
  staffList: StaffOption[];
  currentUserRole: UserRole;
  assignTeamId: string;
  setAssignTeamId: (v: string) => void;
  assignStaffId: string;
  setAssignStaffId: (v: string) => void;
  assignTier: "P0" | "P1" | "P2";
  setAssignTier: (v: "P0" | "P1" | "P2") => void;
  handleManualAssignSubmit: (e: React.FormEvent) => Promise<void>;
  showResolveModal: boolean;
  setShowResolveModal: (v: boolean) => void;
  resolveSummary: string;
  setResolveSummary: (v: string) => void;
  handleSmartResolve: () => Promise<void>;
  showNewChatModal: boolean;
  setShowNewChatModal: (v: boolean) => void;
  threads: ConversationSummary[];
  simPhone: string;
  simName: string;
  newChatInitialMode: NewChatModalMode;
  handleSelectConversation: (convId: string) => void;
  onNewChatCompleted: (convId: string, msg: string) => Promise<void>;
  showQuickRepliesModal: boolean;
  setShowQuickRepliesModal: (v: boolean) => void;
  customQuickReplies: QuickReplyItem[];
  setCustomQuickReplies: (next: QuickReplyItem[]) => void;
  showToast: (msg: string) => void;
}) {
  const activeConv = detail?.conversation || null;

  return (
    <>
      {detail && activeConv && templateDialogOpen && composerMode === "TEMPLATE" && (
        <TemplateSendDialog
          open
          onClose={() => setTemplateDialogOpen(false)}
          templates={templates}
          windowOpen={
            Boolean(activeConv.windowExpiresAt) &&
            new Date(String(activeConv.windowExpiresAt)).getTime() > nowMs
          }
          customer={{
            name:
              detail.customer?.name?.trim() ||
              activeConv.customerName ||
              activeConv.customerPhone ||
              "",
            phone: activeConv.customerPhone || "",
            companyName: detail.customer?.companyName || null,
            city: detail.customer?.city || null,
            latestOrderNumber: detail.orders?.[0]?.orderNumber || null,
          }}
          onSend={sendTemplateMessage}
        />
      )}

      {previewMedia && (
        <MediaPreviewLightbox
          media={previewMedia}
          onClose={() => setPreviewMedia(null)}
        />
      )}

      {pendingPolish && (
        <MessagePolishModal
          state={pendingPolish}
          onSendChosen={(txt) => void onSendPolishedChoice(txt)}
          onCancel={onCancelPolish}
        />
      )}

      {pendingSendConfirm && (
        <PreSendFileConfirmModal
          target={pendingSendConfirm}
          busy={false}
          onCancel={() => setPendingSendConfirm(null)}
          onConfirmSend={() =>
            void executeComposerSend({
              overrideAttachment:
                pendingSendConfirm.staged || stagedAttachment,
              overrideCaption:
                pendingSendConfirm.captionPreview ?? replyText.trim(),
              modeOverride: "REPLY",
            })
          }
        />
      )}

      {showAssignModal && activeConv && (
        <AssignTeamModal
          open
          teams={teams}
          staffList={staffList}
          currentUserRole={currentUserRole}
          assignTeamId={assignTeamId}
          setAssignTeamId={setAssignTeamId}
          assignStaffId={assignStaffId}
          setAssignStaffId={setAssignStaffId}
          assignTier={assignTier}
          setAssignTier={setAssignTier}
          onSubmit={(e) => void handleManualAssignSubmit(e)}
          onClose={() => setShowAssignModal(false)}
        />
      )}

      {showResolveModal && (
        <ResolveChatModal
          open
          resolveSummary={resolveSummary}
          setResolveSummary={setResolveSummary}
          onResolve={() => void handleSmartResolve()}
          onClose={() => setShowResolveModal(false)}
        />
      )}

      {showNewChatModal && (
        <NewChatTemplateModal
          open
          onClose={() => setShowNewChatModal(false)}
          templates={templates}
          threads={threads}
          initialPhone={simPhone}
          initialName={simName}
          initialMode={newChatInitialMode}
          onOpenExistingChat={(convId) => {
            handleSelectConversation(convId);
          }}
          onCompleted={onNewChatCompleted}
        />
      )}

      {showQuickRepliesModal && (
        <QuickRepliesModal
          open
          onClose={() => setShowQuickRepliesModal(false)}
          customReplies={customQuickReplies}
          builtInReplies={CANNED_QUICK_REPLIES}
          onSaved={(next) => {
            setCustomQuickReplies(next);
            showToast("Quick replies updated.");
          }}
        />
      )}
    </>
  );
}
