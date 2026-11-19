import React from "react";
import { normalizeInlinePhoneCandidate } from "./helpers";

const h = React.createElement;

export function stripWhatsAppFormatting(text: string): string {
  if (!text) return "";
  return String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\\n/g, " ")
    .replace(/```([\s\S]*?)```/g, "$1")
    .replace(/`([^`\n]+)`/g, "$1")
    .replace(/\*\*([^*\n]+)\*\*/g, "$1")
    .replace(
      /(?<![a-zA-Z0-9])\*([^\s*\n](?:[^*\n]*[^\s*\n])?)\*(?![a-zA-Z0-9])/g,
      "$1"
    )
    .replace(
      /(?<![a-zA-Z0-9])_([^\s_\n](?:[^_\n]*[^\s_\n])?)_(?![a-zA-Z0-9])/g,
      "$1"
    )
    .replace(
      /(?<![a-zA-Z0-9])~([^\s~\n](?:[^~\n]*[^\s~\n])?)~(?![a-zA-Z0-9])/g,
      "$1"
    )
    .replace(/\s*\n+\s*/g, " ")
    .replace(/\s{2,}/g, " ")
    .trim();
}

function renderWhatsAppInline(
  input: string,
  keyPrefix: string,
  depth = 0,
  onPhoneClick?: (phone: string, rawDisplay: string) => void
): React.ReactNode[] {
  if (!input) return [];
  if (depth > 2) return [input];

  const nodes: React.ReactNode[] = [];
  const tokenRegex =
    /(`[^`\n]+`)|(https?:\/\/[^\s<]+)|(\*\*[^*\n]+\*\*)|((?<![a-zA-Z0-9])\*[^\s*\n](?:[^*\n]*[^\s*\n])?\*(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9])_[^\s_\n](?:[^_\n]*[^\s_\n])?_(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9])~[^\s~\n](?:[^~\n]*[^\s~\n])?~(?![a-zA-Z0-9]))|((?<![a-zA-Z0-9₹$#/.+-])(?:\+\d{1,3}[\s.-]?(?:\(?\d{2,5}\)?[\s.-]?){2,4}\d{2,5}|(?:0|91[\s.-]?)?[6-9]\d{4}[\s.-]?\d{5}|(?:0|91[\s.-]?)?[6-9]\d{2}[\s.-]?\d{3}[\s.-]?\d{4})(?![a-zA-Z0-9]))/g;

  let lastIdx = 0;
  let match: RegExpExecArray | null;
  let tokenCount = 0;

  while ((match = tokenRegex.exec(input)) !== null) {
    const start = match.index;
    const raw = match[0];

    if (start > lastIdx) {
      nodes.push(input.slice(lastIdx, start));
    }

    const k = `${keyPrefix}_t${tokenCount++}`;

    if (match[1]) {
      nodes.push(
        h(
          "code",
          {
            key: k,
            className:
              "px-1 py-0.5 rounded bg-black/[0.06] font-mono text-[0.9em] text-gray-900",
          },
          raw.slice(1, -1)
        )
      );
      lastIdx = start + raw.length;
    } else if (match[2]) {
      // URL: trim trailing punctuation cleanly
      let cleanUrl = raw;
      let trailing = "";
      while (/[.,;:!?)]$/.test(cleanUrl)) {
        if (
          cleanUrl.endsWith(")") &&
          (cleanUrl.match(/\(/g) || []).length >=
            (cleanUrl.match(/\)/g) || []).length
        ) {
          break;
        }
        trailing = cleanUrl.slice(-1) + trailing;
        cleanUrl = cleanUrl.slice(0, -1);
      }
      nodes.push(
        h(
          "a",
          {
            key: k,
            href: cleanUrl,
            target: "_blank",
            rel: "noopener noreferrer",
            onClick: (e: React.MouseEvent<HTMLAnchorElement>) =>
              e.stopPropagation(),
            className:
              "text-[#027eb5] hover:underline break-all font-medium [overflow-wrap:anywhere]",
          },
          cleanUrl
        )
      );
      if (trailing) nodes.push(trailing);
      lastIdx = start + raw.length;
    } else if (match[3]) {
      const inner = raw.slice(2, -2);
      nodes.push(
        h(
          "strong",
          { key: k, className: "font-semibold text-gray-950" },
          ...renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)
        )
      );
      lastIdx = start + raw.length;
    } else if (match[4]) {
      const inner = raw.slice(1, -1);
      nodes.push(
        h(
          "strong",
          { key: k, className: "font-semibold text-gray-950" },
          ...renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)
        )
      );
      lastIdx = start + raw.length;
    } else if (match[5]) {
      const inner = raw.slice(1, -1);
      nodes.push(
        h(
          "em",
          { key: k, className: "italic" },
          ...renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)
        )
      );
      lastIdx = start + raw.length;
    } else if (match[6]) {
      const inner = raw.slice(1, -1);
      nodes.push(
        h(
          "del",
          { key: k, className: "line-through opacity-80" },
          ...renderWhatsAppInline(inner, k, depth + 1, onPhoneClick)
        )
      );
      lastIdx = start + raw.length;
    } else if (match[7]) {
      const normalizedPhone = onPhoneClick
        ? normalizeInlinePhoneCandidate(raw)
        : null;
      if (normalizedPhone && onPhoneClick) {
        nodes.push(
          h(
            "button",
            {
              key: k,
              type: "button",
              onClick: (e: React.MouseEvent<HTMLButtonElement>) => {
                e.stopPropagation();
                onPhoneClick(normalizedPhone, raw.trim());
              },
              title: `Open or start WhatsApp chat with ${normalizedPhone}`,
              className:
                "inline text-[#008069] hover:text-[#006452] underline decoration-[#00a884]/60 underline-offset-2 font-medium cursor-pointer",
            },
            raw
          )
        );
      } else {
        nodes.push(raw);
      }
      lastIdx = start + raw.length;
    } else {
      nodes.push(raw);
      lastIdx = start + raw.length;
    }
  }

  if (lastIdx < input.length) {
    nodes.push(input.slice(lastIdx));
  }

  return nodes;
}

export const WhatsAppFormattedText = React.memo(function WhatsAppFormattedText({
  text,
  className = "",
  onPhoneClick,
}: {
  text: string;
  className?: string;
  onPhoneClick?: (phone: string, rawDisplay: string) => void;
}) {
  if (!text) return null;

  const normalized = String(text)
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n")
    .replace(/\\n/g, "\n");

  // Split by fenced ```code blocks``` first
  const segments = normalized.split(/(```[\s\S]*?```)/g);

  return h(
    "div",
    {
      className: `min-w-0 max-w-full whitespace-pre-wrap break-words [overflow-wrap:anywhere] leading-[1.48] ${className}`,
    },
    segments.map((seg, segIdx) => {
      if (seg.startsWith("```") && seg.endsWith("```") && seg.length >= 6) {
        const codeBody = seg.slice(3, -3).replace(/^\n+|\n+$/g, "");
        return h(
          "pre",
          {
            key: `cb_${segIdx}`,
            className:
              "my-1.5 p-2 rounded-md bg-black/[0.06] font-mono text-[12px] leading-relaxed max-w-full overflow-x-auto whitespace-pre-wrap break-all",
          },
          codeBody
        );
      }

      const lines = seg.split("\n");
      return h(
        React.Fragment,
        { key: `seg_${segIdx}` },
        lines.map((line, lineIdx) => {
          const isLastLine = lineIdx === lines.length - 1;
          const trimmed = line.trimStart();

          // Empty line produces clean paragraph spacing
          if (line.trim() === "") {
            return !isLastLine
              ? h("div", { key: `br_${segIdx}_${lineIdx}`, className: "h-2" })
              : null;
          }

          // Blockquote (> text)
          if (/^>\s+/.test(trimmed)) {
            const quoteText = trimmed.replace(/^>\s+/, "");
            return h(
              "div",
              {
                key: `q_${segIdx}_${lineIdx}`,
                className:
                  "my-0.5 pl-2.5 border-l-2 border-emerald-600/50 text-gray-700 min-w-0 [overflow-wrap:anywhere]",
              },
              ...renderWhatsAppInline(
                quoteText,
                `q_${segIdx}_${lineIdx}`,
                0,
                onPhoneClick
              )
            );
          }

          // Bullet list
          const bulletMatch = trimmed.match(/^(?:[•●▪-]\s+|\*\s+)(.+)$/);
          if (bulletMatch) {
            return h(
              "div",
              {
                key: `ul_${segIdx}_${lineIdx}`,
                className: "flex items-start gap-1.5 my-0.5 min-w-0",
              },
              h(
                "span",
                {
                  className:
                    "select-none text-current opacity-75 shrink-0 leading-[1.48]",
                },
                "•"
              ),
              h(
                "span",
                { className: "min-w-0 flex-1 [overflow-wrap:anywhere]" },
                ...renderWhatsAppInline(
                  bulletMatch[1],
                  `ul_${segIdx}_${lineIdx}`,
                  0,
                  onPhoneClick
                )
              )
            );
          }

          // Numbered list (1. text)
          const numMatch = trimmed.match(/^(\d{1,2}[.)])\s+(.+)$/);
          if (numMatch) {
            return h(
              "div",
              {
                key: `ol_${segIdx}_${lineIdx}`,
                className: "flex items-start gap-1.5 my-0.5 min-w-0",
              },
              h(
                "span",
                { className: "font-semibold shrink-0 leading-[1.48]" },
                numMatch[1]
              ),
              h(
                "span",
                { className: "min-w-0 flex-1 [overflow-wrap:anywhere]" },
                ...renderWhatsAppInline(
                  numMatch[2],
                  `ol_${segIdx}_${lineIdx}`,
                  0,
                  onPhoneClick
                )
              )
            );
          }

          return h(
            React.Fragment,
            { key: `ln_${segIdx}_${lineIdx}` },
            ...renderWhatsAppInline(
              line,
              `ln_${segIdx}_${lineIdx}`,
              0,
              onPhoneClick
            ),
            !isLastLine && lines[lineIdx + 1]?.trim() !== "" ? "\n" : null
          );
        })
      );
    })
  );
});
