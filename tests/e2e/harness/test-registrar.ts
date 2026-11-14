import { performance } from "node:perf_hooks";

export type TestStatus = "PASS" | "FAIL" | "SKIP";

export interface TestResult {
  suiteName: string;
  testName: string;
  status: TestStatus;
  durationMs: number;
  error?: Error | { message: string; stack?: string; expected?: unknown; actual?: unknown };
  filePath?: string;
  tier?: number;
}

export interface SuiteResult {
  suiteName: string;
  tests: TestResult[];
  durationMs: number;
}

export interface RunSummary {
  suites: SuiteResult[];
  totalTests: number;
  passedTests: number;
  failedTests: number;
  skippedTests: number;
  totalDurationMs: number;
  failures: TestResult[];
}

export type HookFn = () => void | Promise<void>;
export type TestFn = () => void | Promise<void>;

export interface RegisteredTestCase {
  name: string;
  fn: TestFn;
  skip: boolean;
}

export interface RegisteredSuite {
  name: string;
  beforeAllHooks: HookFn[];
  afterAllHooks: HookFn[];
  beforeEachHooks: HookFn[];
  afterEachHooks: HookFn[];
  tests: RegisteredTestCase[];
}

interface RegistrarState {
  suites: RegisteredSuite[];
  currentSuite: RegisteredSuite | null;
}

const state: RegistrarState = {
  suites: [],
  currentSuite: null,
};

function ensureCurrentSuite(): RegisteredSuite {
  if (!state.currentSuite) {
    state.currentSuite = {
      name: "Default Suite",
      beforeAllHooks: [],
      afterAllHooks: [],
      beforeEachHooks: [],
      afterEachHooks: [],
      tests: [],
    };
    state.suites.push(state.currentSuite);
  }
  return state.currentSuite;
}

/**
 * Registers a test suite.
 */
export function describe(title: string, fn: () => void | Promise<void>): void {
  const previousSuite = state.currentSuite;
  const suite: RegisteredSuite = {
    name: title,
    beforeAllHooks: [],
    afterAllHooks: [],
    beforeEachHooks: [],
    afterEachHooks: [],
    tests: [],
  };
  state.suites.push(suite);
  state.currentSuite = suite;

  try {
    const res = fn();
    if (res && typeof (res as Promise<void>).then === "function") {
      // Async suite registration is handled synchronously in definitions
      void res;
    }
  } finally {
    state.currentSuite = previousSuite;
  }
}

/**
 * Registers a single test case within the current suite.
 */
export function test(name: string, fn: TestFn): void {
  const suite = ensureCurrentSuite();
  suite.tests.push({
    name,
    fn,
    skip: false,
  });
}

test.skip = function skipTest(name: string, fn: TestFn): void {
  const suite = ensureCurrentSuite();
  suite.tests.push({
    name,
    fn,
    skip: true,
  });
};

export const it = test;

/**
 * Registers a hook to run once before all tests in the current suite.
 */
export function before(fn: HookFn): void {
  const suite = ensureCurrentSuite();
  suite.beforeAllHooks.push(fn);
}

export const beforeAll = before;

/**
 * Registers a hook to run once after all tests in the current suite.
 */
export function after(fn: HookFn): void {
  const suite = ensureCurrentSuite();
  suite.afterAllHooks.push(fn);
}

export const afterAll = after;

/**
 * Registers a hook to run before each test in the current suite.
 */
export function beforeEach(fn: HookFn): void {
  const suite = ensureCurrentSuite();
  suite.beforeEachHooks.push(fn);
}

/**
 * Registers a hook to run after each test in the current suite.
 */
export function afterEach(fn: HookFn): void {
  const suite = ensureCurrentSuite();
  suite.afterEachHooks.push(fn);
}

/**
 * Returns all currently registered suites.
 */
export function getRegisteredSuites(): RegisteredSuite[] {
  return [...state.suites];
}

/**
 * Clears the registry of all suites and hooks.
 */
export function clearRegistry(): void {
  state.suites = [];
  state.currentSuite = null;
}

export interface RunOptions {
  bail?: boolean;
  verbose?: boolean;
  filter?: string;
  filePath?: string;
  tier?: number;
  onTestComplete?: (result: TestResult) => void;
}

/**
 * Runs all registered test suites sequentially, invoking lifecycle hooks and collecting results.
 */
export async function runRegisteredSuites(options?: RunOptions): Promise<RunSummary> {
  const summary: RunSummary = {
    suites: [],
    totalTests: 0,
    passedTests: 0,
    failedTests: 0,
    skippedTests: 0,
    totalDurationMs: 0,
    failures: [],
  };

  const startTime = performance.now();
  const filterRegex = options?.filter ? new RegExp(options.filter, "i") : null;

  for (const suite of state.suites) {
    const suiteStartTime = performance.now();
    const suiteResult: SuiteResult = {
      suiteName: suite.name,
      tests: [],
      durationMs: 0,
    };

    // Filter tests if filter option is supplied
    const matchesFile = options?.filePath && filterRegex ? filterRegex.test(options.filePath) : false;
    const testsToRun = filterRegex
      ? (matchesFile ? suite.tests : suite.tests.filter((t) => filterRegex.test(suite.name) || filterRegex.test(t.name)))
      : suite.tests;

    if (testsToRun.length === 0) {
      continue;
    }

    // Run beforeAll hooks
    try {
      for (const hook of suite.beforeAllHooks) {
        await hook();
      }
    } catch (err) {
      // Suite-level beforeAll failure
      const errorResult: TestResult = {
        suiteName: suite.name,
        testName: "beforeAll hook",
        status: "FAIL",
        durationMs: 0,
        error: err as Error,
        filePath: options?.filePath,
        tier: options?.tier,
      };
      suiteResult.tests.push(errorResult);
      summary.failedTests++;
      summary.totalTests++;
      summary.failures.push(errorResult);
      options?.onTestComplete?.(errorResult);

      if (options?.bail) {
        summary.suites.push(suiteResult);
        break;
      }
      continue;
    }

    for (const testCase of testsToRun) {
      summary.totalTests++;

      if (testCase.skip) {
        const skippedResult: TestResult = {
          suiteName: suite.name,
          testName: testCase.name,
          status: "SKIP",
          durationMs: 0,
          filePath: options?.filePath,
          tier: options?.tier,
        };
        suiteResult.tests.push(skippedResult);
        summary.skippedTests++;
        options?.onTestComplete?.(skippedResult);
        continue;
      }

      // Run beforeEach hooks
      let hookError: Error | null = null;
      try {
        for (const hook of suite.beforeEachHooks) {
          await hook();
        }
      } catch (err) {
        hookError = err as Error;
      }

      const testStartTime = performance.now();
      let testError: Error | null = hookError;

      if (!testError) {
        try {
          await testCase.fn();
        } catch (err) {
          testError = err as Error;
        }
      }

      const testDurationMs = Math.round((performance.now() - testStartTime) * 100) / 100;

      // Run afterEach hooks regardless of test success/failure
      try {
        for (const hook of suite.afterEachHooks) {
          await hook();
        }
      } catch (err) {
        if (!testError) {
          testError = err as Error;
        }
      }

      const status: TestStatus = testError ? "FAIL" : "PASS";
      const result: TestResult = {
        suiteName: suite.name,
        testName: testCase.name,
        status,
        durationMs: testDurationMs,
        error: testError || undefined,
        filePath: options?.filePath,
        tier: options?.tier,
      };

      suiteResult.tests.push(result);

      if (status === "PASS") {
        summary.passedTests++;
      } else {
        summary.failedTests++;
        summary.failures.push(result);
      }

      options?.onTestComplete?.(result);

      if (status === "FAIL" && options?.bail) {
        break;
      }
    }

    // Run afterAll hooks
    try {
      for (const hook of suite.afterAllHooks) {
        await hook();
      }
    } catch (err) {
      console.error(`[test-registrar] afterAll hook failed in suite "${suite.name}":`, err);
    }

    suiteResult.durationMs = Math.round((performance.now() - suiteStartTime) * 100) / 100;
    summary.suites.push(suiteResult);

    if (summary.failures.length > 0 && options?.bail) {
      break;
    }
  }

  summary.totalDurationMs = Math.round((performance.now() - startTime) * 100) / 100;
  return summary;
}
