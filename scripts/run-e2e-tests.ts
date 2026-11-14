import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { performance } from "node:perf_hooks";
import {
  setupTestSandbox,
  teardownTestSandbox,
  clearRegistry,
  runRegisteredSuites,
  mockMeta,
  type TestResult,
  type RunSummary,
} from "../tests/e2e/harness";

// ANSI escape codes for beautiful terminal output
const C = {
  reset: "\x1b[0m",
  bold: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  yellow: "\x1b[33m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
  cyan: "\x1b[36m",
  white: "\x1b[37m",
  gray: "\x1b[90m",
};

interface CliOptions {
  tier?: number;
  filter?: string;
  bail?: boolean;
  verbose?: boolean;
  help?: boolean;
}

function parseArgs(args: string[]): CliOptions {
  const options: CliOptions = {};

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];
    if (arg === "--tier" || arg === "-t") {
      const val = args[++i];
      if (val && !isNaN(parseInt(val, 10))) {
        options.tier = parseInt(val, 10);
      }
    } else if (arg === "--filter" || arg === "-f") {
      options.filter = args[++i];
    } else if (arg === "--bail" || arg === "-b") {
      options.bail = true;
    } else if (arg === "--verbose" || arg === "-v") {
      options.verbose = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    }
  }

  return options;
}

function printHelp(): void {
  console.log(`
${C.bold}${C.cyan}Classic Concepts WhatsApp E2E Test Runner${C.reset}

Usage:
  npx tsx scripts/run-e2e-tests.ts [options]
  npm run test:e2e -- [options]

Options:
  -t, --tier <1|2|3|4>    Run only a specific tier of tests:
                          1: Feature Coverage (Tier 1)
                          2: Boundary & Corner Cases (Tier 2)
                          3: Cross-Feature Interactions (Tier 3)
                          4: Real-World Workflows (Tier 4)
  -f, --filter <pattern>  Filter test files or test names by substring/regex
  -b, --bail              Stop execution immediately on the first test failure
  -v, --verbose           Print verbose test execution traces
  -h, --help              Show this help menu
`);
}

interface DiscoveredFile {
  filePath: string;
  relativePath: string;
  tier: number; // 1, 2, 3, 4, or 0 (harness/smoke)
}

function discoverTestFiles(rootDir: string): DiscoveredFile[] {
  const testsDir = path.join(rootDir, "tests", "e2e");
  if (!fs.existsSync(testsDir)) {
    return [];
  }

  const results: DiscoveredFile[] = [];

  function walk(currentDir: string): void {
    const entries = fs.readdirSync(currentDir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(currentDir, entry.name);
      if (entry.isDirectory()) {
        walk(fullPath);
      } else if (entry.isFile() && entry.name.endsWith(".test.ts")) {
        const relative = path.relative(rootDir, fullPath).replace(/\\/g, "/");

        let tier = 0;
        if (relative.includes("tier1-features")) tier = 1;
        else if (relative.includes("tier2-boundaries")) tier = 2;
        else if (relative.includes("tier3-pairwise")) tier = 3;
        else if (relative.includes("tier4-scenarios")) tier = 4;

        results.push({
          filePath: fullPath,
          relativePath: relative,
          tier,
        });
      }
    }
  }

  walk(testsDir);

  // Sort files deterministically: by tier then relative path
  results.sort((a, b) => {
    if (a.tier !== b.tier) return a.tier - b.tier;
    return a.relativePath.localeCompare(b.relativePath);
  });

  return results;
}

interface TierStats {
  tierName: string;
  tierNumber: number;
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  durationMs: number;
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    printHelp();
    process.exit(0);
  }

  const rootDir = process.cwd();
  console.log(`\n${C.bold}${C.cyan}╔════════════════════════════════════════════════════════════════════════════╗${C.reset}`);
  console.log(`${C.bold}${C.cyan}║             CLASSIC CONCEPTS WHATSAPP CRM : E2E TEST RUNNER               ║${C.reset}`);
  console.log(`${C.bold}${C.cyan}╚════════════════════════════════════════════════════════════════════════════╝${C.reset}`);

  console.log(`${C.gray}  Start Time: ${new Date().toISOString()} | Working Dir: ${rootDir}${C.reset}`);
  if (options.tier) console.log(`${C.yellow}  Target Tier: ${options.tier}${C.reset}`);
  if (options.filter) console.log(`${C.yellow}  Filter Pattern: "${options.filter}"${C.reset}`);
  if (options.bail) console.log(`${C.yellow}  Bail Mode: Enabled (stop on first failure)${C.reset}`);

  // Discover test files
  const allFiles = discoverTestFiles(rootDir);
  let filesToRun = allFiles;

  if (options.tier !== undefined) {
    filesToRun = filesToRun.filter((f) => f.tier === options.tier || (options.tier === 0 && f.tier === 0));
  }

  if (options.filter) {
    const filterRegex = new RegExp(options.filter, "i");
    filesToRun = filesToRun.filter((f) => filterRegex.test(f.relativePath));
  }

  if (filesToRun.length === 0) {
    console.log(`\n${C.yellow}⚠ No matching test files found under tests/e2e/${C.reset}`);
    if (allFiles.length === 0) {
      console.log(`${C.gray}  (tests/e2e/ contains zero *.test.ts files)${C.reset}\n`);
    }
    const exitCode = options.filter || options.tier !== undefined ? 1 : 0;
    process.exit(exitCode);
  }

  console.log(`\n${C.bold}Discovered ${filesToRun.length} test file(s) across target suites.${C.reset}\n`);

  // Setup isolated test database sandbox
  console.log(`${C.dim}Initializing isolated test SQLite database sandbox...${C.reset}`);
  const sandboxStartTime = performance.now();
  const sandbox = await setupTestSandbox();
  const sandboxDuration = Math.round(performance.now() - sandboxStartTime);
  console.log(`${C.green}✔ Sandbox ready in ${sandboxDuration}ms${C.reset} ${C.gray}(${sandbox.dataDir})${C.reset}\n`);

  // Install mock Meta / Claude API
  mockMeta.install();

  const tierMap: Record<number, TierStats> = {
    1: { tierName: "Tier 1: Feature Coverage", tierNumber: 1, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    2: { tierName: "Tier 2: Boundary Cases", tierNumber: 2, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    3: { tierName: "Tier 3: Pairwise Combinations", tierNumber: 3, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    4: { tierName: "Tier 4: Application Scenarios", tierNumber: 4, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
    0: { tierName: "Harness & Smoke Tests", tierNumber: 0, total: 0, passed: 0, failed: 0, skipped: 0, durationMs: 0 },
  };

  const allFailures: TestResult[] = [];
  const suiteStartTime = performance.now();
  let bailTriggered = false;

  try {
    for (const file of filesToRun) {
      console.log(`${C.bold}${C.blue}▶ Running: ${file.relativePath}${C.reset}`);
      clearRegistry();
      mockMeta.reset();

      // Dynamic import using file URL
      const fileUrl = pathToFileURL(file.filePath).href;
      try {
        await import(fileUrl);
      } catch (importErr) {
        console.error(`${C.red}  ✗ Failed to import test file: ${(importErr as Error).message}${C.reset}`);
        const failure: TestResult = {
          suiteName: file.relativePath,
          testName: "Module Import",
          status: "FAIL",
          durationMs: 0,
          error: importErr as Error,
          filePath: file.relativePath,
          tier: file.tier,
        };
        allFailures.push(failure);
        tierMap[file.tier].total++;
        tierMap[file.tier].failed++;
        if (options.bail) {
          bailTriggered = true;
          break;
        }
        continue;
      }

      // Execute registered suites for this file
      const summary: RunSummary = await runRegisteredSuites({
        bail: options.bail,
        verbose: options.verbose,
        filter: options.filter,
        filePath: file.relativePath,
        tier: file.tier,
        onTestComplete: (res: TestResult) => {
          if (res.status === "PASS") {
            console.log(`    ${C.green}✔ [PASS]${C.reset} ${res.suiteName} → ${res.testName} ${C.gray}(${res.durationMs}ms)${C.reset}`);
          } else if (res.status === "FAIL") {
            console.log(`    ${C.red}✘ [FAIL]${C.reset} ${res.suiteName} → ${res.testName} ${C.gray}(${res.durationMs}ms)${C.reset}`);
            if (options.verbose && res.error) {
              const err = res.error as Error;
              console.log(`      ${C.red}${err.message || String(err)}${C.reset}`);
            }
          } else {
            console.log(`    ${C.yellow}○ [SKIP]${C.reset} ${res.suiteName} → ${res.testName}`);
          }
        },
      });

      // Aggregate stats
      const currentTierStats = tierMap[file.tier] || tierMap[0];
      currentTierStats.total += summary.totalTests;
      currentTierStats.passed += summary.passedTests;
      currentTierStats.failed += summary.failedTests;
      currentTierStats.skipped += summary.skippedTests;
      currentTierStats.durationMs += summary.totalDurationMs;

      allFailures.push(...summary.failures);

      if (options.bail && summary.failedTests > 0) {
        bailTriggered = true;
        console.log(`\n${C.yellow}⚠ Bail flag active: terminating execution after first failure.${C.reset}`);
        break;
      }
    }
  } finally {
    // Teardown sandbox and mock
    mockMeta.restore();
    await teardownTestSandbox(sandbox.dataDir);
  }

  const totalDurationMs = Math.round((performance.now() - suiteStartTime) * 100) / 100;

  // Print failure diagnostics if any
  if (allFailures.length > 0) {
    console.log(`\n${C.bold}${C.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}`);
    console.log(`${C.bold}${C.red}                            FAILURE DIAGNOSTICS                             ${C.reset}`);
    console.log(`${C.bold}${C.red}━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━${C.reset}\n`);

    for (let idx = 0; idx < allFailures.length; idx++) {
      const f = allFailures[idx];
      console.log(`${C.bold}${C.red}[${idx + 1}] ${f.suiteName} → ${f.testName}${C.reset}`);
      if (f.filePath) {
        console.log(`    ${C.gray}Location: ${f.filePath}${C.reset}`);
      }

      const err = f.error as (Error & { actual?: unknown; expected?: unknown });
      if (err) {
        console.log(`    ${C.red}Message: ${err.message || String(err)}${C.reset}`);

        if (err.expected !== undefined || err.actual !== undefined) {
          console.log(`    ${C.yellow}Expected: ${JSON.stringify(err.expected)}${C.reset}`);
          console.log(`    ${C.red}Actual:   ${JSON.stringify(err.actual)}${C.reset}`);
        }

        if (err.stack) {
          const stackLines = err.stack
            .split("\n")
            .slice(1, 6)
            .map((line) => `      ${C.gray}${line.trim()}${C.reset}`)
            .join("\n");
          console.log(`    ${C.dim}Stack:\n${stackLines}${C.reset}`);
        }
      }
      console.log();
    }
  }

  // Print Summary Table
  console.log(`\n${C.bold}${C.white}┌─────────────────────────────────┬──────────┬──────────┬──────────┬───────────┐${C.reset}`);
  console.log(
    `${C.bold}${C.white}│ ${"Tier / Suite Category".padEnd(31)} │ ${"Tests".padStart(8)} │ ${"Passed".padStart(
      8
    )} │ ${"Failed".padStart(8)} │ ${"Duration".padStart(9)} │${C.reset}`
  );
  console.log(`${C.bold}${C.white}├─────────────────────────────────┼──────────┼──────────┼──────────┼───────────┤${C.reset}`);

  let grandTotal = 0;
  let grandPassed = 0;
  let grandFailed = 0;
  let grandSkipped = 0;

  for (const t of [1, 2, 3, 4, 0]) {
    const stats = tierMap[t];
    if (stats.total > 0) {
      grandTotal += stats.total;
      grandPassed += stats.passed;
      grandFailed += stats.failed;
      grandSkipped += stats.skipped;

      const durStr = `${(stats.durationMs / 1000).toFixed(2)}s`;
      const passColor = stats.failed === 0 ? C.green : C.yellow;
      const failColor = stats.failed > 0 ? C.red : C.gray;

      console.log(
        `│ ${stats.tierName.padEnd(31)} │ ${String(stats.total).padStart(8)} │ ${passColor}${String(stats.passed).padStart(
          8
        )}${C.reset} │ ${failColor}${String(stats.failed).padStart(8)}${C.reset} │ ${durStr.padStart(9)} │`
      );
    }
  }

  console.log(`${C.bold}${C.white}├─────────────────────────────────┼──────────┼──────────┼──────────┼───────────┤${C.reset}`);
  const grandDurStr = `${(totalDurationMs / 1000).toFixed(2)}s`;
  const grandPassColor = grandFailed === 0 ? C.green : C.yellow;
  const grandFailColor = grandFailed > 0 ? C.red : C.gray;

  console.log(
    `${C.bold}│ ${"TOTAL".padEnd(31)} │ ${String(grandTotal).padStart(8)} │ ${grandPassColor}${String(grandPassed).padStart(
      8
    )}${C.reset}${C.bold} │ ${grandFailColor}${String(grandFailed).padStart(8)}${C.reset}${C.bold} │ ${grandDurStr.padStart(
      9
    )} │${C.reset}`
  );
  console.log(`${C.bold}${C.white}└─────────────────────────────────┴──────────┴──────────┴──────────┴───────────┘${C.reset}\n`);

  if (grandTotal === 0 && (options.filter || options.tier !== undefined)) {
    console.log(
      `${C.bold}${C.red}✘ NO TEST SPECS MATCHED FILTER: "${options.filter || `tier ${options.tier}`}" (0 specs executed)${C.reset}`
    );
    console.log(`${C.gray}Process exiting with code 1.${C.reset}\n`);
    process.exit(1);
  }

  if (grandFailed === 0) {
    const rate = grandTotal > 0 ? ((grandPassed / grandTotal) * 100).toFixed(1) : "100";
    console.log(
      `${C.bold}${C.green}✔ ALL E2E TESTS PASSED (Success rate: ${rate}%, ${grandPassed}/${grandTotal} specs)${C.reset}`
    );
    console.log(`${C.gray}Process exiting cleanly with code 0.${C.reset}\n`);
    process.exit(0);
  } else {
    console.log(
      `${C.bold}${C.red}✘ E2E TEST SUITE FAILED (${grandFailed} failure(s) out of ${grandTotal} specs)${C.reset}`
    );
    console.log(`${C.gray}Process exiting with code 1.${C.reset}\n`);
    process.exit(1);
  }
}

main().catch((fatalErr) => {
  console.error(`\n${C.bold}${C.red}FATAL ERROR IN TEST RUNNER:${C.reset}`, fatalErr);
  process.exit(1);
});
