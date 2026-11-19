const fs = require("fs");
const path = require("path");

/**
 * Reads all environment variables from root .env files in priority order
 * so pasting .env.production in the repository root configures PM2 & Next.js cleanly.
 */
function loadDotEnvMap() {
  const merged = {};
  const files = [
    ".env",
    ".env.production",
    ".env.local",
    ".env.production.local",
  ];

  for (const file of files) {
    const fullPath = path.join(__dirname, file);
    if (!fs.existsSync(fullPath)) continue;
    try {
      const content = fs.readFileSync(fullPath, "utf8");
      for (const rawLine of content.split(/\r?\n/)) {
        const line = rawLine.trim();
        if (!line || line.startsWith("#")) continue;
        const eqIdx = line.indexOf("=");
        if (eqIdx <= 0) continue;
        const key = line
          .slice(0, eqIdx)
          .replace(/^export\s+/, "")
          .trim();
        if (!key) continue;
        let val = line.slice(eqIdx + 1).trim();
        if (
          (val.startsWith('"') && val.endsWith('"')) ||
          (val.startsWith("'") && val.endsWith("'"))
        ) {
          val = val.slice(1, -1);
        }
        merged[key] = val;
      }
    } catch {
      // Ignore unreadable env files
    }
  }
  return merged;
}

const dotEnv = loadDotEnvMap();
const port =
  Number(dotEnv.PORT) || Number(process.env.PORT) || Number(process.env.APP_PORT) || 3007;
const redisUrl =
  dotEnv.REDIS_URL || process.env.REDIS_URL || "redis://127.0.0.1:6379/1";
const redisMaxBytes =
  dotEnv.REDIS_MAXMEMORY_BYTES || process.env.REDIS_MAXMEMORY_BYTES || "104857600";

module.exports = {
  apps: [
    {
      name: "ccwhatsapp",
      cwd: path.join(__dirname, "apps", "web"),
      script: path.join(__dirname, "node_modules", "next", "dist", "bin", "next"),
      args: `start -p ${port}`,
      instances: 1,
      exec_mode: "fork",
      // Proactive V8 heap ceiling & graceful auto-restart to prevent Linux OOM 502s
      node_args: "--max-old-space-size=768",
      max_memory_restart: "900M",
      exp_backoff_restart_delay: 100,
      kill_timeout: 5000,
      autorestart: true,
      out_file: path.join(__dirname, "logs", "ccwhatsapp-out.log"),
      error_file: path.join(__dirname, "logs", "ccwhatsapp-error.log"),
      merge_logs: true,
      time: true,
      env: {
        ...dotEnv,
        NODE_ENV: "production",
        PORT: String(port),
        CCWHATSAPP_ROOT: __dirname,
        APP_URL:
          !dotEnv.APP_URL || dotEnv.APP_URL === "https://whatsapp.ccapl.cc"
            ? "https://chat.ccapl.cc"
            : dotEnv.APP_URL,
        NEXT_PUBLIC_APP_URL:
          !dotEnv.NEXT_PUBLIC_APP_URL || dotEnv.NEXT_PUBLIC_APP_URL === "https://whatsapp.ccapl.cc"
            ? "https://chat.ccapl.cc"
            : dotEnv.NEXT_PUBLIC_APP_URL,
        TRACKING_PUBLIC_ORIGIN: dotEnv.TRACKING_PUBLIC_ORIGIN || "https://track.ccapl.cc",
        SEED_DEMO_DATA: dotEnv.SEED_DEMO_DATA || "0",
        REDIS_URL: redisUrl,
        REDIS_MAXMEMORY_BYTES: String(redisMaxBytes),
        // Multi-worker PM2 guard: if scaling `instances > 1`, set WORKER_ROLE=web and
        // DISABLE_IN_PROCESS_WORKERS=1 on web processes and run one dedicated WORKER_ROLE=runner process
        // so background broadcast, escalation, and job loops run on a single leader worker.
        WORKER_ROLE: dotEnv.WORKER_ROLE || "all",
        DISABLE_IN_PROCESS_WORKERS: dotEnv.DISABLE_IN_PROCESS_WORKERS || "0",
      },
    },
  ],
};
