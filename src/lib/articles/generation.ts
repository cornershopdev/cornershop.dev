import { z } from "zod";
import { generateText, Output } from "ai";
import { createOpenRouter } from "@openrouter/ai-sdk-provider";
import {
  checkArticleDraft,
  selectBatchTopics,
  type GeneratedArticleDraft,
} from "@/lib/articles/composer";
import type { SiteFacts } from "@/lib/articles/site-facts";
import {
  articleTopicPlanByKey,
  articleTopicPlansFor,
} from "@/lib/articles/topic-plans";
import { getDb } from "@/lib/db";

/**
 * Mirrors the site generator's provider policy: one OpenRouter key gates
 * everything, and customer content only routes to providers that neither
 * retain nor train on prompts.
 */
export function articleGenerationConfigured(): boolean {
  return Boolean(process.env.OPENROUTER_API_KEY);
}

function getModel() {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new Error("OPENROUTER_API_KEY is not configured");
  return createOpenRouter({
    apiKey,
    compatibility: "strict",
    headers: {
      "HTTP-Referer":
        process.env.NEXT_PUBLIC_APP_URL ?? "https://cornershop.dev",
      "X-Title": "Cornershopdev",
    },
  }).chat(process.env.OPENROUTER_TEXT_MODEL ?? "openrouter/auto", {
    extraBody: {
      provider: { require_parameters: true, data_collection: "deny" },
      plugins: [{ id: "response-healing" }],
    },
    usage: { include: true },
  });
}

export const articleBatchOutputSchema = z.object({
  articles: z
    .array(
      z.object({
        topicKey: z.string(),
        slug: z.string(),
        title: z.string(),
        excerpt: z.string(),
        bodyMarkdown: z.string(),
        catalogClaims: z
          .array(
            z.object({
              name: z.string().min(1).max(120),
              price: z.number().finite().nonnegative().max(99_999_999.99).nullable(),
              currency: z
                .string()
                .regex(/^[A-Z]{3}$/)
                .nullable(),
            }),
          )
          .max(32),
      }),
    )
    .max(8),
});

export function buildArticleBatchPrompt(input: {
  facts: SiteFacts;
  topics: Array<{ key: string; title: string }>;
}): string {
  const { facts, topics } = input;
  const lines = [
    `You are writing blog articles for "${facts.name}", a real local business.`,
    "",
    "Verified facts you may use — never contradict or extend them:",
    `- Address: ${facts.address ?? "none published"}`,
    `- Phone: ${facts.phone ?? "none published"}`,
    `- Hours: ${
      facts.businessHours
        .map((entry) => `${entry.days} ${entry.hours}`)
        .join("; ") || "none published"
    }`,
    `- Catalog items (canonical name, price, currency): ${
      facts.catalogItems.length ? JSON.stringify(facts.catalogItems) : "none listed"
    }`,
    `- Booking/ordering options: ${facts.integrationLabels.join(", ") || "none"}`,
    "",
    "Rules:",
    "- Never invent awards, rankings, certifications, prices, staff names, suppliers, reviews, or statistics.",
    "- Every catalog item mentioned by name must appear in the list above.",
    "- catalogClaims must enumerate every catalog item named in title, excerpt, or bodyMarkdown.",
    "- A catalogClaims price/currency pair must be copied exactly from that same catalog item; use null/null when no price is stated in the article.",
    `- Write in ${facts.locale === "fr" ? "French" : "English"} for a local audience.`,
    "- Body is GitHub-flavoured markdown with at most two headings and no images.",
    "- slug must be kebab-case ASCII.",
    "- Do not include the business's address or phone inside the body; the site chrome already shows them.",
    "",
    "Write exactly one article per requested topic:",
    ...topics.map((topic) => `- [${topic.key}] ${topic.title}`),
    "",
    'Return JSON: {"articles":[{topicKey,slug,title,excerpt,bodyMarkdown,catalogClaims:[{name,price,currency}]}]}',
  ];
  return lines.join("\n");
}

export async function generateBatchDrafts(input: {
  facts: SiteFacts;
  count: number;
  recentTopicKeys: string[];
}): Promise<GeneratedBatchDrafts> {
  if (!articleGenerationConfigured()) {
    throw new Error("OPENROUTER_API_KEY is not configured");
  }
  const plans = articleTopicPlansFor(input.facts.vertical);
  const selected = selectBatchTopics({
    facts: input.facts,
    plans,
    count: input.count,
    recentTopicKeys: input.recentTopicKeys,
  });
  if (!selected.length) {
    return {
      status: "SKIPPED",
      statusReason: "NO_SUPPORTABLE_TOPICS",
      drafts: [],
      rejectedCount: 0,
    };
  }

  const topics = selected.flatMap((topic) => {
    const plan = articleTopicPlanByKey(input.facts.vertical, topic.key);
    return plan ? [{ key: plan.key, title: plan.title }] : [];
  });

  const { output } = await generateText({
    model: getModel(),
    output: Output.object({
      schema: articleBatchOutputSchema,
      name: "site_article_batch",
      description: "Locally relevant blog articles for one real business",
    }),
    maxRetries: 2,
    timeout: { totalMs: 55_000, stepMs: 45_000 },
    prompt: buildArticleBatchPrompt({ facts: input.facts, topics }),
  });

  const allowed = new Set(topics.map((topic) => topic.key));
  const drafts = output.articles
    .slice(0, topics.length)
    .filter((draft) => allowed.has(draft.topicKey));
  return {
    status: "GENERATED",
    drafts,
    rejectedCount: output.articles.length - drafts.length,
  };
}

export type GeneratedBatchDrafts =
  | {
      status: "SKIPPED";
      statusReason: "NO_SUPPORTABLE_TOPICS";
      drafts: [];
      rejectedCount: 0;
    }
  | {
      status: "GENERATED";
      drafts: GeneratedArticleDraft[];
      rejectedCount: number;
    };

export type PersistedBatch = {
  batchId: string;
  producedCount: number;
  rejectedCount: number;
};

/**
 * Persists guardrail-passing drafts as DRAFT articles under the batch row that
 * admission reserved before generation. Rejected drafts shrink the batch and
 * are counted independently from the immutable requestedCount.
 */
export async function persistArticleBatch(input: {
  batchId: string;
  siteId: string;
  facts: SiteFacts;
  drafts: GeneratedArticleDraft[];
  rejectedCount?: number;
  model?: string | null;
}): Promise<PersistedBatch> {
  const db = getDb();
  const accepted = input.drafts.filter(
    (draft) => !checkArticleDraft(draft, input.facts).length,
  );
  const rejectedCount =
    Math.max(0, input.rejectedCount ?? 0) +
    (input.drafts.length - accepted.length);

  return db.$transaction(async (transaction) => {
    const existingBatch = await transaction.articleBatch.findUnique({
      where: { id: input.batchId },
      select: {
        siteId: true,
        status: true,
        acceptedCount: true,
        rejectedCount: true,
      },
    });
    if (!existingBatch || existingBatch.siteId !== input.siteId) {
      throw new Error("Article batch reservation was not found");
    }
    if (
      existingBatch.status === "SUCCEEDED" ||
      existingBatch.status === "REJECTED"
    ) {
      return {
        batchId: input.batchId,
        producedCount: existingBatch.acceptedCount,
        rejectedCount: existingBatch.rejectedCount,
      };
    }
    if (
      existingBatch.status !== "QUEUED" &&
      existingBatch.status !== "RUNNING"
    ) {
      throw new Error("Article batch reservation is already terminal");
    }

    const existingSlugs = new Set(
      (
        await transaction.article.findMany({
          where: { siteId: input.siteId },
          select: { slug: true },
        })
      ).map((row) => row.slug),
    );
    let producedCount = 0;
    for (const draft of accepted) {
      const slug = dedupeSlug(draft.slug, existingSlugs);
      existingSlugs.add(slug);
      await transaction.article.create({
        data: {
          siteId: input.siteId,
          batchId: input.batchId,
          slug,
          locale: input.facts.locale,
          title: draft.title.trim(),
          excerpt: draft.excerpt.trim(),
          bodyMarkdown: draft.bodyMarkdown,
          status: "DRAFT",
          topicKey: draft.topicKey,
          topicTitle:
            articleTopicPlanByKey(input.facts.vertical, draft.topicKey)?.title ??
            draft.topicKey,
          generatedByModel: input.model ?? null,
          sourceBatchId: input.batchId,
        },
        select: { id: true },
      });
      producedCount += 1;
    }

    const status = producedCount > 0 ? "SUCCEEDED" : "REJECTED";
    const completed = await transaction.articleBatch.updateMany({
      where: {
        id: input.batchId,
        siteId: input.siteId,
        status: { in: ["QUEUED", "RUNNING"] },
      },
      data: {
        acceptedCount: producedCount,
        rejectedCount,
        status,
        statusReason: status === "REJECTED" ? "ALL_DRAFTS_REJECTED" : null,
        model: input.model ?? null,
        completedAt: new Date(),
      },
    });
    if (completed.count !== 1) {
      throw new Error("Article batch terminal transition was lost");
    }
    return { batchId: input.batchId, producedCount, rejectedCount };
  });
}

export async function beginArticleBatch(batchId: string): Promise<{
  siteId: string;
  requestedCount: number;
} | null> {
  const db = getDb();
  await db.articleBatch.updateMany({
    where: { id: batchId, status: "QUEUED" },
    data: { status: "RUNNING", startedAt: new Date() },
  });
  const existing = await db.articleBatch.findUnique({
    where: { id: batchId },
    select: { siteId: true, requestedCount: true, status: true },
  });
  if (!existing || existing.status !== "RUNNING") return null;
  return {
    siteId: existing.siteId,
    requestedCount: existing.requestedCount,
  };
}

export async function closeArticleBatch(input: {
  batchId: string;
  status: "ZERO_OUTPUT" | "REJECTED" | "SKIPPED" | "FAILED";
  statusReason: string;
  rejectedCount?: number;
  expectedStatuses?: Array<"QUEUED" | "RUNNING">;
}): Promise<boolean> {
  const db = getDb();
  const completed = await db.articleBatch.updateMany({
    where: {
      id: input.batchId,
      status: { in: input.expectedStatuses ?? ["QUEUED", "RUNNING"] },
    },
    data: {
      acceptedCount: 0,
      rejectedCount: Math.max(0, input.rejectedCount ?? 0),
      status: input.status,
      statusReason: input.statusReason,
      completedAt: new Date(),
    },
  });
  if (completed.count === 1) return true;
  const existing = await db.articleBatch.findUnique({
    where: { id: input.batchId },
    select: { status: true },
  });
  return existing?.status === input.status;
}

/** Reads the fact slice + recent topics used for generation in one pass. */
export async function loadGenerationInputs(siteId: string): Promise<{
  ok: true;
  facts: SiteFacts;
  recentTopicKeys: string[];
} | { ok: false; reason: string }> {
  const db = getDb();
  const site = await db.site.findUnique({
    where: { id: siteId },
    select: {
      id: true,
      slug: true,
      name: true,
      vertical: true,
      defaultLocale: true,
      address: true,
      phone: true,
      businessHours: true,
      status: true,
    },
  });
  if (!site) return { ok: false, reason: "Site not found." };
  if (site.status !== "CLAIMED" && site.status !== "LIVE") {
    return { ok: false, reason: "Only claimed sites can accumulate content." };
  }

  const [sections, integrations, recentBatches] = await Promise.all([
    db.catalogSection.findMany({
      where: { siteId },
      orderBy: { position: "asc" },
      select: {
        items: {
          select: { name: true, price: true, currency: true },
          orderBy: { position: "asc" },
        },
      },
    }),
    db.integration.findMany({
      where: { siteId },
      select: { label: true },
      orderBy: { label: "asc" },
    }),
    // The dedupe contract is "topics covered by the two most recent batches",
    // so read batches first and expand from there — scanning articles by
    // recency would let a site with many old articles dilute the window.
    db.articleBatch.findMany({
      where: {
        siteId,
        status: "SUCCEEDED",
        acceptedCount: { gt: 0 },
        completedAt: { not: null },
      },
      orderBy: { createdAt: "desc" },
      take: 2,
      select: {
        articles: {
          where: { status: { in: ["DRAFT", "PUBLISHED"] } },
          select: { topicKey: true },
        },
      },
    }),
  ]);

  const recentTopicKeys = [
    ...new Set(recentBatches.flatMap((batch) => batch.articles.map((a) => a.topicKey))),
  ];

  const businessHours = Array.isArray(site.businessHours)
    ? (site.businessHours as Array<{ days?: unknown; hours?: unknown }>).flatMap(
        (entry) =>
          typeof entry?.days === "string" && typeof entry?.hours === "string"
            ? [{ days: entry.days, hours: entry.hours }]
            : [],
      )
    : [];

  return {
    ok: true,
    facts: {
      slug: site.slug,
      name: site.name,
      vertical: site.vertical,
      locale: site.defaultLocale,
      address: site.address,
      phone: site.phone,
      businessHours,
      catalogItems: sections.flatMap((section) =>
        section.items.map((item) => ({
          name: item.name,
          price: item.price === null ? null : Number(item.price),
          currency: item.currency,
        })),
      ),
      integrationLabels: integrations.map((integration) => integration.label),
    },
    recentTopicKeys,
  };
}

function dedupeSlug(slug: string, taken: Set<string>): string {
  const base = slug.trim().toLowerCase();
  if (!taken.has(base)) return base;
  let counter = 2;
  while (taken.has(`${base}-${counter}`)) counter += 1;
  return `${base}-${counter}`;
}
