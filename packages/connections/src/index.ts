/**
 * Modular barrel entrypoint for @cc/connections.
 * Core AI & WhatsApp modules live in dedicated *.acrio.ai.ts / *.acrio.ops.ts files.
 */
export const LOCKED_CLAUDE_MODEL = "claude-haiku-5-5" as const;

export * from "./image-intelligence";
export {
  type AnthropicCacheControl,
  type AnthropicSystemTextBlock,
  type ClaudeMessageInput,
  type ClaudeMessagesCallParams,
  type DetailedClaudeCallResult,
  buildOrderedClaudeSystemBlocks,
  buildCacheAwareClaudeMessages,
  buildClaudeMessagesRequestBody,
  parseClaudeJson,
  callClaudeHaikuMessagesDetailed,
  callClaudeHaikuMessages,
  recordAndBroadcastAiLog,
  mapProductToLogItem,
  formatWhatsAppOutboundText,
  sanitizePlainEnglish,
  stripRepeatedGreeting,
} from "./initialise.acrio.ai";
export * from "./whatsapp-cloud.acrio.ai";
export * from "./helpers.acrio.ai";
export * from "./interactive.acrio.ai";
export * from "./concierge.acrio.ai";
export * from "./staff-copilot.acrio.ai";
export * from "./marketing-templates.acrio.ai";
export * from "./backups.acrio.ops";
export * from "./email-alerts.acrio.ops";
export * from "./issues-identifier.acrio.ai";
export * from "./anthropic-usage-spend";
