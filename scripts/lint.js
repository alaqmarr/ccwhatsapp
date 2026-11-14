#!/usr/bin/env node
const fs = require("fs");
const path = require("path");

const rootDir = path.resolve(__dirname, "..");
let errorCount = 0;
let fileCount = 0;

function checkFile(filePath) {
  fileCount++;
  const relPath = path.relative(rootDir, filePath);
  const content = fs.readFileSync(filePath, "utf8");

  // Check 1: Forbidden em-dash in source code comments or strings
  // (Exempting assertions, test files, and regex character classes)
  const isTestOrHarness = relPath.startsWith("tests" + path.sep);
  const isClientsRegex = relPath.includes("packages" + path.sep + "database" + path.sep + "src" + path.sep + "clients.ts");
  const isThisLintScript = relPath.includes("scripts" + path.sep + "lint.js");

  if (!isTestOrHarness && !isClientsRegex && !isThisLintScript) {
    const lines = content.split("\n");
    lines.forEach((line, idx) => {
      // Allow prompt guidelines explaining zero em-dashes to the LLM
      if (line.includes("\u2014") && !/zero\s+em-dashes/i.test(line)) {
        console.error(`[LINT ERROR] Forbidden em-dash (—) found in ${relPath}:${idx + 1}`);
        errorCount++;
      }
    });
  }

  // Check 2: Model lock enforcement in connections
  if (relPath.includes("packages" + path.sep + "connections")) {
    if (content.includes("claude-haiku-4-5") || content.includes("WIRE_FALLBACK_CLAUDE_MODEL")) {
      console.error(`[LINT ERROR] Disallowed model reference found in ${relPath}`);
      errorCount++;
    }
  }
}

function walk(dir) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (["node_modules", ".next", ".git", ".agents"].includes(entry.name)) continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full);
    } else if (/\.(ts|tsx|js|json)$/.test(entry.name)) {
      checkFile(full);
    }
  }
}

console.log("[LINT] Running Classic Concepts code and ecosystem lint rules...");
walk(rootDir);

if (errorCount > 0) {
  console.error(`\n[LINT FAILED] Found ${errorCount} lint violation(s) across ${fileCount} files.`);
  process.exit(1);
} else {
  console.log(`[LINT PASSED] Clean! Inspected ${fileCount} files with 0 violations.`);
  process.exit(0);
}
