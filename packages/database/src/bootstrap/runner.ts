import { ensureAllDatabaseIndexes } from "./indexes";
import { applyAllDatabasePragmas } from "./pragmas";
import {
  seedCoreConfigurationAndTemplates,
  type BootstrapTimestamps,
} from "./seed-config";
import { seedDemoOperationalData } from "./seed-demo";
import { seedTeamsAssignmentsAndBackfillContacts } from "./seed-teams-contacts";
import {
  createConversationsAndContactsTables,
  createCoreAuthTables,
} from "./tables-core-conv";
import { createCrmMarketingBillingQueueTables } from "./tables-crm-mkt-bill";

let bootstrapPromise: Promise<void> | null = null;

export function resetBootstrapCache(): void {
  bootstrapPromise = null;
}

export async function ensureDatabasesBootstrapped(): Promise<void> {
  if (!bootstrapPromise) {
    bootstrapPromise = runBootstrapInternal().catch((err) => {
      bootstrapPromise = null;
      throw err;
    });
  }
  return bootstrapPromise;
}

async function runBootstrapInternal(): Promise<void> {
  await applyAllDatabasePragmas();
  await createCoreAuthTables();
  await createConversationsAndContactsTables();
  await createCrmMarketingBillingQueueTables();
  await ensureAllDatabaseIndexes();

  const now = new Date();
  const ts: BootstrapTimestamps = {
    isoNow: now.toISOString(),
    oneHourAgo: new Date(now.getTime() - 60 * 60 * 1000).toISOString(),
    threeHoursAgo: new Date(now.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    yesterday: new Date(now.getTime() - 22 * 60 * 60 * 1000).toISOString(),
    windowOpen: new Date(now.getTime() + 20 * 60 * 60 * 1000).toISOString(),
  };

  const shouldSeedDemoData = process.env.SEED_DEMO_DATA === "1";
  const hadZeroTemplates = await seedCoreConfigurationAndTemplates(
    ts,
    shouldSeedDemoData
  );
  if (shouldSeedDemoData) {
    await seedDemoOperationalData(ts, hadZeroTemplates);
  }
  await seedTeamsAssignmentsAndBackfillContacts(ts.isoNow, shouldSeedDemoData);
}
