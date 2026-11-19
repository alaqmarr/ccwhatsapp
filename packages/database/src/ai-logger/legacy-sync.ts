import fs from "node:fs";
import path from "node:path";
import {
  batchInsertAiTraceEntriesSync,
  getSyncStateOffset,
  hasAnyAiTraceRows,
  upsertSyncStateOffset,
} from "./sqlite-store";
import {
  AI_LOGS_FILE_HEADER,
  extractEntriesFromRawContent,
  formatAiTraceBlock,
  resolveMasterAiLogFilePath,
  resolveSiblingAiLogFilePaths,
  type AiTraceLogEntry,
} from "./types-and-format";

const MAX_AI_LOG_BYTES = 16 * 1024 * 1024;
const TAIL_READ_BYTES = 64 * 1024;
const RAW_TAIL_MAX_BYTES = 512 * 1024;

let textAppendChain: Promise<void> = Promise.resolve();

export function ensureLogFileInitializedSync(filePath: string): void {
  const dir = path.dirname(/*turbopackIgnore: true*/ filePath);
  if (!fs.existsSync(/*turbopackIgnore: true*/ dir)) {
    fs.mkdirSync(dir, { recursive: true });
  }
  if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
    fs.writeFileSync(/*turbopackIgnore: true*/ filePath, AI_LOGS_FILE_HEADER, "utf8");
  }
}

async function rotateLogFileIfNeededAsync(filePath: string): Promise<void> {
  try {
    const stat = await fs.promises.stat(/*turbopackIgnore: true*/ filePath);
    if (stat.size <= MAX_AI_LOG_BYTES) return;
    const raw = await fs.promises.readFile(/*turbopackIgnore: true*/ filePath, "utf8");
    const sliceStart = Math.floor(raw.length * 0.4);
    const nextBoundary = raw.indexOf(
      "================================================================================",
      sliceStart
    );
    const trimmed =
      nextBoundary !== -1 ? raw.slice(nextBoundary) : raw.slice(sliceStart);
    await fs.promises.writeFile(
      /*turbopackIgnore: true*/ filePath,
      `# [Rotated ai.logs at ${new Date().toISOString()}]\n\n${trimmed}`,
      "utf8"
    );
  } catch {
    // Non-blocking
  }
}

/**
 * Queues a non-blocking fire-and-forget append of formatted text blocks to `ai.logs`.
 */
export function enqueueAsyncLogBlockAppend(filePath: string, blocksText: string): void {
  if (!blocksText) return;
  textAppendChain = textAppendChain
    .then(async () => {
      const dir = path.dirname(/*turbopackIgnore: true*/ filePath);
      await fs.promises.mkdir(dir, { recursive: true });
      try {
        await fs.promises.access(/*turbopackIgnore: true*/ filePath);
      } catch {
        await fs.promises.writeFile(/*turbopackIgnore: true*/ filePath, AI_LOGS_FILE_HEADER, "utf8");
      }
      await fs.promises.appendFile(/*turbopackIgnore: true*/ filePath, `${blocksText}\n`, "utf8");
      await rotateLogFileIfNeededAsync(filePath);
    })
    .catch(() => {
      // Never crash caller on logging I/O
    });
}

/**
 * Reads only the last 64 KB of `ai.logs` for fast rawTail rendering without loading multi-MB files.
 */
export function readTailFromAiLogFile(
  filePath: string,
  maxBytes = TAIL_READ_BYTES,
  maxLines = 600
): { fileSizeBytes: number; totalLines: number; rawTail: string } {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      return { fileSizeBytes: 0, totalLines: 0, rawTail: "" };
    }
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    const fileSizeBytes = stat.size;
    if (fileSizeBytes === 0) {
      return { fileSizeBytes: 0, totalLines: 0, rawTail: "" };
    }

    const bytesToRead = Math.min(fileSizeBytes, maxBytes);
    const startOffset = Math.max(0, fileSizeBytes - bytesToRead);
    const buf = Buffer.allocUnsafe(bytesToRead);
    const fd = fs.openSync(/*turbopackIgnore: true*/ filePath, "r");
    try {
      const bytesRead = fs.readSync(fd, buf, 0, bytesToRead, startOffset);
      const chunk = buf.subarray(0, bytesRead).toString("utf8");
      const lines = chunk.split(/\r?\n/);
      // If we started mid-line, drop the first partial line
      const cleanLines = startOffset > 0 && lines.length > 1 ? lines.slice(1) : lines;
      const totalLines =
        startOffset === 0
          ? cleanLines.length
          : Math.max(
              cleanLines.length,
              Math.round((cleanLines.length / Math.max(1, bytesRead)) * fileSizeBytes)
            );
      return {
        fileSizeBytes,
        totalLines,
        rawTail: cleanLines.slice(-maxLines).join("\n"),
      };
    } finally {
      fs.closeSync(fd);
    }
  } catch {
    return { fileSizeBytes: 0, totalLines: 0, rawTail: "" };
  }
}

/**
 * Reads up to `maxBytes` (default 512 KB) from the tail of `ai.logs` using bounded file-descriptor I/O
 * so multi-MB log files never load entirely into RAM.
 */
export function readBoundedTailFromAiLogFile(
  filePath: string,
  maxBytes = RAW_TAIL_MAX_BYTES
): string {
  try {
    if (!fs.existsSync(/*turbopackIgnore: true*/ filePath)) {
      return "";
    }
    const stat = fs.statSync(/*turbopackIgnore: true*/ filePath);
    const fileSizeBytes = stat.size;
    if (fileSizeBytes === 0) {
      return "";
    }

    const bytesToRead = Math.min(fileSizeBytes, Math.max(1, maxBytes));
    const startOffset = Math.max(0, fileSizeBytes - bytesToRead);
    const buf = Buffer.allocUnsafe(bytesToRead);
    const fd = fs.openSync(/*turbopackIgnore: true*/ filePath, "r");
    let totalRead = 0;
    try {
      while (totalRead < bytesToRead) {
        const read = fs.readSync(
          fd,
          buf,
          totalRead,
          bytesToRead - totalRead,
          startOffset + totalRead
        );
        if (read <= 0) break;
        totalRead += read;
      }
    } finally {
      fs.closeSync(fd);
    }

    if (totalRead === 0) {
      return "";
    }

    const slice = buf.subarray(0, totalRead);
    if (startOffset === 0) {
      return slice.toString("utf8");
    }

    // Align after the first newline so we never split a multi-byte UTF-8 sequence or log line
    const firstNewlineIdx = slice.indexOf(0x0a);
    const aligned =
      firstNewlineIdx !== -1 ? slice.subarray(firstNewlineIdx + 1) : slice;
    const notice = `# [Showing last ${Math.round(bytesToRead / 1024)} KB of ${fileSizeBytes} bytes from ai.logs]\n`;
    return `${notice}${aligned.toString("utf8")}`;
  } catch {
    return "";
  }
}

function readCompleteLinesFromOffset(
  filePath: string,
  startOffset: number,
  fileSize: number
): { text: string; nextOffset: number } {
  if (fileSize <= startOffset) {
    return { text: "", nextOffset: fileSize };
  }
  const len = fileSize - startOffset;
  const buf = Buffer.allocUnsafe(len);
  const fd = fs.openSync(/*turbopackIgnore: true*/ filePath, "r");
  try {
    const bytesRead = fs.readSync(fd, buf, 0, len, startOffset);
    const slice = buf.subarray(0, bytesRead);
    const lastNewlineIdx = slice.lastIndexOf(0x0a);
    if (lastNewlineIdx === -1) {
      return {
        text: slice.toString("utf8"),
        nextOffset: startOffset + bytesRead,
      };
    }
    return {
      text: slice.subarray(0, lastNewlineIdx + 1).toString("utf8"),
      nextOffset: startOffset + lastNewlineIdx + 1,
    };
  } finally {
    fs.closeSync(fd);
  }
}

/**
 * One-time backfill from existing master `ai.logs` into SQLite on first read when `ai_trace_logs` is empty.
 */
export function runOneTimeMasterBackfillIfNeeded(): void {
  try {
    const masterPath = path.resolve(/*turbopackIgnore: true*/ resolveMasterAiLogFilePath());
    if (hasAnyAiTraceRows()) return;
    if (getSyncStateOffset(masterPath)) return;
    if (!fs.existsSync(/*turbopackIgnore: true*/ masterPath)) {
      upsertSyncStateOffset(masterPath, 0, 0);
      return;
    }

    const stat = fs.statSync(/*turbopackIgnore: true*/ masterPath);
    if (stat.size === 0) {
      upsertSyncStateOffset(masterPath, 0, 0);
      return;
    }

    const CHUNK = 512 * 1024;
    let offset = 0;
    while (offset < stat.size) {
      const end = Math.min(stat.size, offset + CHUNK);
      const { text, nextOffset } = readCompleteLinesFromOffset(masterPath, offset, end);
      if (text) {
        const entries = extractEntriesFromRawContent(text);
        if (entries.length > 0) {
          batchInsertAiTraceEntriesSync(entries);
        }
      }
      if (nextOffset <= offset) break;
      offset = nextOffset;
    }
    upsertSyncStateOffset(masterPath, offset, stat.size);
  } catch {
    // Non-blocking backfill
  }
}

/**
 * Incrementally reads unseen trace entries from sibling `ai.logs` files using persisted byte offsets,
 * inserts them into SQLite, and appends formatted blocks asynchronously to master `ai.logs`.
 */
export function syncSiblingWebsiteAiLogs(): number {
  let importedCount = 0;
  try {
    const masterPath = resolveMasterAiLogFilePath();
    const siblingPaths = resolveSiblingAiLogFilePaths();
    const blocksToAppend: string[] = [];

    for (const sibPath of siblingPaths) {
      try {
        const stat = fs.statSync(/*turbopackIgnore: true*/ sibPath);
        const prev = getSyncStateOffset(sibPath);
        if (prev && stat.size === prev.lastByteOffset && stat.size >= prev.lastSizeBytes) {
          continue;
        }
        const startOffset =
          prev && stat.size >= prev.lastSizeBytes ? prev.lastByteOffset : 0;
        const { text, nextOffset } = readCompleteLinesFromOffset(
          sibPath,
          startOffset,
          stat.size
        );
        if (text) {
          const sibEntries: AiTraceLogEntry[] = extractEntriesFromRawContent(text);
          if (sibEntries.length > 0) {
            const added = batchInsertAiTraceEntriesSync(sibEntries);
            importedCount += added;
            if (added > 0) {
              for (const entry of sibEntries) {
                blocksToAppend.push(formatAiTraceBlock(entry));
              }
            }
          }
        }
        upsertSyncStateOffset(sibPath, nextOffset, stat.size);
      } catch {
        // Ignore unreadable sibling log
      }
    }

    if (blocksToAppend.length > 0) {
      enqueueAsyncLogBlockAppend(masterPath, blocksToAppend.join("\n"));
    }
  } catch {
    // Non-blocking
  }
  return importedCount;
}
