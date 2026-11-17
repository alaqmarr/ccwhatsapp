"use client";

import React, { useState } from "react";
import { Pencil, Plus, Trash2, Users, X, Zap } from "lucide-react";
import type { QuickReplyItem } from "@/lib/inbox-server-data";

export function QuickRepliesModal({
  open,
  onClose,
  customReplies,
  builtInReplies,
  onSaved,
}: {
  open: boolean;
  onClose: () => void;
  customReplies: QuickReplyItem[];
  builtInReplies: readonly { cmd: string; title: string; body: string }[];
  onSaved: (next: QuickReplyItem[]) => void;
}) {
  const [editingId, setEditingId] = useState<string | null>(null);
  const [cmd, setCmd] = useState("/");
  const [title, setTitle] = useState("");
  const [body, setBody] = useState("");
  const [isShared, setIsShared] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  if (!open) return null;

  function resetForm() {
    setEditingId(null);
    setCmd("/");
    setTitle("");
    setBody("");
    setIsShared(false);
    setError("");
  }

  function startEdit(item: QuickReplyItem) {
    setEditingId(item.id);
    setCmd(item.cmd);
    setTitle(item.title);
    setBody(item.body);
    setIsShared(item.isShared);
    setError("");
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "upsert",
          id: editingId || undefined,
          cmd,
          title,
          body,
          isShared,
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not save quick reply.");
        return;
      }
      if (Array.isArray(data.quickReplies)) {
        onSaved(data.quickReplies);
      }
      resetForm();
    } catch {
      setError("Network error while saving quick reply.");
    } finally {
      setSaving(false);
    }
  }

  async function handleDelete(id: string) {
    setSaving(true);
    setError("");
    try {
      const res = await fetch("/api/quick-replies", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "delete", id }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data.ok) {
        setError(data.error || "Could not delete quick reply.");
        return;
      }
      if (Array.isArray(data.quickReplies)) {
        onSaved(data.quickReplies);
      }
      if (editingId === id) resetForm();
    } catch {
      setError("Network error while deleting quick reply.");
    } finally {
      setSaving(false);
    }
  }

  const myReplies = customReplies.filter((r) => r.isMine);
  const sharedByOthers = customReplies.filter((r) => !r.isMine && r.isShared);

  return (
    <div className="fixed inset-0 z-50 bg-black/45 flex items-center justify-center p-4">
      <div className="w-full max-w-2xl max-h-[88vh] bg-white rounded-xl border border-neutral-200 shadow-2xl flex flex-col overflow-hidden">
        <div className="px-5 py-3.5 border-b border-neutral-200 flex items-center justify-between bg-[#f0f2f5]">
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 rounded-full bg-[#e7fce3] text-[#008069] flex items-center justify-center">
              <Zap className="w-4 h-4" />
            </div>
            <div>
              <h3 className="text-sm font-semibold text-neutral-900">
                Your Quick Replies (/)
              </h3>
              <p className="text-[11px] text-neutral-500">
                Type a slash command like /price in any chat reply to insert it right away.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 rounded-md text-neutral-500 hover:text-neutral-800 hover:bg-neutral-200/70 cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto p-5 space-y-5">
          <form
            onSubmit={handleSave}
            className="rounded-lg border border-neutral-200 bg-neutral-50/70 p-4 space-y-3"
          >
            <div className="flex items-center justify-between">
              <span className="text-xs font-semibold text-neutral-800 flex items-center gap-1.5">
                <Plus className="w-3.5 h-3.5 text-[#008069]" />
                <span>{editingId ? "Edit Quick Reply" : "Add New Quick Reply"}</span>
              </span>
              {editingId && (
                <button
                  type="button"
                  onClick={resetForm}
                  className="text-[11px] text-neutral-600 hover:text-neutral-900 underline cursor-pointer"
                >
                  Cancel edit
                </button>
              )}
            </div>

            {error && (
              <div className="px-3 py-2 rounded-md bg-red-50 border border-red-200 text-xs text-red-700">
                {error}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-2.5">
              <div>
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Slash Shortcut
                </label>
                <input
                  type="text"
                  required
                  value={cmd}
                  onChange={(e) => {
                    let v = e.target.value.replace(/\s+/g, "").toLowerCase();
                    if (!v.startsWith("/")) v = `/${v}`;
                    setCmd(v);
                  }}
                  placeholder="/delivery"
                  className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs font-mono"
                />
              </div>
              <div className="sm:col-span-2">
                <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                  Short Label
                </label>
                <input
                  type="text"
                  required
                  value={title}
                  onChange={(e) => setTitle(e.target.value)}
                  placeholder="Standard Delivery Timeline"
                  className="w-full rounded-md border border-neutral-300 bg-white px-2.5 py-1.5 text-xs"
                />
              </div>
            </div>

            <div>
              <label className="block text-[11px] font-medium text-neutral-700 mb-1">
                Message Text
              </label>
              <textarea
                rows={3}
                required
                value={body}
                onChange={(e) => setBody(e.target.value)}
                placeholder="Type the exact WhatsApp message you want this shortcut to insert..."
                className="w-full rounded-md border border-neutral-300 bg-white p-2.5 text-xs"
              />
            </div>

            <div className="flex flex-wrap items-center justify-between gap-2">
              <label className="inline-flex items-center gap-2 text-xs text-neutral-700 cursor-pointer">
                <input
                  type="checkbox"
                  checked={isShared}
                  onChange={(e) => setIsShared(e.target.checked)}
                  className="rounded border-neutral-300 accent-[#00a884]"
                />
                <span>Share with the rest of the team</span>
              </label>

              <button
                type="submit"
                disabled={saving}
                className="px-4 py-1.5 rounded-md bg-[#00a884] hover:bg-[#008f6f] text-white text-xs font-semibold cursor-pointer disabled:opacity-50"
              >
                {saving
                  ? "Saving..."
                  : editingId
                  ? "Update Quick Reply"
                  : "Save Quick Reply"}
              </button>
            </div>
          </form>

          <div className="space-y-2.5">
            <h4 className="text-xs font-semibold text-neutral-800">
              My Saved Replies ({myReplies.length})
            </h4>
            {myReplies.length === 0 ? (
              <p className="text-xs text-neutral-500">
                You have not added any personal quick replies yet. Create one above for messages you send often.
              </p>
            ) : (
              <div className="space-y-2">
                {myReplies.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-neutral-200 p-3 flex items-start justify-between gap-3 bg-white"
                  >
                    <div className="min-w-0 space-y-1">
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-semibold text-[#008069] bg-[#e7fce3] px-1.5 py-0.5 rounded">
                          {item.cmd}
                        </span>
                        <span className="text-xs font-semibold text-neutral-900">
                          {item.title}
                        </span>
                        {item.isShared && (
                          <span className="inline-flex items-center gap-1 text-[10px] px-1.5 py-0.5 rounded bg-blue-50 text-blue-700 font-medium">
                            <Users className="w-2.5 h-2.5" />
                            <span>Shared</span>
                          </span>
                        )}
                      </div>
                      <p className="text-xs text-neutral-600 whitespace-pre-wrap">
                        {item.body}
                      </p>
                    </div>
                    <div className="flex items-center gap-1 shrink-0">
                      <button
                        type="button"
                        onClick={() => startEdit(item)}
                        title="Edit quick reply"
                        className="p-1.5 rounded hover:bg-neutral-100 text-neutral-600 cursor-pointer"
                      >
                        <Pencil className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDelete(item.id)}
                        title="Delete quick reply"
                        className="p-1.5 rounded hover:bg-red-50 text-red-600 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>

          {sharedByOthers.length > 0 && (
            <div className="space-y-2">
              <h4 className="text-xs font-semibold text-neutral-800">
                Shared by Teammates ({sharedByOthers.length})
              </h4>
              <div className="space-y-1.5">
                {sharedByOthers.map((item) => (
                  <div
                    key={item.id}
                    className="rounded-lg border border-neutral-200 p-2.5 bg-neutral-50/70 space-y-1"
                  >
                    <div className="flex items-center gap-2 text-xs">
                      <span className="font-mono font-semibold text-[#008069]">
                        {item.cmd}
                      </span>
                      <span className="font-semibold text-neutral-900">
                        {item.title}
                      </span>
                      <span className="text-[10.5px] text-neutral-500">
                        by {item.staffName}
                      </span>
                    </div>
                    <p className="text-xs text-neutral-600">{item.body}</p>
                  </div>
                ))}
              </div>
            </div>
          )}

          <div className="space-y-2">
            <h4 className="text-xs font-semibold text-neutral-800">
              Built-in Desk Replies ({builtInReplies.length})
            </h4>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              {builtInReplies.map((b) => (
                <div
                  key={b.cmd}
                  className="rounded-lg border border-neutral-200 p-2.5 bg-white space-y-0.5"
                >
                  <div className="text-xs font-semibold text-neutral-900">
                    <span className="font-mono text-[#008069] mr-1.5">
                      {b.cmd}
                    </span>
                    {b.title}
                  </div>
                  <p className="text-[11px] text-neutral-500 line-clamp-2">
                    {b.body}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
