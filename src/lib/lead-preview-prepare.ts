import { isIP } from "node:net";
import { isDatabaseLoopbackHostname } from "@/lib/environment-isolation";
import { isPrivateAddress, type ExtractedSite } from "@/lib/importer";
import {
  assessLeadDelivery,
  type LeadDeliveryAssessment,
} from "@/lib/operator-autonomy/lead-delivery";
import type { PersistableSiteDraft } from "@/lib/site-persistence";
import { isVerticalClaimEnabled, resolveVerticalBySlug } from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";

export const PREPARE_LEAD_USAGE =
  "Usage: bun run operator:prepare-lead -- --source <https-url> --vertical <vertical> --city <city> [--name <name>] [--execute]";

export const PREPARE_LEAD_ACTOR = "operator:prepare-lead";

export type PrepareLeadFailure =
  | "usage"
  | "lead_email_blocked"
  | "source_not_public"
  | "vertical_unknown"
  | "database_required"
  | "production_target_refused"
  | "preview_generation_failed";

export type PrepareLeadRequest = {
  source: string;
  vertical: VerticalId;
  city: string;
  name: string | null;
  execute: boolean;
};

export type PrepareLeadPlan = {
  command: "operator:prepare-lead";
  mode: "dry-run" | "execute";
  source: string;
  vertical: VerticalId;
  city: string;
  name: string | null;
  claimEnabled: boolean;
  sendsEmail: false;
  photoIngest: "not_run";
  preview: LeadDeliveryAssessment["preview"];
  email: LeadDeliveryAssessment["email"];
};

export type LeadPreviewExecutor = {
  createImportJob: (
    source: string,
    vertical: VerticalId,
  ) => Promise<{ id: string }>;
  updateImportJob: (
    importJobId: string,
    data: { status: "CRAWLING" | "EXTRACTING" | "GENERATING" },
  ) => Promise<void>;
  crawlSiteSource: (
    source: string,
    vertical: VerticalId,
  ) => Promise<ExtractedSite>;
  generateDraftForVertical: (
    extracted: ExtractedSite,
    vertical: VerticalId,
  ) => Promise<PersistableSiteDraft>;
  persistSiteImport: (input: {
    draft: PersistableSiteDraft;
    vertical: VerticalId;
    source: string;
    importJobId: string;
    actor: string;
  }) => Promise<{
    draft: { slug: string };
    importJobId: string;
    urls: { preview: string; claim: string };
    created: boolean;
  }>;
  recordImportFailure: (importJobId: string, error: unknown) => Promise<unknown>;
};

export type PreparedLeadPreview = {
  command: "operator:prepare-lead";
  completed: true;
  mode: "execute";
  source: string;
  vertical: VerticalId;
  siteSlug: string;
  importJobId: string;
  urls: { preview: string; claim: string };
  created: boolean;
  sendsEmail: false;
  email: "blocked";
};

type ArgumentValue = {
  source?: string;
  vertical?: string;
  city?: string;
  name?: string;
  execute: boolean;
};

export function parsePrepareLeadArguments(
  args: readonly string[],
): { ok: true; request: PrepareLeadRequest } | { ok: false; failure: PrepareLeadFailure } {
  if (args.includes("--send")) return { ok: false, failure: "lead_email_blocked" };

  const values: ArgumentValue = { execute: false };
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      if (values.execute) return { ok: false, failure: "usage" };
      values.execute = true;
      continue;
    }
    const value = args[index + 1];
    if (!argument?.startsWith("--") || !value || value.startsWith("--")) {
      return { ok: false, failure: "usage" };
    }
    if (argument === "--source" && values.source === undefined) {
      values.source = value;
    } else if (argument === "--vertical" && values.vertical === undefined) {
      values.vertical = value;
    } else if (argument === "--city" && values.city === undefined) {
      values.city = value;
    } else if (argument === "--name" && values.name === undefined) {
      values.name = value;
    } else {
      return { ok: false, failure: "usage" };
    }
    index += 1;
  }

  if (!values.source || !values.vertical || !values.city?.trim()) {
    return { ok: false, failure: "usage" };
  }
  const city = values.city.trim();
  if (city.length > 80) return { ok: false, failure: "usage" };
  const name = values.name?.trim() || null;
  if (name && name.length > 160) return { ok: false, failure: "usage" };
  if (publicSourceProblem(values.source)) {
    return { ok: false, failure: "source_not_public" };
  }
  const vertical = resolveVerticalBySlug(values.vertical);
  if (!vertical) return { ok: false, failure: "vertical_unknown" };

  return {
    ok: true,
    request: {
      source: values.source.trim(),
      vertical,
      city,
      name,
      execute: values.execute,
    },
  };
}

export function leadPrepareTargetProblem(
  env: Record<string, string | undefined>,
): "database_required" | "production_target_refused" | null {
  if (env.CORNERSHOP_ENV === "production") return "production_target_refused";
  const appOrigin = env.NEXT_PUBLIC_APP_URL?.trim();
  if (appOrigin) {
    try {
      const url = new URL(appOrigin);
      if (!isDatabaseLoopbackHostname(url.hostname)) {
        return "production_target_refused";
      }
    } catch {
      return "production_target_refused";
    }
  }

  const databaseUrl = env.DATABASE_URL?.trim();
  if (!databaseUrl) return "database_required";
  try {
    const url = new URL(databaseUrl);
    if (url.protocol !== "postgresql:" && url.protocol !== "postgres:") {
      return "production_target_refused";
    }
    if (!isDatabaseLoopbackHostname(url.hostname)) {
      return "production_target_refused";
    }
  } catch {
    return "production_target_refused";
  }
  return null;
}

export function buildPrepareLeadPlan(request: PrepareLeadRequest): PrepareLeadPlan {
  const delivery = assessLeadDelivery();
  return {
    command: "operator:prepare-lead",
    mode: request.execute ? "execute" : "dry-run",
    source: request.source,
    vertical: request.vertical,
    city: request.city,
    name: request.name,
    claimEnabled: isVerticalClaimEnabled(request.vertical),
    sendsEmail: false,
    photoIngest: "not_run",
    preview: delivery.preview,
    email: delivery.email,
  };
}

export async function executeLeadPreview(
  request: PrepareLeadRequest,
  executor: LeadPreviewExecutor,
): Promise<
  | PreparedLeadPreview
  | { completed: false; failure: "preview_generation_failed"; importJobId: string | null }
> {
  let importJobId: string | null = null;
  try {
    const job = await executor.createImportJob(request.source, request.vertical);
    importJobId = job.id;
    await executor.updateImportJob(job.id, { status: "CRAWLING" });
    const extracted = await executor.crawlSiteSource(request.source, request.vertical);
    await executor.updateImportJob(job.id, { status: "EXTRACTING" });
    await executor.updateImportJob(job.id, { status: "GENERATING" });
    const draft = await executor.generateDraftForVertical(extracted, request.vertical);
    const persisted = await executor.persistSiteImport({
      draft,
      vertical: request.vertical,
      source: request.source,
      importJobId: job.id,
      actor: PREPARE_LEAD_ACTOR,
    });
    return {
      command: "operator:prepare-lead",
      completed: true,
      mode: "execute",
      source: request.source,
      vertical: request.vertical,
      siteSlug: persisted.draft.slug,
      importJobId: persisted.importJobId,
      urls: persisted.urls,
      created: persisted.created,
      sendsEmail: false,
      email: "blocked",
    };
  } catch (error) {
    if (importJobId) {
      try {
        await executor.recordImportFailure(importJobId, error);
      } catch {
        // The caller reports a stable failure code and omits the provider error.
      }
    }
    return {
      completed: false,
      failure: "preview_generation_failed",
      importJobId,
    };
  }
}

function publicSourceProblem(raw: string): string | null {
  const source = raw.trim();
  if (source.length < 2 || source.length > 500) return "source_not_public";
  let url: URL;
  try {
    url = new URL(source);
  } catch {
    return "source_not_public";
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return "source_not_public";
  if (url.username || url.password) return "source_not_public";
  const hostname = url.hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    !hostname ||
    hostname === "localhost" ||
    hostname.endsWith(".localhost") ||
    hostname.endsWith(".local") ||
    hostname.endsWith(".internal") ||
    hostname === "metadata.google.internal" ||
    isDatabaseLoopbackHostname(hostname) ||
    (isIP(hostname) && isPrivateAddress(hostname))
  ) {
    return "source_not_public";
  }
  return null;
}
