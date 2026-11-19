import fs from "node:fs";
import path from "node:path";
import {
  DATABASE_DESCRIPTIONS,
  DATABASE_FILES,
  type DatabaseDomain,
  getDatabaseFilePath,
  resolveClassicEdgeDbPath,
  resolveMainWebsiteDbPath,
  resolveMonorepoRoot,
} from "./env-config";
import {
  getClassicEdgeClient,
  getMainCatalogClient,
  getRawLibSqlClient,
} from "./handles";

/**
 * Resolves the role-isolated Anthropic API key (`client` vs `admin`), locked to `claude-haiku-5-5`:
 * 1. Environment variables (`ANTHROPIC_CLIENT_API_KEY` / `ANTHROPIC_ADMIN_API_KEY` from `.env` / `.env.production`)
 * 2. `core_auth.db` (`setup_state` key `ai_config`)
 * 3. `classicconcepts/dev.db` (`SiteSetting`)
 * 4. `.env` / `.env.local` in `classicconcepts`
 */
export async function resolveSharedAnthropicApiKey(
  agentRole: "client" | "admin" = "client"
): Promise<{
  apiKey: string;
  source: "env" | "whatsapp_settings" | "classicconcepts_db" | "classicconcepts_env" | "none";
}> {
  resolveMonorepoRoot();

  const roleEnvKey = (
    agentRole === "admin"
      ? process.env.ANTHROPIC_ADMIN_API_KEY || process.env.ANTHROPIC_API_KEY || ""
      : process.env.ANTHROPIC_CLIENT_API_KEY || process.env.ANTHROPIC_API_KEY || ""
  ).trim();
  if (roleEnvKey.startsWith("sk-ant-")) {
    return { apiKey: roleEnvKey, source: "env" };
  }

  try {
    const auth = getRawLibSqlClient("core_auth");
    const row = await auth.execute(
      `SELECT value_json FROM setup_state WHERE key = 'ai_config' LIMIT 1`
    );
    if (row.rows[0]?.value_json) {
      const parsed = JSON.parse(String(row.rows[0].value_json));
      const key = String(
        agentRole === "admin"
          ? parsed?.adminApiKey || parsed?.anthropicApiKey || ""
          : parsed?.clientApiKey || parsed?.anthropicApiKey || ""
      ).trim();
      if (key.startsWith("sk-ant-")) {
        return { apiKey: key, source: "whatsapp_settings" };
      }
    }
  } catch {
    // Table may not be initialized yet
  }

  try {
    const ccClient = getMainCatalogClient();
    if (ccClient) {
      const sRes = await ccClient.execute(
        `SELECT anthropicApiKey, anthropicAdminApiKey, anthropicClientApiKey FROM SiteSetting LIMIT 1`
      );
      const r = sRes.rows[0];
      if (r) {
        const dbKey = String(
          agentRole === "admin"
            ? r.anthropicAdminApiKey || r.anthropicApiKey || ""
            : r.anthropicClientApiKey || r.anthropicApiKey || ""
        ).trim();
        if (dbKey.startsWith("sk-ant-")) {
          return { apiKey: dbKey, source: "classicconcepts_db" };
        }
      }
    }
  } catch {
    // Non-blocking
  }

  try {
    const root = resolveMonorepoRoot();
    const ccEnvPaths = [
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env.production"),
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env"),
      path.resolve(/*turbopackIgnore: true*/ root, "..", "classicconcepts", ".env.local"),
      "C:/Users/DELL/Desktop/classicconcepts/.env",
      "C:/Users/DELL/Desktop/classicconcepts/.env.local",
    ];
    const targetVar =
      agentRole === "admin"
        ? /ANTHROPIC_ADMIN_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/
        : /ANTHROPIC_CLIENT_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/;
    const fallbackVar =
      /ANTHROPIC_API_KEY\s*=\s*["']?(sk-ant-[A-Za-z0-9_-]+)["']?/;
    for (const p of ccEnvPaths) {
      if (fs.existsSync(/*turbopackIgnore: true*/ p)) {
        const content = fs.readFileSync(/*turbopackIgnore: true*/ p, "utf8");
        const match = content.match(targetVar) || content.match(fallbackVar);
        if (match?.[1]) {
          return { apiKey: match[1], source: "classicconcepts_env" };
        }
      }
    }
  } catch {
    // Non-blocking
  }

  return { apiKey: "", source: "none" };
}

export async function getAcrioKeysStatus(): Promise<{
  clientConnected: boolean;
  clientSource: string;
  clientMasked: string;
  adminConnected: boolean;
  adminSource: string;
  adminMasked: string;
}> {
  const [clientInfo, adminInfo] = await Promise.all([
    resolveSharedAnthropicApiKey("client"),
    resolveSharedAnthropicApiKey("admin"),
  ]);
  const mask = (k: string) =>
    k ? `${k.slice(0, 11)}...${k.slice(-4)}` : "";
  return {
    clientConnected: Boolean(clientInfo.apiKey),
    clientSource: clientInfo.source,
    clientMasked: mask(clientInfo.apiKey),
    adminConnected: Boolean(adminInfo.apiKey),
    adminSource: adminInfo.source,
    adminMasked: mask(adminInfo.apiKey),
  };
}

export async function saveSharedAnthropicApiKey(
  apiKey: string,
  adminApiKey?: string
): Promise<void> {
  const auth = getRawLibSqlClient("core_auth");
  const cleanClient = apiKey.trim();
  const cleanAdmin = (adminApiKey || apiKey).trim();
  const now = new Date().toISOString();
  await auth.execute({
    sql: `INSERT INTO setup_state (key, value_json, updated_at)
          VALUES ('ai_config', ?, ?)
          ON CONFLICT(key) DO UPDATE SET value_json = excluded.value_json, updated_at = excluded.updated_at`,
    args: [
      JSON.stringify({
        anthropicApiKey: cleanClient,
        clientApiKey: cleanClient,
        adminApiKey: cleanAdmin,
        model: "claude-haiku-5-5",
      }),
      now,
    ],
  });
}

/**
 * Hot atomic SQLite snapshot export for daily backups (including sister databases when present).
 */
export async function snapshotAllDatabasesToFolder(
  targetFolder: string,
  includeMainWebsiteDb = true
): Promise<{ files: { domain: string; filePath: string; sizeBytes: number }[]; totalBytes: number }> {
  if (!fs.existsSync(/*turbopackIgnore: true*/ targetFolder)) {
    fs.mkdirSync(targetFolder, { recursive: true });
  }

  const files: { domain: string; filePath: string; sizeBytes: number }[] = [];
  let totalBytes = 0;

  for (const domain of Object.keys(DATABASE_FILES) as DatabaseDomain[]) {
    const client = getRawLibSqlClient(domain);
    const outFile = path.join(/*turbopackIgnore: true*/ targetFolder, DATABASE_FILES[domain]);
    if (fs.existsSync(/*turbopackIgnore: true*/ outFile)) fs.unlinkSync(/*turbopackIgnore: true*/ outFile);
    const escapedPath = outFile.replace(/\\/g, "/").replace(/'/g, "''");
    await client.execute(`VACUUM INTO '${escapedPath}'`);
    const stat = fs.statSync(/*turbopackIgnore: true*/ outFile);
    files.push({ domain, filePath: outFile, sizeBytes: stat.size });
    totalBytes += stat.size;
  }

  if (includeMainWebsiteDb) {
    const mainDbPath = resolveMainWebsiteDbPath();
    if (mainDbPath && fs.existsSync(/*turbopackIgnore: true*/ mainDbPath)) {
      const mainClient = getMainCatalogClient();
      const outMain = path.join(/*turbopackIgnore: true*/ targetFolder, "classicconcepts_website.db");
      if (fs.existsSync(/*turbopackIgnore: true*/ outMain)) fs.unlinkSync(/*turbopackIgnore: true*/ outMain);
      if (mainClient) {
        const escapedMain = outMain.replace(/\\/g, "/").replace(/'/g, "''");
        await mainClient.execute(`VACUUM INTO '${escapedMain}'`);
      } else {
        fs.copyFileSync(/*turbopackIgnore: true*/ mainDbPath, /*turbopackIgnore: true*/ outMain);
      }
      const stat = fs.statSync(/*turbopackIgnore: true*/ outMain);
      files.push({
        domain: "classicconcepts_website",
        filePath: outMain,
        sizeBytes: stat.size,
      });
      totalBytes += stat.size;
    }

    const edgeDbPath = resolveClassicEdgeDbPath();
    if (edgeDbPath && fs.existsSync(/*turbopackIgnore: true*/ edgeDbPath)) {
      const edgeClient = getClassicEdgeClient();
      const outEdge = path.join(/*turbopackIgnore: true*/ targetFolder, "classicedge53_machines.db");
      if (fs.existsSync(/*turbopackIgnore: true*/ outEdge)) fs.unlinkSync(/*turbopackIgnore: true*/ outEdge);
      if (edgeClient) {
        const escapedEdge = outEdge.replace(/\\/g, "/").replace(/'/g, "''");
        await edgeClient.execute(`VACUUM INTO '${escapedEdge}'`);
      } else {
        fs.copyFileSync(/*turbopackIgnore: true*/ edgeDbPath, /*turbopackIgnore: true*/ outEdge);
      }
      const stat = fs.statSync(/*turbopackIgnore: true*/ outEdge);
      files.push({
        domain: "classicedge53_machines",
        filePath: outEdge,
        sizeBytes: stat.size,
      });
      totalBytes += stat.size;
    }
  }

  return { files, totalBytes };
}

export async function getMultiDatabaseDiagnostics(): Promise<
  {
    domain: DatabaseDomain;
    fileName: string;
    description: string;
    sizeBytes: number;
    tablesCount: number;
    totalRows: number;
  }[]
> {
  const results = [];
  for (const domain of Object.keys(DATABASE_FILES) as DatabaseDomain[]) {
    const filePath = getDatabaseFilePath(domain);
    const client = getRawLibSqlClient(domain);
    const sizeBytes = fs.existsSync(/*turbopackIgnore: true*/ filePath) ? fs.statSync(/*turbopackIgnore: true*/ filePath).size : 0;

    const tblRes = await client.execute(
      `SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`
    );
    let totalRows = 0;
    for (const row of tblRes.rows) {
      const tblName = String(row.name);
      const cntRes = await client.execute(`SELECT COUNT(*) as cnt FROM "${tblName}"`);
      totalRows += Number(cntRes.rows[0]?.cnt ?? 0);
    }

    results.push({
      domain,
      fileName: DATABASE_FILES[domain],
      description: DATABASE_DESCRIPTIONS[domain],
      sizeBytes,
      tablesCount: tblRes.rows.length,
      totalRows,
    });
  }
  return results;
}
