"use client";

import React, { useMemo, useState } from "react";
import { Bot } from "lucide-react";

export interface MentionPerson {
  id: string;
  name: string;
  role?: string;
}

/**
 * Textarea that opens a small list when you type "@": pick a teammate to ping them,
 * or "ACRIO" to ask ACRIO a question that it answers in a private note.
 */
export function MentionTextarea({
  value,
  onChange,
  people,
  rows = 2,
  placeholder,
  className,
  textareaRef,
  onKeyDown,
  enabled = true,
  onPickMention,
}: {
  value: string;
  onChange: (next: string) => void;
  people: MentionPerson[];
  rows?: number;
  placeholder?: string;
  className?: string;
  textareaRef?: React.RefObject<HTMLTextAreaElement | null>;
  onKeyDown?: (e: React.KeyboardEvent<HTMLTextAreaElement>) => void;
  /** Turn mention suggestions on or off. */
  enabled?: boolean;
  /** Called when someone picks a name from the list (used to switch a reply box into note mode). */
  onPickMention?: () => void;
}) {
  const [caret, setCaret] = useState(0);
  const [active, setActive] = useState(0);
  const [dismissedAt, setDismissedAt] = useState<number | null>(null);
  const innerRef = React.useRef<HTMLTextAreaElement | null>(null);
  const ref = textareaRef || innerRef;

  const trigger = useMemo(() => {
    if (!enabled) return null;
    const before = value.slice(0, caret);
    const m = before.match(/(^|[\s(])@([A-Za-z0-9._-]*(?: [A-Za-z0-9._-]*)?)$/);
    if (!m) return null;
    const start = before.length - m[2].length - 1; // index of "@"
    if (dismissedAt === start) return null;
    return { start, query: m[2] };
  }, [value, caret, enabled, dismissedAt]);

  const options = useMemo(() => {
    if (!trigger) return [];
    const q = trigger.query.trim().toLowerCase();
    const all: (MentionPerson & { isAcrio?: boolean })[] = [
      { id: "ACRIO", name: "ACRIO", role: "Ask a question", isAcrio: true },
      ...people,
    ];
    return all
      .filter((p) => {
        if (!q) return true;
        const name = p.name.toLowerCase();
        return name.startsWith(q) || name.split(/\s+/).some((w) => w.startsWith(q));
      })
      .slice(0, 6);
  }, [people, trigger]);

  const open = Boolean(trigger) && options.length > 0;

  function pick(person: MentionPerson) {
    if (!trigger) return;
    const before = value.slice(0, trigger.start);
    const after = value.slice(caret);
    const insert = `@${person.name} `;
    const next = `${before}${insert}${after}`;
    onChange(next);
    onPickMention?.();
    setActive(0);
    const pos = before.length + insert.length;
    requestAnimationFrame(() => {
      const el = ref.current;
      if (el) {
        el.focus();
        el.setSelectionRange(pos, pos);
        setCaret(pos);
      }
    });
  }

  return (
    <div className="relative flex-1 min-w-0">
      {open && (
        <div className="absolute bottom-full left-0 mb-1.5 w-64 max-w-full rounded-lg bg-white border border-neutral-200 shadow-xl overflow-hidden z-40">
          <div className="px-2.5 py-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400 bg-slate-50 border-b border-neutral-100">
            Mention a teammate or ACRIO
          </div>
          {options.map((p, i) => (
            <button
              key={p.id}
              type="button"
              onMouseDown={(e) => {
                e.preventDefault();
                pick(p);
              }}
              onMouseEnter={() => setActive(i)}
              className={`w-full flex items-center gap-2 px-2.5 py-1.5 text-left text-xs cursor-pointer ${
                i === active ? "bg-emerald-50" : "bg-white"
              }`}
            >
              <span
                className={`w-5 h-5 rounded-full shrink-0 flex items-center justify-center text-[10px] font-bold ${
                  p.id === "ACRIO" ? "bg-violet-100 text-violet-700" : "bg-amber-100 text-amber-800"
                }`}
              >
                {p.id === "ACRIO" ? <Bot className="w-3 h-3" /> : p.name.charAt(0).toUpperCase()}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-semibold text-slate-900 truncate">{p.name}</span>
                {p.role && <span className="block text-[10px] text-slate-500 truncate">{p.role}</span>}
              </span>
            </button>
          ))}
        </div>
      )}
      <textarea
        ref={ref as React.RefObject<HTMLTextAreaElement>}
        rows={rows}
        value={value}
        placeholder={placeholder}
        className={className}
        onChange={(e) => {
          onChange(e.target.value);
          setCaret(e.target.selectionStart ?? e.target.value.length);
          setDismissedAt(null);
        }}
        onClick={(e) => setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0)}
        onKeyUp={(e) => {
          if (["ArrowLeft", "ArrowRight", "Home", "End"].includes(e.key)) {
            setCaret((e.target as HTMLTextAreaElement).selectionStart ?? 0);
          }
        }}
        onKeyDown={(e) => {
          if (open) {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => (a + 1) % options.length);
              return;
            }
            if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => (a - 1 + options.length) % options.length);
              return;
            }
            if (e.key === "Enter" || e.key === "Tab") {
              e.preventDefault();
              pick(options[Math.min(active, options.length - 1)]);
              return;
            }
            if (e.key === "Escape") {
              e.preventDefault();
              if (trigger) setDismissedAt(trigger.start);
              return;
            }
          }
          onKeyDown?.(e);
        }}
      />
    </div>
  );
}
