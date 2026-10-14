import { getDb } from "@/lib/db";
import {
  buildPrepareLeadPlan,
  executeLeadPreview,
  leadPrepareTargetProblem,
  parsePrepareLeadArguments,
  PREPARE_LEAD_USAGE,
  type LeadPreviewExecutor,
} from "@/lib/lead-preview-prepare";

await main();

async function main() {
  const parsed = parsePrepareLeadArguments(process.argv.slice(2));
  if (!parsed.ok) {
    fail(parsed.failure);
    return;
  }

  const plan = buildPrepareLeadPlan(parsed.request);
  if (!parsed.request.execute) {
    console.log(JSON.stringify(plan, null, 2));
    return;
  }

  const target = leadPrepareTargetProblem(process.env);
  if (target) {
    fail(target);
    return;
  }

  let disconnect = false;
  try {
    disconnect = true;
    const [{ crawlSiteSource, generateDraftForVertical }, persistence] =
      await Promise.all([
        import("@/lib/site-pipeline"),
        import("@/lib/site-persistence"),
      ]);
    const executor: LeadPreviewExecutor = {
      createImportJob: persistence.createImportJob,
      updateImportJob: persistence.updateImportJob,
      crawlSiteSource,
      generateDraftForVertical,
      persistSiteImport: persistence.persistSiteImport,
      recordImportFailure: persistence.recordImportFailure,
    };
    const prepared = await executeLeadPreview(parsed.request, executor);
    if (!prepared.completed) {
      fail(prepared.failure);
      return;
    }
    console.log(JSON.stringify(prepared, null, 2));
  } catch {
    fail("preview_generation_failed");
  } finally {
    if (disconnect) {
      try {
        await getDb().$disconnect();
      } catch {
        // The failure result above already covers an unavailable database.
      }
    }
  }
}

function fail(failure: string): void {
  console.error(
    JSON.stringify({
      command: "operator-prepare-lead",
      completed: false,
      failure,
      usage: failure === "usage" ? PREPARE_LEAD_USAGE : undefined,
    }),
  );
  process.exitCode = 1;
}
