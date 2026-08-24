import { getDb } from "@/lib/db";

export const ARTICLE_MUTATION_GATE_KEY = "articles.mutations.gated";
export const ARTICLE_MUTATION_GATE_REASON =
  "Article changes are temporarily paused for a safe release. Try again later.";

/**
 * The release gate is deliberately fail closed. A missing row, unreadable
 * setting, or database error must never let a predecessor/candidate boundary
 * reopen article generation or publication implicitly.
 */
export async function areArticleMutationsGated(): Promise<boolean> {
  try {
    const setting = await getDb().operatorSetting.findUnique({
      where: { key: ARTICLE_MUTATION_GATE_KEY },
      select: { value: true },
    });
    return setting?.value !== false;
  } catch (error) {
    console.error("[article-mutations] gate read failed", {
      error: error instanceof Error ? error.message : "unknown",
    });
    return true;
  }
}
