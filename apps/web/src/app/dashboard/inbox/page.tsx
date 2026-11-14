"use client";

import React, { useCallback, useEffect, useRef, useState } from "react";
import {
  Check,
  CheckCheck,
  Clock,
  ExternalLink,
  Link2,
  MessageSquarePlus,
  Package,
  Plus,
  RefreshCw,
  RotateCcw,
  Send,
  X,
} from "lucide-react";
import { WHATSAPP_PUBLIC_ORIGIN, WhatsAppLogoIcon } from "@cc/ui";

interface ConversationSummary {
  id: string;
  customerPhone: string;
  customerName: string;
  customerId: string | null;
  status: string;
  priority: string;
  smartCategory: string;
  assignedStaffId: string | null;
  assignedStaffName: string | null;
  unreadCount: number;
  lastMessagePreview: string;
  lastMessageAt: string;
  windowExpiresAt: string | null;
  resolutionSummary: string | null;
  resolvedByName: string | null;
  tags: string[];
}

interface ChatMessage {
  id: string;
  direction: string;
  senderType: string;
  senderName: string;
  messageType: string;
  billingCategory: string;
  body: string;
  templateName: string | null;
  deliveryStatus: string;
  createdAt: string;
}

interface CustomerProfile {
  id: string;
  phone: string;
  name: string;
  email: string | null;
  companyName: string | null;
  organizationType: string;
  city: string | null;
  gstNumber: string | null;
  acrioSegment: string;
  lifetimeValueInr: number;
  totalOrdersCount: number;
  notes: string;
}

interface CustomerOrder {
  id: string;
  orderNumber: string;
  itemsSummary: string;
  quantity: number;
  totalAmountInr: number;
  paymentStatus: string;
  fulfillmentStatus: string;
  invoiceUrl: string | null;
  orderedAt: string;
}

interface CustomerRelation {
  id: string;
  relationType: string;
  summary: string;
  handledBy: string;
  occurredAt: string;
}

interface WebsiteEnquiry {
  id: string;
  name: string;
  email: string;
  phone: string;
  message: string;
  source: string;
  status: string;
  createdAt: string;
}

interface AcrioCopilot {
  engineLabel: string;
  smartCategory: string;
  priority: string;
  suggestedReplies: string[];
  recommendedProducts: {
    name: string;
    slug: string;
    sku: string | null;
    priceInr: number | null;
    url: string;
  }[];
  resolutionDraft: string;
}

interface CustomLinkItem {
  id: string;
  code: string;
  title: string;
  targetUrl: string;
  linkType: string;
  clicksCount: number;
}

interface StaffMember {
  id: string;
  name: string;
  email: string;
  role: string;
  department: string | null;
  status?: string;
}

const CATEGORIES = [
  "ALL",
  "Podiums & Stage",
  "Awards & Trophies",
  "Hotel & Banquet",
  "Custom Fabrication",
  "Order & Delivery",
  "General Enquiry",
];

function formatRelationType(raw: string): string {
  switch (raw) {
    case "WHATSAPP_RESOLVED":
      return "Past Chat";
    case "WEBSITE_ENQUIRY":
      return "Website Enquiry";
    case "REPEAT_ORDER":
      return "Repeat Buyer";
    case "CUSTOM_FABRICATION":
      return "Custom Order";
    default:
      return raw.replace(/_/g, " ");
  }
}

export default function InboxDashboardPage() {
  const [threads, setThreads] = useState<ConversationSummary[]>([]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [statusFilter, setStatusFilter] = useState<string>("ALL");
  const [categoryFilter, setCategoryFilter] = useState<string>("ALL");
  const [mineOnly, setMineOnly] = useState<boolean>(false);

  const [detailLoading, setDetailLoading] = useState<boolean>(false);
  const [activeConv, setActiveConv] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [customer, setCustomer] = useState<CustomerProfile | null>(null);
  const [orders, setOrders] = useState<CustomerOrder[]>([]);
  const [relations, setRelations] = useState<CustomerRelation[]>([]);
  const [websiteEnquiries, setWebsiteEnquiries] = useState<WebsiteEnquiry[]>([]);
  const [acrio, setAcrio] = useState<AcrioCopilot | null>(null);
  const [customLinks, setCustomLinks] = useState<CustomLinkItem[]>([]);
  const [staffList, setStaffList] = useState<StaffMember[]>([]);

  // Composer state
  const [draftText, setDraftText] = useState<string>("");
  const [billingCategory, setBillingCategory] = useState<
    "UTILITY" | "SERVICE" | "MARKETING" | "AUTHENTICATION"
  >("SERVICE");
  const [sending, setSending] = useState<boolean>(false);
  const [acrioOpen, setAcrioOpen] = useState<boolean>(true);

  // Modals
  const [showSimulateModal, setShowSimulateModal] = useState<boolean>(false);
  const [simPhone, setSimPhone] = useState<string>("+919820112233");
  const [simName, setSimName] = useState<string>("Vikram Mehta (Taj Banquets)");
  const [simOrg, setSimOrg] = useState<string>("Hotel");
  const [simText, setSimText] = useState<string>(
    "Hello Classic Concepts! Do you have clear acrylic stage podiums with front logo printing ready by Friday?"
  );
  const [simSubmitting, setSimSubmitting] = useState<boolean>(false);

  const [showResolveModal, setShowResolveModal] = useState<boolean>(false);
  const [resolveSummary, setResolveSummary] = useState<string>("");
  const [resolveCategory, setResolveCategory] = useState<string>("General Enquiry");
  const [resolving, setResolving] = useState<boolean>(false);

  // Customer sidebar forms
  const [sidebarTab, setSidebarTab] = useState<"profile" | "orders" | "relations">("profile");
  const [editCompany, setEditCompany] = useState<string>("");
  const [editOrgType, setEditOrgType] = useState<string>("");
  const [editCity, setEditCity] = useState<string>("");
  const [editSegment, setEditSegment] = useState<string>("");
  const [editNotes, setEditNotes] = useState<string>("");
  const [savingProfile, setSavingProfile] = useState<boolean>(false);
  const [profileSavedToast, setProfileSavedToast] = useState<string>("");

  const [showAddOrder, setShowAddOrder] = useState<boolean>(false);
  const [orderItems, setOrderItems] = useState<string>("");
  const [orderQty, setOrderQty] = useState<string>("1");
  const [orderAmount, setOrderAmount] = useState<string>("");
  const [orderPayment, setOrderPayment] = useState<string>("ADVANCE_PAID");
  const [orderFulfillment, setOrderFulfillment] = useState<string>("IN_PRODUCTION");
  const [addingOrder, setAddingOrder] = useState<boolean>(false);

  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const selectedIdRef = useRef<string | null>(null);
  selectedIdRef.current = selectedId;

  const loadThreads = useCallback(async () => {
    const params = new URLSearchParams();
    if (statusFilter !== "ALL") params.set("status", statusFilter);
    if (categoryFilter !== "ALL") params.set("category", categoryFilter);
    if (mineOnly) params.set("mine", "1");

    const res = await fetch(`/api/conversations?${params.toString()}`, {
      cache: "no-store",
    });
    const data = await res.json().catch(() => ({}));
    if (data.ok && Array.isArray(data.conversations)) {
      setThreads(data.conversations);
      if (!selectedIdRef.current && data.conversations.length > 0) {
        setSelectedId(data.conversations[0].id);
      }
    }
  }, [statusFilter, categoryFilter, mineOnly]);

  const loadThreadDetail = useCallback(async (id: string) => {
    setDetailLoading(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(id)}`, {
        cache: "no-store",
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setActiveConv(data.conversation);
        setMessages(data.messages || []);
        setCustomer(data.customer || null);
        setOrders(data.orders || []);
        setRelations(data.relations || []);
        setWebsiteEnquiries(data.websiteEnquiries || []);
        setAcrio(data.acrio || null);
        setCustomLinks(data.customLinks || []);

        if (data.customer) {
          setEditCompany(data.customer.companyName || "");
          setEditOrgType(data.customer.organizationType || "Business");
          setEditCity(data.customer.city || "");
          setEditSegment(data.customer.acrioSegment || "Active Lead");
          setEditNotes(data.customer.notes || "");
        }
        if (data.acrio) {
          setResolveSummary(data.acrio.resolutionDraft || "");
          setResolveCategory(
            data.acrio.smartCategory ||
              data.conversation.smartCategory ||
              "General Enquiry"
          );
        }
      }
    } finally {
      setDetailLoading(false);
    }
  }, []);

  useEffect(() => {
    loadThreads();
  }, [loadThreads]);

  useEffect(() => {
    fetch("/api/staff", { cache: "no-store" })
      .then((r) => r.json())
      .then((d) => {
        if (d.ok && Array.isArray(d.staff)) {
          setStaffList(
            d.staff.filter((s: StaffMember) => !s.status || s.status === "ACTIVE")
          );
        }
      })
      .catch(() => {});
  }, []);

  useEffect(() => {
    if (selectedId) {
      loadThreadDetail(selectedId);
    }
  }, [selectedId, loadThreadDetail]);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages.length]);

  useEffect(() => {
    const es = new EventSource("/api/realtime/stream");
    es.onmessage = (evt) => {
      try {
        const parsed = JSON.parse(evt.data);
        if (
          parsed?.type === "message:new" ||
          parsed?.type === "conversation:assigned" ||
          parsed?.type === "conversation:resolved"
        ) {
          loadThreads();
          if (selectedIdRef.current) {
            loadThreadDetail(selectedIdRef.current);
          }
        }
      } catch {
        // Ignore keepalive
      }
    };
    return () => es.close();
  }, [loadThreads, loadThreadDetail]);

  async function handleSendMessage(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !draftText.trim() || sending) return;
    setSending(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "send_message",
          text: draftText.trim(),
          billingCategory,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setDraftText("");
        await Promise.all([loadThreadDetail(selectedId), loadThreads()]);
      }
    } finally {
      setSending(false);
    }
  }

  async function handleAssignStaff(staffId: string) {
    if (!selectedId) return;
    const chosen = staffList.find((s) => s.id === staffId);
    await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        action: "assign_staff",
        staffId: chosen?.id,
        staffName: chosen?.name,
      }),
    });
    await Promise.all([loadThreadDetail(selectedId), loadThreads()]);
  }

  async function handleSmartResolve(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || resolving) return;
    setResolving(true);
    try {
      await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "smart_resolve",
          resolutionSummary: resolveSummary,
          smartCategory: resolveCategory,
        }),
      });
      setShowResolveModal(false);
      await Promise.all([loadThreadDetail(selectedId), loadThreads()]);
    } finally {
      setResolving(false);
    }
  }

  async function handleReopen() {
    if (!selectedId) return;
    await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "reopen" }),
    });
    await Promise.all([loadThreadDetail(selectedId), loadThreads()]);
  }

  async function handleSimulateInbound(e: React.FormEvent) {
    e.preventDefault();
    if (simSubmitting) return;
    setSimSubmitting(true);
    try {
      const res = await fetch("/api/conversations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          customerPhone: simPhone,
          customerName: simName,
          organizationType: simOrg,
          messageText: simText,
          direction: "INBOUND",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok && data.conversationId) {
        setShowSimulateModal(false);
        await loadThreads();
        setSelectedId(data.conversationId);
        await loadThreadDetail(data.conversationId);
      }
    } finally {
      setSimSubmitting(false);
    }
  }

  async function handleSaveCustomerProfile(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || savingProfile) return;
    setSavingProfile(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "update_customer_profile",
          companyName: editCompany,
          organizationType: editOrgType,
          city: editCity,
          acrioSegment: editSegment,
          notes: editNotes,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setProfileSavedToast("Saved");
        setTimeout(() => setProfileSavedToast(""), 2500);
        await loadThreadDetail(selectedId);
      }
    } finally {
      setSavingProfile(false);
    }
  }

  async function handleCreateOrder(e: React.FormEvent) {
    e.preventDefault();
    if (!selectedId || !orderItems.trim() || addingOrder) return;
    setAddingOrder(true);
    try {
      const res = await fetch(`/api/conversations/${encodeURIComponent(selectedId)}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "add_order",
          itemsSummary: orderItems.trim(),
          quantity: Number(orderQty || 1),
          totalAmountInr: Number(orderAmount || 0),
          paymentStatus: orderPayment,
          fulfillmentStatus: orderFulfillment,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (data.ok) {
        setOrderItems("");
        setOrderQty("1");
        setOrderAmount("");
        setShowAddOrder(false);
        await loadThreadDetail(selectedId);
      }
    } finally {
      setAddingOrder(false);
    }
  }

  function insertIntoDraft(snippet: string) {
    setDraftText((prev) => (prev ? `${prev} ${snippet}` : snippet));
  }

  const ratePreview = billingCategory === "MARKETING" ? "₹0.95" : "₹0.30";

  return (
    <div className="flex-1 w-full flex flex-col lg:flex-row h-screen overflow-hidden bg-white">
      {/* LEFT COLUMN: Chat List */}
      <section className="w-full lg:w-84 bg-white border-r border-neutral-200 flex flex-col shrink-0 max-h-[38vh] lg:max-h-none">
        <div className="p-3.5 border-b border-neutral-200 space-y-2.5">
          <div className="flex items-center justify-between gap-2">
            <h1 className="text-sm font-semibold text-neutral-900">
              Customer Chats
            </h1>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={() => loadThreads()}
                title="Refresh"
                className="p-1.5 rounded border border-neutral-200 text-neutral-600 hover:bg-neutral-50 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setShowSimulateModal(true)}
                className="inline-flex items-center gap-1 px-2.5 py-1.5 rounded bg-[#1da851] hover:bg-[#178c43] text-white text-xs font-medium cursor-pointer"
              >
                <MessageSquarePlus className="w-3.5 h-3.5" />
                <span>Test Chat</span>
              </button>
            </div>
          </div>

          {/* Filter Tabs */}
          <div className="flex flex-wrap gap-1">
            {[
              { id: "ALL", label: "All" },
              { id: "OPEN", label: "Unassigned" },
              { id: "ASSIGNED", label: "Assigned" },
              { id: "RESOLVED", label: "Resolved" },
            ].map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setStatusFilter(tab.id)}
                className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                  statusFilter === tab.id
                    ? "bg-neutral-900 text-white"
                    : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
                }`}
              >
                {tab.label}
              </button>
            ))}
            <button
              type="button"
              onClick={() => setMineOnly((v) => !v)}
              className={`px-2.5 py-1 rounded text-xs font-medium cursor-pointer ${
                mineOnly
                  ? "bg-blue-700 text-white"
                  : "bg-neutral-100 text-neutral-700 hover:bg-neutral-200"
              }`}
            >
              Mine Only
            </button>
          </div>

          <select
            value={categoryFilter}
            onChange={(e) => setCategoryFilter(e.target.value)}
            className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs text-neutral-800"
          >
            {CATEGORIES.map((c) => (
              <option key={c} value={c}>
                {c === "ALL" ? "All Product Topics" : c}
              </option>
            ))}
          </select>
        </div>

        <div className="flex-1 overflow-y-auto divide-y divide-neutral-200">
          {threads.length === 0 ? (
            <div className="p-6 text-center text-xs text-neutral-500">
              No chats in this view. Click{" "}
              <strong className="text-neutral-800">Test Chat</strong> above to try
              a sample customer message.
            </div>
          ) : (
            threads.map((t) => {
              const selected = t.id === selectedId;
              return (
                <button
                  key={t.id}
                  type="button"
                  onClick={() => setSelectedId(t.id)}
                  className={`w-full text-left p-3.5 transition-colors cursor-pointer ${
                    selected
                      ? "bg-neutral-100 border-l-2 border-l-neutral-900"
                      : "hover:bg-neutral-50"
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <div className="font-medium text-xs text-neutral-900 truncate">
                      {t.customerName}
                    </div>
                    <span className="text-[11px] text-neutral-400 shrink-0">
                      {new Date(t.lastMessageAt).toLocaleTimeString([], {
                        hour: "2-digit",
                        minute: "2-digit",
                      })}
                    </span>
                  </div>
                  <div className="text-xs text-neutral-500 truncate mt-0.5">
                    {t.lastMessagePreview || t.customerPhone}
                  </div>
                  <div className="flex flex-wrap items-center gap-1.5 mt-2">
                    <span className="px-1.5 py-0.5 rounded bg-neutral-100 border border-neutral-200 text-neutral-700 text-[11px]">
                      {t.smartCategory}
                    </span>
                    {t.assignedStaffName && (
                      <span className="text-[11px] text-neutral-500 truncate">
                        • {t.assignedStaffName}
                      </span>
                    )}
                    {t.status === "RESOLVED" && (
                      <span className="text-[11px] text-emerald-700 font-medium">
                        • Resolved
                      </span>
                    )}
                    {t.unreadCount > 0 && (
                      <span className="ml-auto px-1.5 py-0.5 rounded-full bg-[#1da851] text-white text-[10px] font-semibold">
                        {t.unreadCount}
                      </span>
                    )}
                  </div>
                </button>
              );
            })
          )}
        </div>
      </section>

      {/* CENTER COLUMN: Messages + ACRIO Suggestions + Reply Box */}
      <section className="flex-1 flex flex-col min-w-0 bg-neutral-50">
        {!activeConv ? (
          <div className="flex-1 flex items-center justify-center p-8 text-center">
            <div className="max-w-sm space-y-2">
              <div className="w-10 h-10 rounded-md bg-[#1da851]/15 text-[#1da851] flex items-center justify-center mx-auto">
                <WhatsAppLogoIcon size={22} />
              </div>
              <h2 className="text-sm font-semibold text-neutral-900">
                Select a Customer Chat
              </h2>
              <p className="text-xs text-neutral-500">
                Pick any customer on the left to read messages, send replies, or
                check past orders.
              </p>
            </div>
          </div>
        ) : (
          <>
            {/* Top Bar */}
            <header className="bg-white border-b border-neutral-200 px-4 py-3 flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="flex items-center gap-2">
                  <h2 className="text-sm font-semibold text-neutral-900">
                    {activeConv.customerName}
                  </h2>
                  <span className="text-xs text-neutral-500">
                    {activeConv.customerPhone}
                  </span>
                  <span className="px-2 py-0.5 rounded bg-neutral-100 text-neutral-700 text-[11px] font-medium">
                    {activeConv.smartCategory}
                  </span>
                </div>
                <div className="flex items-center gap-3 text-xs text-neutral-500 mt-0.5">
                  <span className="inline-flex items-center gap-1">
                    <Clock className="w-3 h-3 text-emerald-600" />
                    24-hour reply window open
                  </span>
                  {activeConv.resolutionSummary && (
                    <span className="text-emerald-700 truncate max-w-md">
                      Note: {activeConv.resolutionSummary}
                    </span>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <select
                  value={activeConv.assignedStaffId || ""}
                  onChange={(e) => {
                    if (e.target.value) handleAssignStaff(e.target.value);
                  }}
                  className="rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-medium text-neutral-800"
                >
                  <option value="">
                    {activeConv.assignedStaffName
                      ? `Assigned: ${activeConv.assignedStaffName}`
                      : "Assign to staff..."}
                  </option>
                  {staffList.map((s) => (
                    <option key={s.id} value={s.id}>
                      {s.name}
                    </option>
                  ))}
                </select>

                {activeConv.status === "RESOLVED" ? (
                  <button
                    type="button"
                    onClick={handleReopen}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-white hover:bg-neutral-50 text-neutral-800 border border-neutral-300 text-xs font-medium cursor-pointer"
                  >
                    <RotateCcw className="w-3.5 h-3.5" />
                    <span>Reopen</span>
                  </button>
                ) : (
                  <button
                    type="button"
                    onClick={() => setShowResolveModal(true)}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                    <span>Mark Resolved</span>
                  </button>
                )}
              </div>
            </header>

            {/* Messages Area */}
            <div className="flex-1 overflow-y-auto p-4 space-y-3">
              {detailLoading && messages.length === 0 ? (
                <div className="text-center text-xs text-neutral-500 py-8">
                  Loading messages...
                </div>
              ) : (
                messages.map((m) => {
                  const isOutbound = m.direction === "OUTBOUND";
                  return (
                    <div
                      key={m.id}
                      className={`flex ${
                        isOutbound ? "justify-end" : "justify-start"
                      }`}
                    >
                      <div
                        className={`max-w-[78%] rounded-lg px-3.5 py-2.5 border ${
                          isOutbound
                            ? "bg-[#e7f8e2] border-[#cdeac4] text-neutral-900"
                            : "bg-white border-neutral-200 text-neutral-900"
                        }`}
                      >
                        <div className="flex items-center justify-between gap-4 mb-1 text-[11px] text-neutral-500">
                          <span className="font-medium text-neutral-700">
                            {m.senderName}
                          </span>
                          <span>
                            {new Date(m.createdAt).toLocaleTimeString([], {
                              hour: "2-digit",
                              minute: "2-digit",
                            })}
                          </span>
                        </div>
                        <p className="text-sm leading-relaxed whitespace-pre-wrap">
                          {m.body}
                        </p>
                        {isOutbound && (
                          <div className="flex items-center justify-end gap-1 mt-1 text-[11px] text-neutral-500">
                            {m.deliveryStatus === "READ" ||
                            m.deliveryStatus === "DELIVERED" ? (
                              <CheckCheck className="w-3.5 h-3.5 text-sky-600" />
                            ) : (
                              <Check className="w-3.5 h-3.5 text-neutral-400" />
                            )}
                          </div>
                        )}
                      </div>
                    </div>
                  );
                })
              )}
              <div ref={messagesEndRef} />
            </div>

            {/* Light-Mode ACRIO Suggested Replies Bar */}
            {acrio && (
              <div className="bg-white border-t border-neutral-200 px-4 py-2.5">
                <div className="flex items-center justify-between gap-2">
                  <div className="text-xs font-medium text-neutral-700">
                    Suggested replies from ACRIO ({acrio.smartCategory})
                  </div>
                  <button
                    type="button"
                    onClick={() => setAcrioOpen((v) => !v)}
                    className="text-xs text-neutral-500 hover:text-neutral-900 cursor-pointer"
                  >
                    {acrioOpen ? "Hide" : "Show"}
                  </button>
                </div>

                {acrioOpen && (
                  <div className="mt-2 space-y-2">
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-2">
                      {acrio.suggestedReplies.map((reply, idx) => (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => setDraftText(reply)}
                          className="text-left p-2.5 rounded-md bg-neutral-50 hover:bg-neutral-100 border border-neutral-200 text-xs text-neutral-800 line-clamp-2 cursor-pointer"
                          title={reply}
                        >
                          {reply}
                        </button>
                      ))}
                    </div>

                    <div className="flex flex-wrap items-center gap-1.5">
                      {acrio.recommendedProducts.map((prod) => (
                        <button
                          key={prod.slug}
                          type="button"
                          onClick={() =>
                            insertIntoDraft(
                              `${prod.name}${
                                prod.priceInr ? ` (Rs ${prod.priceInr})` : ""
                              }: ${prod.url}`
                            )
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-neutral-100 hover:bg-neutral-200 border border-neutral-200 text-[11px] font-medium text-neutral-800 cursor-pointer"
                        >
                          <span>+ {prod.name}</span>
                        </button>
                      ))}

                      {customLinks.slice(0, 3).map((lnk) => (
                        <button
                          key={lnk.id}
                          type="button"
                          onClick={() =>
                            insertIntoDraft(`${WHATSAPP_PUBLIC_ORIGIN}/l/${lnk.code}`)
                          }
                          className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-blue-50 hover:bg-blue-100 border border-blue-200 text-[11px] font-medium text-blue-900 cursor-pointer"
                        >
                          <Link2 className="w-3 h-3" />
                          <span>whatsapp.ccapl.cc/l/{lnk.code}</span>
                        </button>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}

            {/* Message Box */}
            <form
              onSubmit={handleSendMessage}
              className="bg-white border-t border-neutral-200 p-3 space-y-2"
            >
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                <div className="flex items-center gap-2">
                  <label className="text-neutral-600 font-medium">
                    Message type:
                  </label>
                  <select
                    value={billingCategory}
                    onChange={(e) =>
                      setBillingCategory(
                        e.target.value as
                          | "UTILITY"
                          | "SERVICE"
                          | "MARKETING"
                          | "AUTHENTICATION"
                      )
                    }
                    className="rounded border border-neutral-300 bg-white px-2 py-1 text-xs text-neutral-800"
                  >
                    <option value="SERVICE">Customer Support Reply (₹0.30)</option>
                    <option value="UTILITY">Order / Delivery Update (₹0.30)</option>
                    <option value="AUTHENTICATION">Verification Code (₹0.30)</option>
                    <option value="MARKETING">Marketing / Offer (₹0.95)</option>
                  </select>
                </div>
                <span className="text-neutral-500">
                  Charge: <strong className="text-neutral-900">{ratePreview}</strong>
                </span>
              </div>

              <div className="flex items-end gap-2">
                <textarea
                  rows={2}
                  value={draftText}
                  onChange={(e) => setDraftText(e.target.value)}
                  placeholder="Type your message here..."
                  className="flex-1 rounded-md border border-neutral-300 px-3 py-2 text-sm text-neutral-900 focus:outline-none focus:border-neutral-900"
                />
                <button
                  type="submit"
                  disabled={sending || !draftText.trim()}
                  className="inline-flex items-center gap-1.5 px-4 py-2.5 rounded-md bg-[#1da851] hover:bg-[#178c43] disabled:opacity-50 text-white text-sm font-medium cursor-pointer"
                >
                  <Send className="w-4 h-4" />
                  <span>{sending ? "Sending..." : "Send"}</span>
                </button>
              </div>
            </form>
          </>
        )}
      </section>

      {/* RIGHT COLUMN: Customer Details, Orders & Past History */}
      <aside className="w-full lg:w-84 bg-white border-l border-neutral-200 flex flex-col shrink-0 overflow-y-auto">
        <div className="p-3.5 border-b border-neutral-200">
          <h3 className="text-sm font-semibold text-neutral-900">
            Customer Information
          </h3>
          <div className="grid grid-cols-3 gap-1 mt-2.5 bg-neutral-100 p-1 rounded-md">
            {[
              { id: "profile", label: "Details" },
              { id: "orders", label: `Orders (${orders.length})` },
              {
                id: "relations",
                label: `History (${relations.length + websiteEnquiries.length})`,
              },
            ].map((t) => (
              <button
                key={t.id}
                type="button"
                onClick={() =>
                  setSidebarTab(t.id as "profile" | "orders" | "relations")
                }
                className={`py-1.5 rounded text-xs font-medium cursor-pointer ${
                  sidebarTab === t.id
                    ? "bg-white text-neutral-900 shadow-2xs"
                    : "text-neutral-600 hover:text-neutral-900"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
        </div>

        {!activeConv ? (
          <div className="p-6 text-xs text-neutral-400 text-center">
            Select a chat to view customer details and order history.
          </div>
        ) : sidebarTab === "profile" ? (
          <div className="p-4 space-y-4 text-xs">
            <div className="grid grid-cols-2 gap-2">
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200">
                <div className="text-neutral-500">Total Spent</div>
                <div className="text-base font-semibold text-neutral-900 mt-0.5">
                  ₹{(customer?.lifetimeValueInr ?? 0).toLocaleString("en-IN")}
                </div>
              </div>
              <div className="p-3 rounded-md bg-neutral-50 border border-neutral-200">
                <div className="text-neutral-500">Past Orders</div>
                <div className="text-base font-semibold text-neutral-900 mt-0.5">
                  {customer?.totalOrdersCount ?? orders.length}
                </div>
              </div>
            </div>

            <form onSubmit={handleSaveCustomerProfile} className="space-y-3">
              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  Company / School / Hotel
                </label>
                <input
                  type="text"
                  value={editCompany}
                  onChange={(e) => setEditCompany(e.target.value)}
                  placeholder="e.g. Taj Lands End"
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900"
                />
              </div>

              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">
                    Business Type
                  </label>
                  <input
                    type="text"
                    value={editOrgType}
                    onChange={(e) => setEditOrgType(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900"
                  />
                </div>
                <div>
                  <label className="block text-neutral-600 font-medium mb-1">
                    City
                  </label>
                  <input
                    type="text"
                    value={editCity}
                    onChange={(e) => setEditCity(e.target.value)}
                    placeholder="Hyderabad"
                    className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900"
                  />
                </div>
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  Customer Group
                </label>
                <input
                  type="text"
                  value={editSegment}
                  onChange={(e) => setEditSegment(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900"
                />
              </div>

              <div>
                <label className="block text-neutral-600 font-medium mb-1">
                  Notes
                </label>
                <textarea
                  rows={3}
                  value={editNotes}
                  onChange={(e) => setEditNotes(e.target.value)}
                  placeholder="Logo details, preferred sizes, GST number..."
                  className="w-full rounded-md border border-neutral-300 px-2.5 py-1.5 text-xs text-neutral-900"
                />
              </div>

              <button
                type="submit"
                disabled={savingProfile}
                className="w-full py-2 rounded-md bg-neutral-900 hover:bg-neutral-800 text-white text-xs font-medium cursor-pointer"
              >
                {savingProfile ? "Saving..." : "Save Details"}
              </button>
              {profileSavedToast && (
                <p className="text-xs font-medium text-emerald-700 text-center">
                  {profileSavedToast}
                </p>
              )}
            </form>
          </div>
        ) : sidebarTab === "orders" ? (
          <div className="p-4 space-y-3 text-xs">
            <div className="flex items-center justify-between">
              <span className="font-medium text-neutral-800">Orders</span>
              <button
                type="button"
                onClick={() => setShowAddOrder((v) => !v)}
                className="inline-flex items-center gap-1 px-2.5 py-1 rounded bg-neutral-900 text-white text-xs font-medium cursor-pointer"
              >
                <Plus className="w-3 h-3" />
                <span>Add Order</span>
              </button>
            </div>

            {showAddOrder && (
              <form
                onSubmit={handleCreateOrder}
                className="p-3 rounded-md bg-neutral-50 border border-neutral-200 space-y-2"
              >
                <input
                  type="text"
                  required
                  value={orderItems}
                  onChange={(e) => setOrderItems(e.target.value)}
                  placeholder="Items (e.g. 2x Clear Podium CCP-053)"
                  className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                />
                <div className="grid grid-cols-2 gap-2">
                  <input
                    type="number"
                    min={1}
                    value={orderQty}
                    onChange={(e) => setOrderQty(e.target.value)}
                    placeholder="Qty"
                    className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                  <input
                    type="number"
                    min={0}
                    required
                    value={orderAmount}
                    onChange={(e) => setOrderAmount(e.target.value)}
                    placeholder="Amount ₹"
                    className="w-full rounded border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <select
                    value={orderPayment}
                    onChange={(e) => setOrderPayment(e.target.value)}
                    className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="ADVANCE_PAID">Advance Paid</option>
                    <option value="PAID">Paid in Full</option>
                    <option value="PENDING">Unpaid</option>
                  </select>
                  <select
                    value={orderFulfillment}
                    onChange={(e) => setOrderFulfillment(e.target.value)}
                    className="rounded border border-neutral-300 bg-white px-2 py-1.5 text-xs"
                  >
                    <option value="IN_PRODUCTION">In Production</option>
                    <option value="READY_DISPATCH">Ready to Dispatch</option>
                    <option value="DELIVERED">Delivered</option>
                  </select>
                </div>
                <button
                  type="submit"
                  disabled={addingOrder}
                  className="w-full py-1.5 rounded bg-[#1da851] text-white font-medium text-xs cursor-pointer"
                >
                  {addingOrder ? "Saving..." : "Save Order"}
                </button>
              </form>
            )}

            {orders.length === 0 ? (
              <p className="text-neutral-400 py-4 text-center">
                No orders saved for this customer yet.
              </p>
            ) : (
              orders.map((o) => (
                <div
                  key={o.id}
                  className="p-3 rounded-md border border-neutral-200 bg-neutral-50/70 space-y-1.5"
                >
                  <div className="flex items-center justify-between">
                    <span className="font-semibold text-neutral-900 flex items-center gap-1">
                      <Package className="w-3.5 h-3.5 text-neutral-600" />
                      {o.orderNumber}
                    </span>
                    <span className="font-semibold text-neutral-900">
                      ₹{o.totalAmountInr.toLocaleString("en-IN")}
                    </span>
                  </div>
                  <p className="text-neutral-700">
                    {o.itemsSummary} (Qty: {o.quantity})
                  </p>
                  <div className="flex items-center justify-between text-[11px] text-neutral-500">
                    <span>{o.fulfillmentStatus.replace(/_/g, " ")}</span>
                    <span>{o.paymentStatus.replace(/_/g, " ")}</span>
                  </div>
                </div>
              ))
            )}
          </div>
        ) : (
          <div className="p-4 space-y-3 text-xs">
            <div className="font-medium text-neutral-800">
              Past Enquiries & Notes
            </div>
            {relations.map((r) => (
              <div
                key={r.id}
                className="p-3 rounded-md border border-neutral-200 bg-neutral-50/60 space-y-1"
              >
                <div className="flex items-center justify-between text-[11px] text-neutral-500">
                  <span className="font-medium text-neutral-800">
                    {formatRelationType(r.relationType)}
                  </span>
                  <span>{new Date(r.occurredAt).toLocaleDateString()}</span>
                </div>
                <p className="text-neutral-700 leading-relaxed">{r.summary}</p>
                <div className="text-[11px] text-neutral-500">
                  By {r.handledBy}
                </div>
              </div>
            ))}

            {websiteEnquiries.map((w) => (
              <div
                key={w.id}
                className="p-3 rounded-md border border-amber-200 bg-amber-50/50 space-y-1"
              >
                <div className="flex items-center justify-between text-[11px]">
                  <span className="inline-flex items-center gap-1 font-medium text-amber-900">
                    <ExternalLink className="w-3 h-3" />
                    Website Form Enquiry
                  </span>
                  <span className="text-amber-800">{w.status}</span>
                </div>
                <p className="text-neutral-700">{w.message}</p>
              </div>
            ))}

            {relations.length === 0 && websiteEnquiries.length === 0 && (
              <p className="text-neutral-400 py-4 text-center">
                No earlier history yet.
              </p>
            )}
          </div>
        )}
      </aside>

      {/* MODAL 1: Test Incoming Customer Message */}
      {showSimulateModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-neutral-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Send a Test Customer Message
              </h3>
              <button
                type="button"
                onClick={() => setShowSimulateModal(false)}
                className="p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <p className="text-xs text-neutral-500">
              Try out how a new customer enquiry appears in the inbox with ACRIO
              reply suggestions.
            </p>
            <form onSubmit={handleSimulateInbound} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Customer Phone Number
                </label>
                <input
                  type="text"
                  required
                  value={simPhone}
                  onChange={(e) => setSimPhone(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
              <div className="grid grid-cols-2 gap-2">
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Customer Name
                  </label>
                  <input
                    type="text"
                    required
                    value={simName}
                    onChange={(e) => setSimName(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2"
                  />
                </div>
                <div>
                  <label className="block font-medium text-neutral-700 mb-1">
                    Business Type
                  </label>
                  <input
                    type="text"
                    value={simOrg}
                    onChange={(e) => setSimOrg(e.target.value)}
                    className="w-full rounded-md border border-neutral-300 px-3 py-2"
                  />
                </div>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Message
                </label>
                <textarea
                  rows={3}
                  required
                  value={simText}
                  onChange={(e) => setSimText(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowSimulateModal(false)}
                  className="px-3.5 py-2 rounded-md border border-neutral-300 font-medium text-neutral-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={simSubmitting}
                  className="px-4 py-2 rounded-md bg-[#1da851] text-white font-medium cursor-pointer"
                >
                  {simSubmitting ? "Sending..." : "Send Test Message"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* MODAL 2: Mark Chat Resolved */}
      {showResolveModal && (
        <div className="fixed inset-0 z-50 bg-black/40 flex items-center justify-center p-4">
          <div className="bg-white rounded-lg border border-neutral-200 max-w-md w-full p-5 space-y-4">
            <div className="flex items-center justify-between">
              <h3 className="text-sm font-semibold text-neutral-900">
                Mark Chat as Resolved
              </h3>
              <button
                type="button"
                onClick={() => setShowResolveModal(false)}
                className="p-1 text-neutral-400 hover:text-neutral-700 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
            <form onSubmit={handleSmartResolve} className="space-y-3 text-xs">
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Product Topic
                </label>
                <select
                  value={resolveCategory}
                  onChange={(e) => setResolveCategory(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                >
                  {CATEGORIES.filter((c) => c !== "ALL").map((c) => (
                    <option key={c} value={c}>
                      {c}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block font-medium text-neutral-700 mb-1">
                  Closing Note (saved to customer history)
                </label>
                <textarea
                  rows={3}
                  required
                  value={resolveSummary}
                  onChange={(e) => setResolveSummary(e.target.value)}
                  className="w-full rounded-md border border-neutral-300 px-3 py-2"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowResolveModal(false)}
                  className="px-3.5 py-2 rounded-md border border-neutral-300 font-medium text-neutral-700 cursor-pointer"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  disabled={resolving}
                  className="px-4 py-2 rounded-md bg-neutral-900 text-white font-medium cursor-pointer"
                >
                  {resolving ? "Saving..." : "Mark Resolved"}
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}
