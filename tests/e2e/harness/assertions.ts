import assert, { AssertionError } from "node:assert";

export const FORBIDDEN_AI_BUZZWORDS = [
  "bespoke",
  "elevate",
  "delve",
  "meticulous",
  "unparalleled",
  "seamless",
  "state-of-the-art",
  "cutting-edge",
  "optical-grade",
  "utilize",
  "leverage",
  "robust",
  "consultative",
] as const;

export type IstDateFormatType =
  | "time" // e.g. "10:30 AM"
  | "date" // e.g. "15 Nov 2026"
  | "dateTime" // e.g. "15 Nov 2026, 10:30 AM"
  | "dateShort" // e.g. "15 Nov"
  | "dateTimeShort" // e.g. "15 Nov, 10:30 AM"
  | "threadTime"; // e.g. "10:30 AM" | "Yesterday" | "15 Nov" | "15 Nov 2026"

const IST_PATTERNS: Record<IstDateFormatType, RegExp> = {
  time: /^(1[0-2]|0?[1-9]):[0-5][0-9]\s+(AM|PM)$/,
  date: /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4}$/,
  dateTime: /^\d{1,2}\s+[A-Za-z]{3}\s+\d{4},\s+(1[0-2]|0?[1-9]):[0-5][0-9]\s+(AM|PM)$/,
  dateShort: /^\d{1,2}\s+[A-Za-z]{3}$/,
  dateTimeShort: /^\d{1,2}\s+[A-Za-z]{3},\s+(1[0-2]|0?[1-9]):[0-5][0-9]\s+(AM|PM)$/,
  threadTime: /^((1[0-2]|0?[1-9]):[0-5][0-9]\s+(AM|PM)|Yesterday|\d{1,2}\s+[A-Za-z]{3}|\d{1,2}\s+[A-Za-z]{3}\s+\d{4})$/,
};

/**
 * Asserts that a date string is formatted in Indian Standard Time (IST) according to project conventions.
 */
export function assertIstFormatted(
  dateStr: unknown,
  options?: {
    format?: IstDateFormatType | RegExp;
    message?: string;
  }
): void {
  if (typeof dateStr !== "string" || !dateStr.trim()) {
    throw new AssertionError({
      message: options?.message || `Expected non-empty string for IST date assertion, got: ${typeof dateStr} (${String(dateStr)})`,
      actual: dateStr,
      expected: "non-empty string formatted in IST",
    });
  }

  const trimmed = dateStr.trim();

  if (options?.format instanceof RegExp) {
    if (!options.format.test(trimmed)) {
      throw new AssertionError({
        message: options.message || `Date string "${trimmed}" does not match expected IST pattern ${options.format}`,
        actual: trimmed,
        expected: options.format.toString(),
      });
    }
    return;
  }

  if (options?.format && typeof options.format === "string") {
    const pattern = IST_PATTERNS[options.format];
    if (pattern && !pattern.test(trimmed)) {
      throw new AssertionError({
        message:
          options.message ||
          `Date string "${trimmed}" does not match expected IST "${options.format}" format. Expected pattern: ${pattern}`,
        actual: trimmed,
        expected: pattern.toString(),
      });
    }
    return;
  }

  // If no specific format specified, match ANY valid standard IST date/time format
  const matchesAny = Object.values(IST_PATTERNS).some((p) => p.test(trimmed));
  if (!matchesAny) {
    throw new AssertionError({
      message:
        options?.message ||
        `Date string "${trimmed}" is not formatted in any recognized IST format (time, date, dateTime, dateShort, dateTimeShort).`,
      actual: trimmed,
      expected: "Valid IST formatted string (e.g. '10:30 AM', '15 Nov 2026', '15 Nov 2026, 10:30 AM')",
    });
  }
}

/**
 * Asserts that a string is a valid UTC ISO 8601 timestamp ending with "Z".
 */
export function assertUtcIso(isoStr: unknown, customMessage?: string): void {
  if (typeof isoStr !== "string" || !isoStr.trim()) {
    throw new AssertionError({
      message: customMessage || `Expected non-empty string for UTC ISO assertion, got: ${typeof isoStr}`,
      actual: isoStr,
      expected: "UTC ISO 8601 string ending with Z",
    });
  }

  const trimmed = isoStr.trim();
  const utcIsoPattern = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,3})?Z$/;

  if (!utcIsoPattern.test(trimmed)) {
    throw new AssertionError({
      message: customMessage || `String "${trimmed}" does not match strict UTC ISO 8601 format (YYYY-MM-DDTHH:mm:ss.sssZ)`,
      actual: trimmed,
      expected: "YYYY-MM-DDTHH:mm:ss.sssZ (ending in Z)",
    });
  }

  const parsed = new Date(trimmed);
  if (isNaN(parsed.getTime())) {
    throw new AssertionError({
      message: customMessage || `String "${trimmed}" is not a parseable UTC ISO Date`,
      actual: trimmed,
      expected: "Valid parseable Date timestamp",
    });
  }
}

/**
 * Asserts the absence of all 13 forbidden AI buzzwords from text copy.
 */
export function assertNoBuzzwords(text: unknown, customForbidden?: string[]): void {
  if (typeof text !== "string") {
    throw new AssertionError({
      message: `Expected string for buzzword check, got: ${typeof text}`,
      actual: text,
      expected: "string",
    });
  }

  const forbiddenWords = customForbidden || FORBIDDEN_AI_BUZZWORDS;
  const detected: string[] = [];

  for (const word of forbiddenWords) {
    // Case-insensitive regex with word boundary
    const regex = new RegExp(`\\b${word.replace(/-/g, "\\-")}\\b`, "i");
    if (regex.test(text)) {
      detected.push(word);
    }
  }

  if (detected.length > 0) {
    throw new AssertionError({
      message: `Forbidden AI buzzword(s) detected in copy: [${detected.join(", ")}]. Full text excerpt: "${text.slice(0, 200)}"`,
      actual: detected,
      expected: "[] (zero forbidden AI buzzwords)",
    });
  }
}

/**
 * Asserts the absence of em dashes, spaced en dashes, or double hyphens.
 */
export function assertNoDashes(text: unknown, customMessage?: string): void {
  if (typeof text !== "string") {
    throw new AssertionError({
      message: `Expected string for dash check, got: ${typeof text}`,
      actual: text,
      expected: "string",
    });
  }

  const issues: string[] = [];

  if (text.includes("\u2014")) {
    issues.push("em dash");
  }
  if (/\s+\u2013\s+/.test(text) || text.includes("\u2013")) {
    issues.push("en dash");
  }
  if (/--+/.test(text)) {
    issues.push("double hyphen");
  }

  if (issues.length > 0) {
    throw new AssertionError({
      message:
        customMessage ||
        `Forbidden punctuation detected: [${issues.join(", ")}]. Replace with commas, periods, or standard plain formatting. Excerpt: "${text.slice(0, 200)}"`,
      actual: issues,
      expected: "[] (zero em dashes, en dashes, or double hyphens)",
    });
  }
}

/**
 * Asserts that a string includes an expected substring.
 */
export function assertIncludes(haystack: unknown, needle: string, message?: string): void {
  const str = String(haystack || "");
  if (!str.includes(needle)) {
    throw new AssertionError({
      message: message || `Expected text to include "${needle}". Excerpt: "${str.slice(0, 200)}"`,
      actual: str.slice(0, 200),
      expected: needle,
    });
  }
}

// Re-export standard assert helpers with explicit typing for TS assertion signature compliance
export function assertStrictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
  assert.strictEqual(actual, expected, message);
}

export function assertNotStrictEqual(actual: unknown, expected: unknown, message?: string | Error): void {
  assert.notStrictEqual(actual, expected, message);
}

export function assertDeepStrictEqual<T>(actual: unknown, expected: T, message?: string | Error): asserts actual is T {
  assert.deepStrictEqual(actual, expected, message);
}

export function assertOk(value: unknown, message?: string | Error): asserts value {
  assert.ok(value, message);
}

export function assertFail(message?: string | Error): never {
  assert.fail(message);
}

export function assertMatch(value: string, regExp: RegExp, message?: string | Error): void {
  assert.match(value, regExp, message);
}

export function assertNotMatch(value: string, regExp: RegExp, message?: string | Error): void {
  assert.doesNotMatch(value, regExp, message);
}

export function assertThrows(fn: () => unknown, expected?: assert.AssertPredicate, message?: string | Error): void {
  assert.throws(fn, expected, message);
}

export function assertRejects(
  asyncFn: (() => Promise<unknown>) | Promise<unknown>,
  expected?: assert.AssertPredicate,
  message?: string | Error
): Promise<void> {
  return assert.rejects(asyncFn, expected, message);
}
