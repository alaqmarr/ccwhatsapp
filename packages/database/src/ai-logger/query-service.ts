import crypto from "node:crypto";
import fs from "node:fs";
import {
  enqueueAsyncLogBlockAppend,
  ensureLogFileInitializedSync,
  readBoundedTailFromAiLogFile,
  readTailFromAiLogFile,
  runOneTimeMasterBackfillIfNeeded,
  syncSiblingWebsiteAiLogs,
} from "./legacy-sync";
import {
  clearAiTraceSqlite,
  insertAiTraceEntrySync,
  queryAiTraceSummaryAndEntries,
} from "./sqlite-store";
import {
  formatAiTraceBlock,
  formatUtcToIstServer,
  resolveMasterAiLogFilePath,
  resolveSiblingAiLogFilePaths,
  type AiLogsQuerySummary,
  type AiTraceLogEntry,
} from "./types-and-format";

export function appendAiTraceLog(
  input: Omit<AiTraceLogEntry, "id" | "timestampUtc" | "timestampIst"> & {
    id?: string;
    timestampUtc?: string;
  }
): AiTraceLogEntry {
  const timestampUtc = input.timestampUtc || new Date().toISOString();
  const timestampIst = formatUtcToIstServer(timestampUtc);
  const entry: AiTraceLogEntry = {
    ...input,
    id: input.id || `ail_${Date.now().toString(36)}_${crypto.randomBytes(3).toString("hex")}`,
    timestampUtc,
    timestampIst,
  };

  try {
    const inserted = insertAiTraceEntrySync(entry);
    if (inserted) {
      const filePath = resolveMasterAiLogFilePath();
      const block = formatAiTraceBlock(entry);
      enqueueAsyncLogBlockAppend(filePath, block);
    }
  } catch {
    // Never crash caller on logging I/O
  }

  return entry;
}

export function readAiTraceLogs(filters?: {
  website?: string;
  outcome?: string;
  cache?: string;
  search?: string;
  sinceUtc?: string;
  limit?: number;
}): AiLogsQuerySummary {
  runOneTimeMasterBackfillIfNeeded();
  syncSiblingWebsiteAiLogs();

  const filePath = resolveMasterAiLogFilePath();
  const dbSummary = queryAiTraceSummaryAndEntries(filters);
  const tail = readTailFromAiLogFile(filePath);

  return {
    filePath,
    fileSizeBytes: tail.fileSizeBytes,
    totalLines: tail.totalLines,
    ...dbSummary,
    rawTail: tail.rawTail,
  };
}

export function readRawAiLogFile(): { filePath: string; content: string } {
  const filePath = resolveMasterAiLogFilePath();
  ensureLogFileInitializedSync(filePath);
  return {
    filePath,
    content: readBoundedTailFromAiLogFile(filePath),
  };
}

export function clearAiTraceLogs(): { filePath: string } {
  try {
    clearAiTraceSqlite();
  } catch {
    // Non-blocking
  }
  const filePath = resolveMasterAiLogFilePath();
  if (fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    fs.unlinkSync(/*turbopackIgnore: true*/ filePath);
  }
  for (const sib of resolveSiblingAiLogFilePaths()) {
    try {
      fs.unlinkSync(/*turbopackIgnore: true*/ sib);
    } catch {
      // Ignore
    }
  }
  ensureLogFileInitializedSync(filePath);
  return { filePath };
}
