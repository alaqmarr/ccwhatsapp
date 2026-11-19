"use client";

import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  extractMessageMedia,
  type NormalizedMessageMedia,
} from "@/components/MediaAttachmentTools";
import type { NewChatModalMode } from "@/components/NewChatTemplateModal";
import type {
  ApprovedTemplateOption,
  ChatMessage,
  ConversationDetailBundle,
  InitialInboxPayload,
  QuickReplyItem,
  StaffOption,
  TeamOption,
} from "@/lib/inbox-server-data";
import { getDraftKey, useInboxStore } from "@/lib/inbox-store";
import { inboxKeys } from "@/lib/inbox-queries";
import { useInboxRealtimeAndData } from "./useInboxRealtimeAndData";
import { useInboxComposerHelpers } from "./useInboxComposerHelpers";
import { useInboxMessagingActions } from "./useInboxMessagingActions";
import { useInboxWorkflowActions } from "./useInboxWorkflowActions";
import { InboxSidebarPane } from "./InboxSidebarPane";
import { InboxConversationPane } from "./InboxConversationPane";
import { InboxRightDrawer } from "./InboxRightDrawer";
import { InboxModalsHost } from "./InboxModalsHost";

export function InboxClient({
  initialData,
  emptyChatSlot,
}: {
  initialData: InitialInboxPayload;
  emptyChatSlot?: React.ReactNode;
}) {
  const storeSelectedId = useInboxStore((s) => s.selectedId);
  const selectedId = storeSelectedId ?? initialData.initialSelectedId;
  const initSelectedId = useInboxStore((s) => s.initSelectedId);
  const setSelectedId = useInboxStore((s) => s.setSelectedId);
  const selectConversationInStore = useInboxStore((s) => s.selectConversation);

  const mobilePane = useInboxStore((s) => s.mobilePane);
  const setMobilePane = useInboxStore((s) => s.setMobilePane);
  const bulkMode = useInboxStore((s) => s.bulkMode);
  const setBulkMode = useInboxStore((s) => s.setBulkMode);
  const selectedThreadIds = useInboxStore((s) => s.selectedThreadIds);
  const setSelectedThreadIds = useInboxStore((s) => s.setSelectedThreadIds);
  const toggleBulkThreadId = useInboxStore((s) => s.toggleBulkThreadId);

  const [teams, setTeams] = useState<TeamOption[]>(initialData.teams);
  const [staffList] = useState<StaffOption[]>(initialData.staffList);
  const [templates] = useState<ApprovedTemplateOption[]>(initialData.templates);
  const [customQuickReplies, setCustomQuickReplies] = useState<QuickReplyItem[]>(
    initialData.quickReplies || []
  );
  const [showQuickRepliesModal, setShowQuickRepliesModal] = useState(false);

  const isAdminOrSuperadmin =
    initialData.currentUserRole === "DEV" ||
    initialData.currentUserRole === "SUPERADMIN" ||
    initialData.currentUserRole === "ADMIN";

  const composerMode = useInboxStore((s) => s.composerMode);
  const setComposerMode = useInboxStore((s) => s.setComposerMode);
  const draftsByKey = useInboxStore((s) => s.draftsByKey);
  const setDraft = useInboxStore((s) => s.setDraft);
  const moveReplyDraftToNote = useInboxStore((s) => s.moveReplyDraftToNote);
  const replyText = draftsByKey[getDraftKey(selectedId, composerMode)] ?? "";
  const setReplyText = useCallback(
    (next: string | ((prev: string) => string)) => {
      const targetId =
        useInboxStore.getState().selectedId ?? initialData.initialSelectedId;
      const targetMode = useInboxStore.getState().composerMode;
      setDraft(targetId, targetMode, next);
    },
    [initialData.initialSelectedId, setDraft]
  );
  const replyingTo = useInboxStore((s) => s.replyingTo);
  const setReplyingTo = useInboxStore((s) => s.setReplyingTo);
  const highlightedMsgId = useInboxStore((s) => s.highlightedMsgId);
  const setHighlightedMsgId = useInboxStore((s) => s.setHighlightedMsgId);
  const stagedAttachment = useInboxStore((s) => s.stagedAttachment);
  const setStagedAttachment = useInboxStore((s) => s.setStagedAttachment);
  const pendingSendConfirm = useInboxStore((s) => s.pendingSendConfirm);
  const setPendingSendConfirm = useInboxStore((s) => s.setPendingSendConfirm);

  const [toast, setToast] = useState("");
  const [showResolveModal, setShowResolveModal] = useState(false);
  const [resolveSummary, setResolveSummary] = useState("");
  const [showAssignModal, setShowAssignModal] = useState(false);
  const [assignTeamId, setAssignTeamId] = useState("team_sales");
  const [assignStaffId, setAssignStaffId] = useState("");
  const [assignTier, setAssignTier] = useState<"P0" | "P1" | "P2">("P0");
  const [showNewChatModal, setShowNewChatModal] = useState(false);
  const [newChatInitialMode, setNewChatInitialMode] =
    useState<NewChatModalMode>("TEMPLATE");
  const [simPhone, setSimPhone] = useState("");
  const [simName, setSimName] = useState("");
  const [showNoteForNonOwner, setShowNoteForNonOwner] = useState(false);
  const [templateDialogOpen, setTemplateDialogOpen] = useState(false);
  const [showAttachmentPicker, setShowAttachmentPicker] = useState(false);
  const [showLocationPopover, setShowLocationPopover] = useState(false);
  const [previewMedia, setPreviewMedia] =
    useState<NormalizedMessageMedia | null>(null);

  const lastDraftChatRef = useRef<string | null>(null);
  const timelineScrollRef = useRef<((msgId: string) => void) | null>(null);
  const composerInputRef = useRef<HTMLTextAreaElement | null>(null);

  const showToast = useCallback((msg: string) => {
    setToast(msg);
    setTimeout(() => setToast(""), 3200);
  }, []);

  const syncProfileFields = useCallback((bundle: ConversationDetailBundle) => {
    setShowNoteForNonOwner(false);
    setResolveSummary(
      bundle.acrio?.resolutionDraft ||
        `Resolved enquiry with ${bundle.conversation.customerName}.`
    );
  }, []);

  const rt = useInboxRealtimeAndData({
    initialData,
    selectedId,
    setSelectedId,
    setMobilePane,
    setTeams,
    setComposerMode,
    setTemplateDialogOpen,
    setReplyText,
    composerInputRef,
    syncProfileFields,
    showToast,
  });

  useEffect(() => {
    initSelectedId(initialData.initialSelectedId);
    if (initialData.initialSelectedId && initialData.initialDetail) {
      rt.queryClient.setQueryData(
        inboxKeys.detail(initialData.initialSelectedId),
        (existing: ConversationDetailBundle | undefined) =>
          existing ?? initialData.initialDetail ?? undefined
      );
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (lastDraftChatRef.current !== (selectedId || null)) {
      lastDraftChatRef.current = selectedId || null;
      setTemplateDialogOpen(false);
      setShowAttachmentPicker(false);
      setShowLocationPopover(false);
    }
  }, [selectedId]);

  const { detail, queryClient } = rt;
  const activeConv = detail?.conversation || null;
  const messages = detail?.messages || [];

  const internalNotes = useMemo(
    () => messages.filter((m) => m.messageType === "INTERNAL_NOTE"),
    [messages]
  );
  const sharedMediaItems = useMemo(
    () =>
      messages
        .map((m) => ({ msg: m, media: extractMessageMedia(m) }))
        .filter(
          (
            item
          ): item is { msg: ChatMessage; media: NormalizedMessageMedia } =>
            Boolean(item.media)
        ),
    [messages]
  );

  const isAcrioHandling = activeConv?.assignedStaffId === "ACRIO";
  const activeCollaborators = useMemo(
    () => activeConv?.collaborators || [],
    [activeConv?.collaborators]
  );
  const isOwnerOfActiveChat = Boolean(
    activeConv && activeConv.assignedStaffId === initialData.currentUserId
  );
  const isCollaboratorOfActiveChat = Boolean(
    activeConv &&
      activeCollaborators.some((c) => c.staffId === initialData.currentUserId)
  );
  const isAssignedToCurrentUser = Boolean(
    activeConv && (isOwnerOfActiveChat || isCollaboratorOfActiveChat)
  );
  const hasUnreadOutboundByCustomer = useMemo(
    () =>
      messages.some(
        (m) =>
          m.direction === "OUTBOUND" &&
          (m.deliveryStatus === "SENT" || m.deliveryStatus === "DELIVERED")
      ),
    [messages]
  );

  function handleSelectConversation(convId: string) {
    setMobilePane("CHAT");
    if (convId === selectedId && (detail || rt.syncingThread)) return;
    selectConversationInStore(convId);
    rt.selectedIdRef.current = convId;
    const cached = queryClient.getQueryData<ConversationDetailBundle>(
      inboxKeys.detail(convId)
    );
    if (cached) {
      rt.lastSyncedProfileConvIdRef.current = convId;
      syncProfileFields(cached);
    } else {
      rt.lastSyncedProfileConvIdRef.current = null;
    }
    void queryClient.invalidateQueries({ queryKey: inboxKeys.detail(convId) });
  }

  const handleOpenNewChatWithPhone = useCallback((phone: string) => {
    setSimPhone(phone);
    setSimName("");
    setNewChatInitialMode("TEMPLATE");
    setShowNewChatModal(true);
  }, []);

  const helpers = useInboxComposerHelpers({
    detail,
    messages,
    selectedId,
    composerMode,
    setComposerMode,
    replyText,
    setReplyText,
    setReplyingTo,
    setHighlightedMsgId,
    moveReplyDraftToNote,
    composerInputRef,
    timelineScrollRef,
    customQuickReplies,
    showToast,
  });

  const msgActions = useInboxMessagingActions({
    selectedId,
    detail,
    currentUserName: initialData.currentUserName,
    staffList,
    composerMode,
    setComposerMode,
    replyText,
    replyingTo,
    setReplyingTo,
    stagedAttachment,
    setStagedAttachment,
    setDraft,
    setPendingSendConfirm,
    setShowAttachmentPicker,
    setTemplateDialogOpen,
    setShowTrackPopover: helpers.setShowTrackPopover,
    setShowLocationPopover,
    trackOrderId: helpers.trackOrderId,
    trackBrand: helpers.trackBrand,
    trackProviderKey: helpers.trackProviderKey,
    trackAwbNumber: helpers.trackAwbNumber,
    trackProviderUrl: helpers.trackProviderUrl,
    trackButtonLabel: helpers.trackButtonLabel,
    trackMessageText: helpers.trackMessageText,
    resolveActiveVerifiedLocation: helpers.resolveActiveVerifiedLocation,
    buildVerifiedLocationMessageText: helpers.buildVerifiedLocationMessageText,
    optimisticSeqRef: rt.optimisticSeqRef,
    appendOptimisticMessage: rt.appendOptimisticMessage,
    patchOptimisticMessage: rt.patchOptimisticMessage,
    fetchAndCacheDetail: rt.fetchAndCacheDetail,
    refreshThreadsSilently: rt.refreshThreadsSilently,
    scheduleThreadsRefresh: rt.scheduleThreadsRefresh,
    showToast,
    moveDraftToNote: helpers.moveDraftToNote,
  });

  const wfActions = useInboxWorkflowActions({
    queryClient,
    selectedId,
    detail,
    currentUserId: initialData.currentUserId,
    currentUserName: initialData.currentUserName,
    teams,
    staffList,
    selectedThreadIds,
    setSelectedThreadIds,
    setBulkMode,
    assignTeamId,
    assignStaffId,
    assignTier,
    resolveSummary,
    setShowAssignModal,
    setShowResolveModal,
    setShowNoteForNonOwner,
    optimisticSeqRef: rt.optimisticSeqRef,
    appendOptimisticMessage: rt.appendOptimisticMessage,
    patchOptimisticMessage: rt.patchOptimisticMessage,
    fetchAndCacheDetail: rt.fetchAndCacheDetail,
    refreshThreadsSilently: rt.refreshThreadsSilently,
    showToast,
  });

  return (
    <div className="h-[calc(100dvh-52px)] lg:h-full w-full flex overflow-hidden bg-[#f0f2f5] select-text">
      {toast && (
        <div className="fixed bottom-20 sm:bottom-5 left-3 right-3 sm:left-auto sm:right-5 sm:max-w-sm z-50 px-3.5 py-2 rounded-lg bg-neutral-900 text-white text-xs font-medium shadow-lg text-center sm:text-left [overflow-wrap:anywhere]">
          {toast}
        </div>
      )}

      <InboxSidebarPane
        mobilePane={mobilePane}
        waitingThreadsCount={rt.waitingThreadsCount}
        acrioThreadsCount={rt.acrioThreadsCount}
        refreshingThreads={rt.refreshingThreads}
        isAdminOrSuperadmin={isAdminOrSuperadmin}
        staffList={staffList}
        teams={teams}
        onRefreshThreads={() => void rt.refreshThreadsSilently(true)}
        onOpenNewChat={() => {
          setSimPhone("");
          setSimName("");
          setNewChatInitialMode("TEMPLATE");
          setShowNewChatModal(true);
        }}
        filteredThreads={rt.filteredThreads}
        selectedId={selectedId}
        bulkMode={bulkMode}
        selectedThreadIds={selectedThreadIds}
        callbackConvIds={rt.callbackConvIds}
        unreadMentionConvIds={rt.unreadMentionConvIds}
        nowMs={rt.nowMs}
        serverNowMs={initialData.serverNowMs}
        threadsError={rt.threadsError}
        onPrefetch={rt.prefetchDetail}
        onSelect={handleSelectConversation}
        onToggleBulk={(convId, ev) => {
          if (ev) ev.stopPropagation();
          toggleBulkThreadId(convId);
        }}
        bulkBusy={wfActions.bulkBusy}
        onBulkAssignToMe={() => void wfActions.handleBulkAssignToMe()}
        onBulkResolveSelected={() => void wfActions.handleBulkResolveSelected()}
      />

      <InboxConversationPane
        mobilePane={mobilePane}
        selectedId={selectedId}
        detail={detail}
        syncingThread={rt.syncingThread}
        detailError={rt.detailError}
        emptyChatSlot={emptyChatSlot}
        fetchAndCacheDetail={rt.fetchAndCacheDetail}
        messages={messages}
        nowMs={rt.nowMs}
        isAcrioHandling={isAcrioHandling}
        hasUnreadOutboundByCustomer={hasUnreadOutboundByCustomer}
        summarizingChat={wfActions.summarizingChat}
        takingOver={wfActions.takingOver}
        handleGenerateSummary={wfActions.handleGenerateSummary}
        handleTakeOverChat={wfActions.handleTakeOverChat}
        handleSmartAssignSalesP0={wfActions.handleSmartAssignSalesP0}
        onOpenAssignModal={() => {
          if (!activeConv) return;
          setAssignTeamId(activeConv.assignedTeamId || "team_sales");
          setAssignStaffId(
            activeConv.assignedStaffId &&
              activeConv.assignedStaffId !== "ACRIO"
              ? activeConv.assignedStaffId
              : ""
          );
          setAssignTier(
            activeConv.escalationLevel === "P1" ||
              activeConv.escalationLevel === "P2"
              ? activeConv.escalationLevel
              : "P0"
          );
          setShowAssignModal(true);
        }}
        onOpenResolveModal={() => setShowResolveModal(true)}
        handleReopen={wfActions.handleReopen}
        handleReturnToAcrio={wfActions.handleReturnToAcrio}
        handleSimulateCustomerRead={msgActions.handleSimulateCustomerRead}
        showToast={showToast}
        loadingOlderMessages={rt.loadingOlderMessages}
        handleLoadOlderMessages={rt.handleLoadOlderMessages}
        staffList={staffList}
        isAssignedToCurrentUser={isAssignedToCurrentUser}
        highlightedMsgId={highlightedMsgId}
        acrioActionBusyId={msgActions.acrioActionBusyId}
        startReplyToMessage={helpers.startReplyToMessage}
        setComposerMode={setComposerMode}
        composerInputRef={composerInputRef}
        jumpToQuotedMessage={helpers.jumpToQuotedMessage}
        setPreviewMedia={setPreviewMedia}
        handleOpenNewChatWithPhone={handleOpenNewChatWithPhone}
        handleSendNoteInChat={msgActions.handleSendNoteInChat}
        handleMoveNoteToReplyBox={helpers.handleMoveNoteToReplyBox}
        handleConfirmAcrioAction={msgActions.handleConfirmAcrioAction}
        handleUploadCompanyDocForNote={msgActions.handleUploadCompanyDocForNote}
        setReplyText={setReplyText}
        timelineScrollRef={timelineScrollRef}
        showAttachmentPicker={showAttachmentPicker}
        setShowAttachmentPicker={setShowAttachmentPicker}
        showTrackPopover={helpers.showTrackPopover}
        setShowTrackPopover={helpers.setShowTrackPopover}
        showLocationPopover={showLocationPopover}
        setShowLocationPopover={setShowLocationPopover}
        showShortLinksPicker={helpers.showShortLinksPicker}
        setShowShortLinksPicker={helpers.setShowShortLinksPicker}
        replyText={replyText}
        setStagedAttachment={setStagedAttachment}
        executeComposerSend={msgActions.executeComposerSend}
        trackOrderId={helpers.trackOrderId}
        setTrackOrderId={helpers.setTrackOrderId}
        trackBrand={helpers.trackBrand}
        setTrackBrand={helpers.setTrackBrand}
        trackProviderKey={helpers.trackProviderKey}
        setTrackProviderKey={helpers.setTrackProviderKey}
        trackAwbNumber={helpers.trackAwbNumber}
        setTrackAwbNumber={helpers.setTrackAwbNumber}
        trackProviderUrl={helpers.trackProviderUrl}
        setTrackProviderUrl={helpers.setTrackProviderUrl}
        trackButtonLabel={helpers.trackButtonLabel}
        setTrackButtonLabel={helpers.setTrackButtonLabel}
        trackMessageText={helpers.trackMessageText}
        setTrackMessageText={helpers.setTrackMessageText}
        sendingTrackBtn={msgActions.sendingTrackBtn}
        openTrackPopoverForOrder={helpers.openTrackPopoverForOrder}
        handleSendOrderTracking={msgActions.handleSendOrderTracking}
        appendToComposer={helpers.appendToComposer}
        resolveActiveVerifiedLocation={helpers.resolveActiveVerifiedLocation}
        buildVerifiedLocationMessageText={
          helpers.buildVerifiedLocationMessageText
        }
        sendingLocationPin={msgActions.sendingLocationPin}
        handleSendVerifiedLocationNow={msgActions.handleSendVerifiedLocationNow}
        composerMode={composerMode}
        replyingTo={replyingTo}
        setReplyingTo={setReplyingTo}
        stagedAttachment={stagedAttachment}
        matchingQuickReplies={helpers.matchingQuickReplies}
        showNoteForNonOwner={showNoteForNonOwner}
        setShowNoteForNonOwner={setShowNoteForNonOwner}
        pendingCallback={rt.pendingCallback}
        markPendingCallbackDone={rt.markPendingCallbackDone}
        setTemplateDialogOpen={setTemplateDialogOpen}
        setShowQuickRepliesModal={setShowQuickRepliesModal}
        moveDraftToNote={helpers.moveDraftToNote}
        handleComposerSubmit={msgActions.handleComposerSubmit}
      />

      <InboxRightDrawer
        selectedId={selectedId}
        detail={detail}
        internalNotes={internalNotes}
        sharedMediaItems={sharedMediaItems}
        staffList={staffList}
        nowMs={rt.nowMs}
        syncingThread={rt.syncingThread}
        detailError={rt.detailError}
        isAssignedToCurrentUser={isAssignedToCurrentUser}
        summarizingChat={wfActions.summarizingChat}
        onRetryDetail={() =>
          selectedId && void rt.fetchAndCacheDetail(selectedId, true)
        }
        onCopyToast={showToast}
        onGenerateSummary={() => void wfActions.handleGenerateSummary()}
        onOpenTemplateDialog={() => {
          setComposerMode("TEMPLATE");
          setTemplateDialogOpen(true);
        }}
        onUseAiDraft={(reply) => {
          setComposerMode("REPLY");
          setReplyText(reply);
          composerInputRef.current?.focus();
        }}
        onSaveProfile={wfActions.handleSaveCustomerProfile}
        onAddCollaborator={wfActions.handleAddCollaborator}
        onRemoveCollaborator={wfActions.handleRemoveCollaborator}
        onAddOrder={wfActions.handleAddOrder}
        onOpenTrackPopoverForOrder={(prefill) =>
          helpers.openTrackPopoverForOrder(prefill)
        }
        onSaveQuickNote={wfActions.handleQuickNoteSave}
        onOpenNewChatWithPhone={handleOpenNewChatWithPhone}
        onOpenMediaPreview={(media) => setPreviewMedia(media)}
      />

      <InboxModalsHost
        detail={detail}
        nowMs={rt.nowMs}
        composerMode={composerMode}
        templateDialogOpen={templateDialogOpen}
        setTemplateDialogOpen={setTemplateDialogOpen}
        templates={templates}
        sendTemplateMessage={msgActions.sendTemplateMessage}
        previewMedia={previewMedia}
        setPreviewMedia={setPreviewMedia}
        pendingSendConfirm={pendingSendConfirm}
        setPendingSendConfirm={setPendingSendConfirm}
        stagedAttachment={stagedAttachment}
        replyText={replyText}
        executeComposerSend={msgActions.executeComposerSend}
        showAssignModal={showAssignModal}
        setShowAssignModal={setShowAssignModal}
        teams={teams}
        staffList={staffList}
        currentUserRole={initialData.currentUserRole}
        assignTeamId={assignTeamId}
        setAssignTeamId={setAssignTeamId}
        assignStaffId={assignStaffId}
        setAssignStaffId={setAssignStaffId}
        assignTier={assignTier}
        setAssignTier={setAssignTier}
        handleManualAssignSubmit={wfActions.handleManualAssignSubmit}
        showResolveModal={showResolveModal}
        setShowResolveModal={setShowResolveModal}
        resolveSummary={resolveSummary}
        setResolveSummary={setResolveSummary}
        handleSmartResolve={wfActions.handleSmartResolve}
        showNewChatModal={showNewChatModal}
        setShowNewChatModal={setShowNewChatModal}
        threads={rt.threads}
        simPhone={simPhone}
        simName={simName}
        newChatInitialMode={newChatInitialMode}
        handleSelectConversation={handleSelectConversation}
        onNewChatCompleted={async (convId, msg) => {
          selectConversationInStore(convId);
          rt.selectedIdRef.current = convId;
          rt.lastSyncedProfileConvIdRef.current = null;
          await Promise.all([
            rt.refreshThreadsSilently(),
            rt.fetchAndCacheDetail(convId, true),
          ]);
          showToast(msg);
        }}
        showQuickRepliesModal={showQuickRepliesModal}
        setShowQuickRepliesModal={setShowQuickRepliesModal}
        customQuickReplies={customQuickReplies}
        setCustomQuickReplies={setCustomQuickReplies}
        showToast={showToast}
      />
    </div>
  );
}
