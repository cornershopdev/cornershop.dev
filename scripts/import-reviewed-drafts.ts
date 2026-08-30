import { readFile } from "node:fs/promises";
import { resolve } from "node:path";

type ReviewedDraft = {
  slug?: unknown;
};

type ReviewedDraftBatch = {
  batch?: unknown;
  locked?: unknown;
  vertical?: unknown;
  drafts?: unknown;
};

type Cli = {
  input: string;
  apiUrl: string;
  execute: boolean;
};

async function main() {
  const cli = parseArguments(process.argv.slice(2));
  const batch = parseBatch(
    JSON.parse(await readFile(cli.input, "utf8")) as ReviewedDraftBatch,
  );
  if (!cli.execute) {
    console.log(
      JSON.stringify({
        mode: "dry-run",
        batch: batch.name,
        vertical: batch.vertical,
        count: batch.drafts.length,
        slugs: batch.drafts.map((draft) => draft.slug),
      }),
    );
    return;
  }

  const token = process.env.OPERATOR_LEAD_INGEST_TOKEN?.trim();
  if (!token) {
    throw new Error("OPERATOR_LEAD_INGEST_TOKEN is required with --execute");
  }
  const response = await fetch(
    `${cli.apiUrl}/api/admin/leads/reviewed-draft`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        batch: batch.name,
        locked: true,
        vertical: batch.vertical,
        drafts: batch.drafts,
      }),
    },
  );
  const imported = (await response.json()) as {
    ok?: boolean;
    batch?: string;
    count?: number;
    results?: Array<{
      slug?: string;
      created?: boolean;
      verified?: boolean;
      urls?: { preview?: string };
    }>;
    error?: string;
  };
  if (!response.ok || !imported.ok || imported.batch !== batch.name) {
    throw new Error(
      `Batch import failed (${response.status}): ${imported.error ?? "unknown error"}`,
    );
  }
  if (
    imported.count !== batch.drafts.length ||
    imported.results?.length !== batch.drafts.length
  ) {
    throw new Error("Batch import returned an invalid result count");
  }

  const results = [];
  for (const [index, draft] of batch.drafts.entries()) {
    const result = imported.results[index];
    if (
      result?.slug !== draft.slug ||
      result.verified !== true ||
      !result.urls?.preview
    ) {
      throw new Error(`${draft.slug} returned an invalid verification result`);
    }
    const preview = await fetch(`${cli.apiUrl}${result.urls.preview}`, {
      redirect: "follow",
    });
    if (!preview.ok) {
      throw new Error(
        `${draft.slug} preview returned ${preview.status} after import`,
      );
    }
    results.push({
      slug: draft.slug,
      created: result.created === true,
      verified: true,
      previewStatus: preview.status,
    });
  }

  console.log(
    JSON.stringify({
      mode: "execute",
      batch: batch.name,
      count: results.length,
      results,
    }),
  );
}

function parseArguments(args: string[]): Cli {
  let input = "";
  let apiUrl = "https://cornershop.dev";
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--input") {
      input = args[++index] ?? "";
      continue;
    }
    if (argument === "--api-url") {
      apiUrl = args[++index] ?? "";
      continue;
    }
    throw new Error(
      "Usage: bun run operator:import:reviewed-drafts -- --input <private-json> [--api-url <origin>] [--execute]",
    );
  }
  if (!input) throw new Error("--input is required");
  const origin = new URL(apiUrl);
  if (origin.protocol !== "https:" && origin.hostname !== "127.0.0.1") {
    throw new Error("--api-url must use HTTPS outside local verification");
  }
  if (origin.pathname !== "/" || origin.search || origin.hash) {
    throw new Error("--api-url must be an origin without a path");
  }
  return {
    input: resolve(input),
    apiUrl: origin.origin,
    execute,
  };
}

function parseBatch(input: ReviewedDraftBatch) {
  if (input.locked !== true) throw new Error("Reviewed draft batch is not locked");
  const name = typeof input.batch === "string" ? input.batch.trim() : "";
  const vertical =
    typeof input.vertical === "string" ? input.vertical.trim() : "";
  const drafts = Array.isArray(input.drafts)
    ? (input.drafts as ReviewedDraft[])
    : [];
  if (!name || !vertical || drafts.length === 0 || drafts.length > 20) {
    throw new Error("Reviewed draft batch metadata is invalid");
  }
  const slugs = drafts.map((draft) =>
    typeof draft.slug === "string" ? draft.slug.trim() : "",
  );
  if (slugs.some((slug) => !slug) || new Set(slugs).size !== slugs.length) {
    throw new Error("Reviewed draft slugs must be present and unique");
  }
  return {
    name,
    vertical,
    drafts: drafts.map((draft, index) => ({ ...draft, slug: slugs[index] })),
  };
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : "Import failed");
  process.exitCode = 1;
}
