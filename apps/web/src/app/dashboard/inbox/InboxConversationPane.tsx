"use client";

import React from "react";
import {
  CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE,
  ChatMessagesSkeleton,
  ElementErrorState,
  WhatsAppLogoIcon,
} from "@cc/ui";
import type {
  NormalizedMessageMedia,
  StagedComposerAttachment,
} from "@/components/MediaAttachmentTools";
import type { TemplateSendPayload } from "@/components/TemplateSendDialog";
import type { InboxMobilePane } from "@/lib/inbox-store";
import type {
  ApprovedTemplateOption,
  ChatMessage,
  ConversationDetailBundle,
  QuotedMessageRef,
  StaffOption,
} from "@/lib/inbox-server-data";
import { InboxChatHeader } from "./InboxChatHeader";
import { MessageTimeline } from "./MessageTimeline";
import { InboxComposer, type CombinedQuickReplyItem } from "./InboxComposer";
import { InboxComposerPopoversSlot } from "./InboxComposerPopoversSlot";
import type { VerifiedLocationInfo } from "./ComposerPopovers";
import { MyLeadsChatWindow } from "./MyLeadsChatWindow";
import type { MyLeadItem } from "@/app/api/leads/mine/route";

export function InboxConversationPane({
  mobilePane,
  selectedId,
  detail,
  syncingThread,
  detailError,
  emptyChatSlot,
  fetchAndCacheDetail,
  messages,
  nowMs,
  windowOpen,
  templates,
  sendTemplateMessage,
  isAcrioHandling,
  hasUnreadOutboundByCustomer,
  summarizingChat,
  takingOver,
  handleGenerateSummary,
  handleTakeOverChat,
  handleSmartAssignSalesP0,
  onOpenAssignModal,
  onOpenResolveModal,
  handleReopen,
  handleReturnToAcrio,
  handleSimulateCustomerRead,
  showToast,
  loadingOlderMessages,
  handleLoadOlderMessages,
  staffList,
  isAssignedToCurrentUser,
  highlightedMsgId,
  acrioActionBusyId,
  startReplyToMessage,
  setComposerMode,
  composerInputRef,
  jumpToQuotedMessage,
  setPreviewMedia,
  handleOpenNewChatWithPhone,
  handleSendNoteInChat,
  handleMoveNoteToReplyBox,
  handleConfirmAcrioAction,
  handleUploadCompanyDocForNote,
  setReplyText,
  timelineScrollRef,
  showAttachmentPicker,
  setShowAttachmentPicker,
  showTrackPopover,
  setShowTrackPopover,
  showLocationPopover,
  setShowLocationPopover,
  showShortLinksPicker,
  setShowShortLinksPicker,
  replyText,
  setStagedAttachment,
  executeComposerSend,
  trackOrderId,
  setTrackOrderId,
  trackBrand,
  setTrackBrand,
  trackProviderKey,
  setTrackProviderKey,
  trackAwbNumber,
  setTrackAwbNumber,
  trackProviderUrl,
  setTrackProviderUrl,
  trackButtonLabel,
  setTrackButtonLabel,
  trackMessageText,
  setTrackMessageText,
  sendingTrackBtn,
  openTrackPopoverForOrder,
  handleSendOrderTracking,
  appendToComposer,
  resolveActiveVerifiedLocation,
  buildVerifiedLocationMessageText,
  sendingLocationPin,
  handleSendVerifiedLocationNow,
  composerMode,
  replyingTo,
  setReplyingTo,
  stagedAttachment,
  matchingQuickReplies,
  showNoteForNonOwner,
  setShowNoteForNonOwner,
  pendingCallback,
  markPendingCallbackDone,
  setTemplateDialogOpen,
  setShowQuickRepliesModal,
  moveDraftToNote,
  handleComposerSubmit,
  isMyLeadsSelected,
  myLeads,
  myLeadsLoading,
  myLeadsError,
  isAdminOrSuperadmin,
  myLeadsScopeAll,
  currentUserId,
  onToggleMyLeadsScopeAll,
  onRefreshMyLeads,
  onOpenLeadChat,
  onUpdateLeadStatus,
  onForwardLead,
}: {
  isMyLeadsSelected: boolean;
  myLeads: MyLeadItem[];
  myLeadsLoading: boolean;
  myLeadsError: string;
  isAdminOrSuperadmin: boolean;
  myLeadsScopeAll: boolean;
  currentUserId: string;
  onToggleMyLeadsScopeAll: (next: boolean) => void;
  onRefreshMyLeads: () => void;
  onOpenLeadChat: (conversationId: string) => void;
  onUpdateLeadStatus: (
    callQueueId: string,
    status: "IN_PROGRESS" | "RESOLVED"
  ) => Promise<void>;
  onForwardLead: (
    lead: MyLeadItem,
    targetStaffId: string
  ) => Promise<void>;
  mobilePane: InboxMobilePane;
  selectedId: string | null;
  detail: ConversationDetailBundle | null;
  syncingThread: boolean;
  detailError: string;
  emptyChatSlot?: React.ReactNode;
  fetchAndCacheDetail: (convId: string, updateProfileInputs?: boolean) => Promise<void>;
  messages: ChatMessage[];
  nowMs: number;
  windowOpen: boolean;
  templates: ApprovedTemplateOption[];
  sendTemplateMessage: (
    payload: TemplateSendPayload
  ) => Promise<{ ok: boolean; error?: string }>;
  isAcrioHandling: boolean;
  hasUnreadOutboundByCustomer: boolean;
  summarizingChat: boolean;
  takingOver: boolean;
  handleGenerateSummary: () => Promise<void>;
  handleTakeOverChat: () => Promise<void>;
  handleSmartAssignSalesP0: () => Promise<void>;
  onOpenAssignModal: () => void;
  onOpenResolveModal: () => void;
  handleReopen: () => Promise<void>;
  handleReturnToAcrio: () => Promise<void>;
  handleSimulateCustomerRead: () => Promise<void>;
  showToast: (msg: string) => void;
  loadingOlderMessages: boolean;
  handleLoadOlderMessages: () => Promise<void>;
  staffList: StaffOption[];
  isAssignedToCurrentUser: boolean;
  highlightedMsgId: string | null;
  acrioActionBusyId: string | null;
  startReplyToMessage: (m: ChatMessage) => void;
  setComposerMode: (m: "REPLY" | "TEMPLATE" | "NOTE") => void;
  composerInputRef: React.RefObject<HTMLTextAreaElement | null>;
  jumpToQuotedMessage: (quoted: QuotedMessageRef) => void;
  setPreviewMedia: (m: NormalizedMessageMedia | null) => void;
  handleOpenNewChatWithPhone: (phone: string) => void;
  handleSendNoteInChat: (noteId: string, customText?: string, dismissOnly?: boolean) => Promise<void>;
  handleMoveNoteToReplyBox: (text: string, quoted?: QuotedMessageRef | null) => void;
  handleConfirmAcrioAction: (noteId: string, decision: "CONFIRM" | "CANCEL", selectedOptionId?: string) => Promise<void>;
  handleUploadCompanyDocForNote: (noteId: string, missingDoc: { slug?: string; title?: string; keywords?: string }, file: File) => Promise<void>;
  setReplyText: (next: string | ((prev: string) => string)) => void;
  timelineScrollRef: React.MutableRefObject<((msgId: string) => void) | null>;
  showAttachmentPicker: boolean;
  setShowAttachmentPicker: React.Dispatch<React.SetStateAction<boolean>>;
  showTrackPopover: boolean;
  setShowTrackPopover: React.Dispatch<React.SetStateAction<boolean>>;
  showLocationPopover: boolean;
  setShowLocationPopover: React.Dispatch<React.SetStateAction<boolean>>;
  showShortLinksPicker: boolean;
  setShowShortLinksPicker: React.Dispatch<React.SetStateAction<boolean>>;
  replyText: string;
  setStagedAttachment: (att: StagedComposerAttachment | null) => void;
  executeComposerSend: (opts?: {
    overrideAttachment?: StagedComposerAttachment | null;
    overrideCaption?: string;
    modeOverride?: "REPLY" | "NOTE";
  }) => Promise<void>;
  trackOrderId: string;
  setTrackOrderId: (v: string) => void;
  trackBrand: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  setTrackBrand: (v: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53") => void;
  trackProviderKey: string;
  setTrackProviderKey: (v: string) => void;
  trackAwbNumber: string;
  setTrackAwbNumber: (v: string) => void;
  trackProviderUrl: string;
  setTrackProviderUrl: (v: string) => void;
  trackButtonLabel: string;
  setTrackButtonLabel: (v: string) => void;
  trackMessageText: string;
  setTrackMessageText: (v: string) => void;
  sendingTrackBtn: boolean;
  openTrackPopoverForOrder: (prefill?: {
    orderId?: string;
    itemsSummary?: string;
    brand?: "CLASSIC_CONCEPTS" | "CLASSIC_EDGE_53";
  }) => void;
  handleSendOrderTracking: (e: React.FormEvent) => Promise<void>;
  appendToComposer: (snippet: string) => void;
  resolveActiveVerifiedLocation: () => VerifiedLocationInfo;
  buildVerifiedLocationMessageText: () => string;
  sendingLocationPin: boolean;
  handleSendVerifiedLocationNow: () => Promise<void>;
  composerMode: "REPLY" | "TEMPLATE" | "NOTE";
  replyingTo: QuotedMessageRef | null;
  setReplyingTo: (ref: QuotedMessageRef | null) => void;
  stagedAttachment: StagedComposerAttachment | null;
  matchingQuickReplies: CombinedQuickReplyItem[];
  showNoteForNonOwner: boolean;
  setShowNoteForNonOwner: React.Dispatch<React.SetStateAction<boolean>>;
  pendingCallback: {
    id: string;
    slot: string;
    topic: string;
    phone: string;
  } | null;
  markPendingCallbackDone: () => Promise<void>;
  setTemplateDialogOpen: (v: boolean) => void;
  setShowQuickRepliesModal: (v: boolean) => void;
  moveDraftToNote: (text: string) => void;
  handleComposerSubmit: (e: React.FormEvent) => Promise<void>;
}) {
  const activeConv = detail?.conversation || null;

  if (isMyLeadsSelected) {
    return (
      <MyLeadsChatWindow
        leads={myLeads}
        loading={myLeadsLoading}
        error={myLeadsError}
        isAdminOrSuperadmin={isAdminOrSuperadmin}
        scopeAll={myLeadsScopeAll}
        staffList={staffList}
        currentUserId={currentUserId}
        onToggleScopeAll={onToggleMyLeadsScopeAll}
        onRefresh={onRefreshMyLeads}
        onOpenChat={onOpenLeadChat}
        onOpenNewChatWithPhone={handleOpenNewChatWithPhone}
        onUpdateLeadStatus={onUpdateLeadStatus}
        onForwardLead={onForwardLead}
      />
    );
  }

  return (
    <div
      className={`${
        mobilePane === "CHAT" ? "flex w-full" : "hidden"
      } lg:flex flex-1 min-w-0 flex-col bg-[#efeae2]`}
    >
      {!detail || !activeConv ? (
        <div
          style={CLASSIC_CONCEPTS_CHAT_WALLPAPER_STYLE}
          className="flex-1 flex flex-col justify-center overflow-y-auto"
        >
          {selectedId && syncingThread ? (
            <ChatMessagesSkeleton />
          ) : selectedId && detailError ? (
            <div className="p-8 max-w-md mx-auto w-full">
              <ElementErrorState
                title="Could not load chat messages"
                message={detailError}
                onRetry={() => void fetchAndCacheDetail(selectedId, true)}
                retrying={syncingThread}
              />
            </div>
          ) : (
            emptyChatSlot ?? (
              <div className="p-8 text-center flex justify-center">
                <div className="bg-white/95 border border-[#d1d7db] rounded-xl p-6 max-w-sm shadow-xs space-y-2.5">
                  <div className="mx-auto w-12 h-12 rounded-full bg-[#e7fce3] flex items-center justify-center text-[#00a884]">
                    <WhatsAppLogoIcon size={24} />
                  </div>
                  <h2 className="font-display text-lg font-bold tracking-tight text-[#111b21]">
                    Classic Concepts WhatsApp Desk
                  </h2>
                  <p className="text-[13px] leading-relaxed text-[#54656f]">
                    Select any customer chat on the left. New enquiries are
                    handled automatically by ACRIO first and connected to Sales
                    Team whenever human help is needed.
                  </p>
                </div>
              </div>
            )
          )}
        </div>
      ) : (
        <>
          <InboxChatHeader
            detail={detail}
            messages={messages}
            nowMs={nowMs}
            syncingThread={syncingThread}
            isAcrioHandling={isAcrioHandling}
            hasUnreadOutboundByCustomer={hasUnreadOutboundByCustomer}
            summarizingChat={summarizingChat}
            takingOver={takingOver}
            onGenerateSummary={() => void handleGenerateSummary()}
            onTakeOverChat={() => void handleTakeOverChat()}
            onSmartAssignSalesP0={() => void handleSmartAssignSalesP0()}
            onOpenAssignModal={onOpenAssignModal}
            onOpenResolveModal={onOpenResolveModal}
            onReopen={() => void handleReopen()}
            onReturnToAcrio={() => void handleReturnToAcrio()}
            onSimulateCustomerRead={() => void handleSimulateCustomerRead()}
            onCopyToast={showToast}
          />

          <MessageTimeline
            conversationId={activeConv.id}
            messages={messages}
            conversationStatus={activeConv.status}
            resolvedByName={activeConv.resolvedByName || null}
            resolutionSummary={activeConv.resolutionSummary || null}
            hasOlderMessages={Boolean(detail.hasOlderMessages)}
            loadingOlderMessages={loadingOlderMessages}
            onLoadOlderMessages={handleLoadOlderMessages}
            nowMs={nowMs}
            staffList={staffList}
            isAssignedToCurrentUser={isAssignedToCurrentUser}
            highlightedMsgId={highlightedMsgId}
            acrioActionBusyId={acrioActionBusyId}
            onStartReplyToMessage={startReplyToMessage}
            onStartNoteReplyToMessage={(m) => {
              startReplyToMessage(m);
              if (!isAssignedToCurrentUser) {
                setShowNoteForNonOwner(true);
              }
              setReplyText((prev) =>
                prev.trim().startsWith("@") ? prev : `@ACRIO ${prev}`
              );
              setTimeout(() => composerInputRef.current?.focus(), 20);
            }}
            onJumpToQuotedMessage={jumpToQuotedMessage}
            onOpenMediaPreview={(media) => setPreviewMedia(media)}
            onOpenNewChatWithPhone={handleOpenNewChatWithPhone}
            onCopyToast={showToast}
            onSendNoteInChat={(noteId, customText, dismissOnly) => {
              void handleSendNoteInChat(noteId, customText, dismissOnly);
            }}
            onMoveNoteToReplyBox={handleMoveNoteToReplyBox}
            onConfirmAcrioAction={(noteId, decision, selectedOptionId) => {
              void handleConfirmAcrioAction(noteId, decision, selectedOptionId);
            }}
            onUploadCompanyDocForNote={(noteId, md, file) => {
              void handleUploadCompanyDocForNote(noteId, md, file);
            }}
            onUseSuggestedReply={(reply) => {
              if (!windowOpen) {
                setComposerMode("TEMPLATE");
                setTemplateDialogOpen(true);
                showToast(
                  "24-hour window is closed. Choose a template or save an internal note."
                );
                return;
              }
              setComposerMode("REPLY");
              setReplyText(reply);
              composerInputRef.current?.focus();
            }}
            onReopen={() => void handleReopen()}
            templates={templates}
            customerContext={{
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
            onSendReadyTemplate={sendTemplateMessage}
            onOpenTemplateDialog={() => {
              setComposerMode("TEMPLATE");
              setTemplateDialogOpen(true);
            }}
            scrollTargetRef={timelineScrollRef}
          />

          <InboxComposerPopoversSlot
            detail={detail}
            showAttachmentPicker={showAttachmentPicker}
            setShowAttachmentPicker={setShowAttachmentPicker}
            showTrackPopover={showTrackPopover}
            setShowTrackPopover={setShowTrackPopover}
            showLocationPopover={showLocationPopover}
            setShowLocationPopover={setShowLocationPopover}
            showShortLinksPicker={showShortLinksPicker}
            setShowShortLinksPicker={setShowShortLinksPicker}
            replyText={replyText}
            setReplyText={setReplyText}
            setStagedAttachment={setStagedAttachment}
            setComposerMode={setComposerMode}
            composerInputRef={composerInputRef}
            executeComposerSend={executeComposerSend}
            showToast={showToast}
            trackOrderId={trackOrderId}
            setTrackOrderId={setTrackOrderId}
            trackBrand={trackBrand}
            setTrackBrand={setTrackBrand}
            trackProviderKey={trackProviderKey}
            setTrackProviderKey={setTrackProviderKey}
            trackAwbNumber={trackAwbNumber}
            setTrackAwbNumber={setTrackAwbNumber}
            trackProviderUrl={trackProviderUrl}
            setTrackProviderUrl={setTrackProviderUrl}
            trackButtonLabel={trackButtonLabel}
            setTrackButtonLabel={setTrackButtonLabel}
            trackMessageText={trackMessageText}
            setTrackMessageText={setTrackMessageText}
            sendingTrackBtn={sendingTrackBtn}
            openTrackPopoverForOrder={openTrackPopoverForOrder}
            handleSendOrderTracking={handleSendOrderTracking}
            appendToComposer={appendToComposer}
            resolveActiveVerifiedLocation={resolveActiveVerifiedLocation}
            buildVerifiedLocationMessageText={buildVerifiedLocationMessageText}
            sendingLocationPin={sendingLocationPin}
            handleSendVerifiedLocationNow={handleSendVerifiedLocationNow}
          />

          <InboxComposer
            detail={detail}
            staffList={staffList}
            isAssignedToCurrentUser={isAssignedToCurrentUser}
            isAcrioHandling={isAcrioHandling}
            composerMode={composerMode}
            setComposerMode={setComposerMode}
            windowOpen={windowOpen}
            replyText={replyText}
            setReplyText={setReplyText}
            replyingTo={replyingTo}
            setReplyingTo={setReplyingTo}
            stagedAttachment={stagedAttachment}
            setStagedAttachment={setStagedAttachment}
            composerInputRef={composerInputRef}
            matchingQuickReplies={matchingQuickReplies}
            showAttachmentPicker={showAttachmentPicker}
            showTrackPopover={showTrackPopover}
            showLocationPopover={showLocationPopover}
            showShortLinksPicker={showShortLinksPicker}
            showNoteForNonOwner={showNoteForNonOwner}
            setShowNoteForNonOwner={setShowNoteForNonOwner}
            takingOver={takingOver}
            pendingCallback={pendingCallback}
            onMarkPendingCallbackDone={() => void markPendingCallbackDone()}
            onTakeOverChat={() => void handleTakeOverChat()}
            onToggleAttachmentPicker={() => {
              setShowTrackPopover(false);
              setShowShortLinksPicker(false);
              setShowLocationPopover(false);
              setShowAttachmentPicker((prev) => !prev);
            }}
            onToggleTrackPopover={() => {
              setShowShortLinksPicker(false);
              setShowAttachmentPicker(false);
              setShowLocationPopover(false);
              if (showTrackPopover) {
                setShowTrackPopover(false);
              } else {
                openTrackPopoverForOrder();
              }
            }}
            onToggleLocationPopover={() => {
              setShowTrackPopover(false);
              setShowShortLinksPicker(false);
              setShowAttachmentPicker(false);
              setShowLocationPopover((prev) => !prev);
            }}
            onToggleShortLinksPicker={() => {
              setShowTrackPopover(false);
              setShowAttachmentPicker(false);
              setShowLocationPopover(false);
              setShowShortLinksPicker((prev) => !prev);
            }}
            onOpenTemplateDialog={() => setTemplateDialogOpen(true)}
            onOpenQuickRepliesModal={() => setShowQuickRepliesModal(true)}
            onJumpToQuotedMessage={jumpToQuotedMessage}
            onMoveDraftToNote={moveDraftToNote}
            onSubmit={(e) => void handleComposerSubmit(e)}
            onShowToast={showToast}
          />
        </>
      )}
    </div>
  );
}
