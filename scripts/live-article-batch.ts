/**
 * One-shot live proof for #97's first acceptance criterion: generate a real
 * batch against a fixture site in the local database and persist it.
 *
 * Run with: bunx tsx scripts/live-article-batch.ts
 * Requires .env DATABASE_URL + OPENROUTER_API_KEY.
 */
import "dotenv/config";

async function main() {
  const { getDb } = await import("../src/lib/db");
  const {
    loadGenerationInputs,
    generateBatchDrafts,
    persistArticleBatch,
    articleGenerationConfigured,
    beginArticleBatch,
    closeArticleBatch,
  } = await import("../src/lib/articles/generation");
  const { reserveArticleBatch } = await import(
    "../src/lib/articles/start-batch"
  );
  const { checkArticleDraft } = await import(
    "../src/lib/articles/composer"
  );

  if (!articleGenerationConfigured()) {
    throw new Error("OPENROUTER_API_KEY missing — set it in .env or SSM");
  }
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL missing");
  }

  const db = getDb();
  const slug = process.argv[2] ?? "le-petit-meunier-live";
  let site = await db.site.findUnique({
    where: { slug },
    select: { id: true, status: true },
  });
  if (!site) {
    console.log(`creating fixture site ${slug}…`);
    site = await db.site.create({
      data: {
        slug,
        name: "Le Petit Meunier",
        status: "CLAIMED",
        address: "12 Rue du Four, 75005 Paris",
        phone: "+33 1 42 00 00 00",
        defaultLocale: "fr",
        description: "Boulangerie artisanale dans le cinquième.",
        catalogSections: {
          create: [
            {
              name: "Viennoiseries",
              position: 0,
              items: {
                create: [
                  {
                    name: "Croissant",
                    position: 0,
                    description: "Beurre AOP, feuilletage maison.",
                  },
                  {
                    name: "Pain au chocolat",
                    position: 1,
                    description: "Double bâton de chocolat noir.",
                  },
                  {
                    name: "Baguette tradition",
                    position: 2,
                    description: "Levain naturel, cuisson sur pierre.",
                  },
                ],
              },
            },
            {
              name: "Pâtisseries",
              position: 1,
              items: {
                create: [
                  {
                    name: "Tarte aux pommes",
                    position: 0,
                    description: "Pommes du Vexin, pâte feuilletée.",
                  },
                  {
                    name: "Paris-Brest",
                    position: 1,
                    description: "Crème pralinée noisette.",
                  },
                ],
              },
            },
          ],
        },
        businessHours: [
          { days: "Mar–Sam", hours: "07:00–19:30" },
          { days: "Dim", hours: "07:30–13:00" },
        ],
        integrations: {
          create: [
            {
              type: "ORDERING",
              label: "Commander en ligne",
              url: "https://order.example/lepetitmeunier",
              position: 0,
            },
          ],
        },
      },
      select: { id: true, status: true },
    });
  }
  if (site.status !== "CLAIMED" && site.status !== "LIVE") {
    throw new Error(`fixture site status is ${site.status}, need CLAIMED/LIVE`);
  }

  console.log("loading generation inputs…");
  const inputs = await loadGenerationInputs(site.id);
  if (!inputs.ok) throw new Error(inputs.reason);
  console.log(
    `facts: ${inputs.facts.catalogItems.length} items, locale ${inputs.facts.locale}, recent topics: [${inputs.recentTopicKeys}]`,
  );

  const admission = await reserveArticleBatch({
    siteId: site.id,
    requestedBy: "live-proof-script",
    count: 4,
  });
  if (!admission.ok) throw new Error(admission.reason);

  try {
    const reservation = await beginArticleBatch(admission.batchId);
    if (!reservation) {
      throw new Error("article batch reservation could not start");
    }
    console.log("calling the model…");
    const started = Date.now();
    const generated = await generateBatchDrafts({
      facts: inputs.facts,
      recentTopicKeys: inputs.recentTopicKeys,
      count: reservation.requestedCount,
    });
    if (generated.status === "SKIPPED") {
      await closeArticleBatch({
        batchId: admission.batchId,
        status: "SKIPPED",
        statusReason: generated.statusReason,
      });
      throw new Error("No supportable article topics were available");
    }
    console.log(
      `model returned ${generated.drafts.length} drafts in ${Date.now() - started}ms`,
    );
    if (!generated.drafts.length) {
      await closeArticleBatch({
        batchId: admission.batchId,
        status: generated.rejectedCount > 0 ? "REJECTED" : "ZERO_OUTPUT",
        statusReason:
          generated.rejectedCount > 0
            ? "INVALID_MODEL_OUTPUT"
            : "MODEL_RETURNED_ZERO_DRAFTS",
        rejectedCount: generated.rejectedCount,
      });
      throw new Error("The model returned no persistable article drafts");
    }

    for (const draft of generated.drafts) {
      const problems = checkArticleDraft(draft, inputs.facts);
      console.log(
        `  [${draft.topicKey}] "${draft.title}" (${draft.bodyMarkdown.length} chars) → ${
          problems.length ? `REJECTED: ${problems.join("; ")}` : "accepted"
        }`,
      );
    }

    const persisted = await persistArticleBatch({
      batchId: admission.batchId,
      siteId: site.id,
      facts: inputs.facts,
      model: process.env.OPENROUTER_TEXT_MODEL ?? "openrouter/auto",
      drafts: generated.drafts,
      rejectedCount: generated.rejectedCount,
    });

    console.log(
      `\nbatch ${persisted.batchId}: requested ${reservation.requestedCount}, persisted ${persisted.producedCount}, rejected ${persisted.rejectedCount}`,
    );
  } catch (error) {
    await closeArticleBatch({
      batchId: admission.batchId,
      status: "FAILED",
      statusReason: "LIVE_SCRIPT_FAILED",
    });
    throw error;
  }
  await db.$disconnect?.();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
