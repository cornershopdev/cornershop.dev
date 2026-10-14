import { describe, expect, it } from "bun:test";
import type { ExtractedSite } from "@/lib/importer";
import {
  buildPrepareLeadPlan,
  executeLeadPreview,
  leadPrepareTargetProblem,
  parsePrepareLeadArguments,
  type LeadPreviewExecutor,
} from "@/lib/lead-preview-prepare";
import type { PersistableSiteDraft } from "@/lib/site-persistence";

const source = "https://example.com/menu";
const databaseUrl = "postgres://operator:supersecret@127.0.0.1:5432/cornershop";
const remoteDatabaseUrl = "postgres://operator:supersecret@db.internal:5432/cornershop";

function failureOf(args: string[]) {
  const parsed = parsePrepareLeadArguments(args);
  if (parsed.ok) throw new Error("expected a refused lead plan");
  return parsed.failure;
}

function request(execute = false) {
  const parsed = parsePrepareLeadArguments([
    "--source",
    source,
    "--vertical",
    "restaurant",
    "--city",
    "Valletta",
    ...(execute ? ["--execute"] : []),
  ]);
  if (!parsed.ok) throw new Error(parsed.failure);
  return parsed.request;
}

describe("prepare lead", () => {
  it("refuses a send flag, a private source, and an unknown vertical", () => {
    expect(failureOf(["--send", "--source", source])).toBe("lead_email_blocked");
    expect(
      failureOf([
        "--source",
        "http://127.0.0.1/admin",
        "--vertical",
        "restaurant",
        "--city",
        "Valletta",
      ]),
    ).toBe("source_not_public");
    expect(
      failureOf([
        "--source",
        "http://10.1.1.1/menu",
        "--vertical",
        "restaurant",
        "--city",
        "Valletta",
      ]),
    ).toBe("source_not_public");
    expect(
      failureOf([
        "--source",
        source,
        "--vertical",
        "not-a-niche",
        "--city",
        "Valletta",
      ]),
    ).toBe("vertical_unknown");
  });

  it("plans a private preview and keeps email blocked", () => {
    const plan = buildPrepareLeadPlan(request());

    expect(plan.mode).toBe("dry-run");
    expect(plan.sendsEmail).toBe(false);
    expect(plan.email.status).toBe("blocked");
    expect(plan.claimEnabled).toBe(true);
    expect(plan.photoIngest).toBe("not_run");
    expect(JSON.stringify(plan)).not.toContain("supersecret");
  });

  it("refuses a production database and accepts loopback", () => {
    expect(leadPrepareTargetProblem({})).toBe("database_required");
    expect(leadPrepareTargetProblem({ DATABASE_URL: remoteDatabaseUrl })).toBe(
      "production_target_refused",
    );
    expect(
      leadPrepareTargetProblem({
        DATABASE_URL: databaseUrl,
        NEXT_PUBLIC_APP_URL: "https://cornershop.dev",
      }),
    ).toBe("production_target_refused");
    expect(
      leadPrepareTargetProblem({
        DATABASE_URL: databaseUrl,
        CORNERSHOP_ENV: "production",
      }),
    ).toBe("production_target_refused");
    expect(leadPrepareTargetProblem({ DATABASE_URL: databaseUrl })).toBeNull();
  });

  it("generates a preview without copying the provider error or a recipient", async () => {
    const secret = "postgres://operator:supersecret@db.internal/cornershop";
    let recorded: unknown = null;
    const executor: LeadPreviewExecutor = {
      createImportJob: async () => ({ id: "job-1" }),
      updateImportJob: async () => undefined,
      crawlSiteSource: async () => {
        throw new Error(secret);
      },
      generateDraftForVertical: async () => {
        throw new Error("generate should not run");
      },
      persistSiteImport: async () => {
        throw new Error("persist should not run");
      },
      recordImportFailure: async (_id, error) => {
        recorded = error;
        return "recorded";
      },
    };

    const failed = await executeLeadPreview(request(true), executor);
    expect(failed).toEqual({
      completed: false,
      failure: "preview_generation_failed",
      importJobId: "job-1",
    });
    expect(JSON.stringify(failed)).not.toContain("supersecret");
    expect(recorded).toBeInstanceOf(Error);

    const persisted: Array<Record<string, unknown>> = [];
    const ready: LeadPreviewExecutor = {
      createImportJob: async () => ({ id: "job-2" }),
      updateImportJob: async () => undefined,
      crawlSiteSource: async () => ({ name: "Ada Bakery" }) as ExtractedSite,
      generateDraftForVertical: async () =>
        ({ slug: "ada-bakery", name: "Ada Bakery" }) as PersistableSiteDraft,
      persistSiteImport: async (input) => {
        persisted.push(input);
        return {
          draft: { slug: "ada-bakery" },
          importJobId: input.importJobId,
          urls: { preview: "/preview/ada-bakery", claim: "/claim/ada-bakery" },
          created: true,
        };
      },
      recordImportFailure: async () => "unused",
    };

    const prepared = await executeLeadPreview(request(true), ready);
    expect(prepared).toMatchObject({
      completed: true,
      siteSlug: "ada-bakery",
      sendsEmail: false,
      email: "blocked",
    });
    expect(persisted[0]).toMatchObject({
      source,
      actor: "operator:prepare-lead",
    });
    expect(persisted[0]).not.toHaveProperty("contactEmail");
  });

  it("refuses to start a send from the command", () => {
    const env = { ...process.env, DATABASE_URL: databaseUrl };
    const result = Bun.spawnSync(
      ["bun", "scripts/operator-prepare-lead.ts", "--send"],
      {
        cwd: new URL("../..", import.meta.url).pathname,
        env,
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const stdout = new TextDecoder().decode(result.stdout);
    const stderr = new TextDecoder().decode(result.stderr);

    expect(result.exitCode).toBe(1);
    expect(stdout).toBe("");
    expect(stderr).toContain("lead_email_blocked");
    expect(stderr).not.toContain("supersecret");
    expect(stderr).not.toContain(databaseUrl);
  });
});
