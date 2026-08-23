import { createHash } from "node:crypto";
import type { SiteFacts } from "@/lib/articles/site-facts";
import { availableFacts } from "@/lib/articles/site-facts";
import { articleTopicPlanByKey } from "@/lib/articles/topic-plans";
import { supportedCurrencySchema } from "@/lib/verticals/schema";

/**
 * The bounded shape the model must return per article. Anything outside this
 * shape is rejected wholesale — the composer never repairs prose, it re-runs
 * or produces fewer articles.
 */
export type GeneratedArticleDraft = {
  topicKey: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
  catalogClaims: Array<{
    name: string;
    price: number | null;
    currency: string | null;
  }>;
};

export const MAX_ARTICLES_PER_BATCH = 8;
const MAX_BODY_CHARS = 12_000;
const MIN_BODY_CHARS = 400;
const MAX_CATALOG_CLAIMS = 32;

/**
 * Strings a customer site may never publish about itself. A generated article
 * asserting an award, a "best of" ranking, a certification, or a price that
 * is not in the catalog is fabricated trust — the exact failure mode this
 * engine exists to avoid. Checked case-insensitively against title + body.
 */
const FORBIDDEN_CLAIM_PATTERNS: RegExp[] = [
  /\baward[- ]?winning\b/i,
  /\bbest (?:restaurant|salon|shop|barber|cafe|bakery)\b/i,
  /\b(?:voted|rated) (?:the )?(?:best|#1|number one|no\.? ?1)\b/i,
  /\b(?:michelin|gault.?millau|aa rosette)\b/i,
  /\bcertified\b/i,
  /\bgovernment[- ]?(?:licensed|registered)\b/i,
  /\bguarantee[d]?\b/i,
];

/**
 * Deterministically picks which topics a batch may fill.
 *
 * Selection is round-robin over the vertical's topic plans filtered to those
 * whose required facts the site actually carries, seeded by the site id so
 * two sites with identical data do not get identical topic orders. Topics
 * covered by either of the site's last two batches are pushed to the back of
 * the queue instead of removed outright: with small plan sizes, dropping them
 * would strand a four-topic plan after two batches.
 */
export function selectBatchTopics(input: {
  facts: SiteFacts;
  plans: Array<{ key: string; requiredFacts: string[] }>;
  count: number;
  recentTopicKeys: string[];
}): Array<{ key: string }> {
  const available = availableFacts(input.facts);
  const eligible = input.plans.filter((plan) =>
    plan.requiredFacts.every((fact) => available.has(fact as never)),
  );
  if (!eligible.length) return [];

  const recent = new Set(
    input.recentTopicKeys.slice(0, Math.max(0, input.recentTopicKeys.length)),
  );
  const seed = hashSeed(input.facts.slug);
  const rotated = rotate(eligible, seed % eligible.length);
  const fresh = rotated.filter((plan) => !recent.has(plan.key));
  const stale = rotated.filter((plan) => recent.has(plan.key));

  return [...fresh, ...stale]
    .slice(0, Math.max(1, Math.min(input.count, MAX_ARTICLES_PER_BATCH)))
    .map((plan) => ({ key: plan.key }));
}

/**
 * Guardrails every generated article must pass before it can be persisted.
 * Returns human-readable violations; an empty array means the draft is
 * acceptable. Deliberately strict: a rejected article shrinks the batch
 * rather than shipping unverified claims to a customer's live site.
 */
export function checkArticleDraft(
  draft: GeneratedArticleDraft,
  facts: SiteFacts,
): string[] {
  const problems: string[] = [];
  const haystack = `${draft.title}\n${draft.excerpt}\n${draft.bodyMarkdown}`;

  for (const pattern of FORBIDDEN_CLAIM_PATTERNS) {
    if (pattern.test(haystack)) {
      problems.push(`forbidden claim matched ${pattern.source}`);
    }
  }

  checkCatalogClaims(draft, facts, haystack, problems);

  if (draft.bodyMarkdown.length > MAX_BODY_CHARS) {
    problems.push("body exceeds length budget");
  }
  if (draft.bodyMarkdown.length < MIN_BODY_CHARS) {
    problems.push("body implausibly short");
  }

  const slug = draft.slug.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    problems.push(`slug is not a URL-safe kebab-case label: "${slug}"`);
  }

  if (!draft.title.trim() || !draft.excerpt.trim()) {
    problems.push("title and excerpt are required");
  }

  return [...new Set(problems)];
}

type ValidatedPriceClaim = {
  normalizedName: string;
  currency: string;
  minorUnits: number;
};

type PriceAssertion = {
  index: number;
  end: number;
  currencyToken: string;
  amount: string;
  hasUnsupportedTail: boolean;
};

const SUPPORTED_CURRENCY_CODE_PATTERN =
  supportedCurrencySchema.options.join("|");
const CURRENCY_TOKEN_PATTERN = `(?:€|£|\\$|¥|zł|\\bkr\\b|\\b(?:${SUPPORTED_CURRENCY_CODE_PATTERN})\\b)`;
const CURRENCY_WORD_PATTERN = "(?:euros?|dollars?|pounds?)";
const AMOUNT_PATTERN = "\\d+(?:[.,]\\d{1,2})?";

/**
 * The model must enumerate every catalog fact it uses in structured output.
 * That declaration is checked against the same item's canonical name, price,
 * and currency before prose can reach persistence. Raw money tokens are also
 * scanned so omitting price metadata cannot bypass the structured boundary.
 */
function checkCatalogClaims(
  draft: GeneratedArticleDraft,
  facts: SiteFacts,
  haystack: string,
  problems: string[],
): void {
  if (!Array.isArray(draft.catalogClaims)) {
    problems.push("structured catalog claims are required");
    return;
  }
  if (draft.catalogClaims.length > MAX_CATALOG_CLAIMS) {
    problems.push("too many structured catalog claims");
  }
  const topicPlan = articleTopicPlanByKey(facts.vertical, draft.topicKey);
  if (
    topicPlan?.requiredFacts.includes("catalogItems") &&
    draft.catalogClaims.length === 0
  ) {
    problems.push("catalog-dependent topic requires a structured catalog claim");
  }

  const normalizedHaystack = normalizeCatalogText(haystack);
  const factsByName = new Map<
    string,
    Array<{ name: string; price: number | null; currency: string }>
  >();
  for (const fact of facts.catalogItems) {
    const normalizedName = normalizeCatalogText(fact.name);
    const existing = factsByName.get(normalizedName) ?? [];
    existing.push(fact);
    factsByName.set(normalizedName, existing);
  }

  const declaredNames = new Set<string>();
  const validatedPrices: ValidatedPriceClaim[] = [];
  for (const claim of draft.catalogClaims.slice(0, MAX_CATALOG_CLAIMS)) {
    const normalizedName = normalizeCatalogText(claim.name);
    if (!normalizedName) {
      problems.push("catalog claim name is required");
      continue;
    }
    declaredNames.add(normalizedName);

    if (!containsCatalogName(normalizedHaystack, normalizedName)) {
      problems.push(`catalog claim is absent from article: "${claim.name}"`);
    }

    const matchingFacts = factsByName.get(normalizedName) ?? [];
    if (!matchingFacts.length) {
      problems.push(`unknown catalog item claim: "${claim.name}"`);
      continue;
    }

    const hasPrice = claim.price !== null;
    const hasCurrency = Boolean(claim.currency?.trim());
    if (hasPrice !== hasCurrency) {
      problems.push(`catalog price claim is incomplete: "${claim.name}"`);
      continue;
    }
    if (!hasPrice || !claim.currency) continue;

    const claimedMinorUnits = toMinorUnits(claim.price);
    const claimedCurrency = normalizeCurrency(claim.currency);
    if (claimedMinorUnits === null || !claimedCurrency) {
      problems.push(`catalog price claim is invalid: "${claim.name}"`);
      continue;
    }

    const supported = matchingFacts.some((fact) => {
      const factMinorUnits = toMinorUnits(fact.price);
      return (
        factMinorUnits === claimedMinorUnits &&
        normalizeCurrency(fact.currency) === claimedCurrency
      );
    });
    if (!supported) {
      problems.push(`unsupported catalog price claim: "${claim.name}"`);
      continue;
    }
    validatedPrices.push({
      normalizedName,
      currency: claimedCurrency,
      minorUnits: claimedMinorUnits,
    });
  }

  // Known catalog names in prose cannot be omitted from the structured claim
  // list. This closes the metadata-omission path for every canonical item the
  // deterministic matcher can identify without treating arbitrary nouns as
  // products.
  for (const normalizedName of factsByName.keys()) {
    if (
      containsCatalogName(normalizedHaystack, normalizedName) &&
      !declaredNames.has(normalizedName)
    ) {
      problems.push(`catalog item mention lacks a structured claim: "${normalizedName}"`);
    }
  }

  // The structured contract is the primary boundary, but deterministic prose
  // still fails closed for high-confidence product assertions that omit it.
  // Restricting this supplemental detector to title-cased names next to
  // product verbs avoids classifying every arbitrary noun phrase as a product.
  const knownNonCatalogNames = new Set(
    [facts.name, facts.address, ...facts.integrationLabels].flatMap((value) => {
      if (!value?.trim()) return [];
      return [
        normalizeCatalogText(value),
        normalizeCatalogText(stripLikelyMentionDeterminer(value)),
      ];
    }),
  );
  for (const mention of extractLikelyCatalogMentions(haystack)) {
    const normalizedMention = normalizeCatalogText(
      stripLikelyMentionDeterminer(mention),
    );
    if (
      knownNonCatalogNames.has(normalizeCatalogText(mention)) ||
      knownNonCatalogNames.has(normalizedMention)
    ) {
      continue;
    }
    if (
      isDeclaredCatalogComposition(
        normalizedMention,
        factsByName,
        declaredNames,
      )
    ) {
      continue;
    }
    if (!factsByName.has(normalizedMention)) {
      problems.push(`unknown catalog item mention: "${mention}"`);
    } else if (!declaredNames.has(normalizedMention)) {
      problems.push(
        `catalog item mention lacks a structured claim: "${normalizedMention}"`,
      );
    }
  }

  for (const assertion of extractPriceAssertions(haystack)) {
    const assertionMinorUnits = toMinorUnits(
      Number(assertion.amount.replace(",", ".")),
    );
    const assertionCurrency = currencyForToken(assertion.currencyToken, facts);
    const sentenceBounds = catalogAssertionContextBounds(
      haystack,
      assertion.index,
      assertion.end,
      false,
    );
    const clauseBounds = catalogAssertionContextBounds(
      haystack,
      assertion.index,
      assertion.end,
      true,
    );
    const sentenceContext = normalizeCatalogText(
      haystack.slice(sentenceBounds.start, sentenceBounds.end),
    );
    const clauseContext = normalizeCatalogText(
      haystack.slice(clauseBounds.start, clauseBounds.end),
    );
    const afterAssertionContext = normalizeCatalogText(
      haystack.slice(assertion.end, sentenceBounds.end),
    );
    const sentenceNames = catalogNamesInContext(sentenceContext, factsByName);
    const clauseNames = catalogNamesInContext(clauseContext, factsByName);
    const afterAssertionNames = catalogNamesInContext(
      afterAssertionContext,
      factsByName,
    );
    const boundNames =
      clauseNames.size === 1
        ? clauseNames
        : clauseNames.size === 0 &&
            sentenceNames.size === 1 &&
            afterAssertionNames.size === 1
          ? sentenceNames
          : new Set<string>();
    const backed =
      !assertion.hasUnsupportedTail &&
      assertionMinorUnits !== null &&
      assertionCurrency !== null &&
      boundNames.size === 1 &&
      validatedPrices.some(
        (claim) =>
          claim.minorUnits === assertionMinorUnits &&
          claim.currency === assertionCurrency &&
          boundNames.has(claim.normalizedName),
      );
    if (!backed) problems.push("price assertion without catalog backing");
  }
}

function isDeclaredCatalogComposition(
  mention: string,
  factsByName: Map<
    string,
    Array<{ name: string; price: number | null; currency: string }>
  >,
  declaredNames: Set<string>,
): boolean {
  const names = [...factsByName.keys()]
    .filter((name) => declaredNames.has(name))
    .sort((left, right) => right.length - left.length);

  function consume(remaining: string): boolean {
    for (const name of names) {
      if (remaining !== name && !remaining.startsWith(`${name} `)) continue;
      const tail = remaining.slice(name.length);
      if (!tail) return true;
      const separator = tail.match(
        /^\s*(?:,\s*(?:(?:and|or|et|ou|&)\s+)?|(?:and|or|et|ou|&)\s+)/u,
      );
      if (separator && consume(tail.slice(separator[0].length))) return true;
    }
    return false;
  }

  return consume(mention);
}

function catalogNamesInContext(
  context: string,
  factsByName: Map<
    string,
    Array<{ name: string; price: number | null; currency: string }>
  >,
): Set<string> {
  return new Set(
    [...factsByName.keys()].filter((name) => containsCatalogName(context, name)),
  );
}

function extractLikelyCatalogMentions(haystack: string): string[] {
  const titleWord = String.raw`\p{Lu}[\p{L}\p{M}'’\-]*`;
  const followingWord = String.raw`[\p{L}\p{M}'’\-]+`;
  const candidate = `${titleWord}(?:\\s+${followingWord}){0,5}`;
  const productPredicate =
    String.raw`(?:costs?|(?:is|are|remains?)\s+(?:baked|folded|served|priced|prepared|made|available))`;
  const predicatePattern = new RegExp(
    String.raw`(?<![\p{L}\p{N}])(${candidate})\s+${productPredicate}\b`,
    "gu",
  );
  const activePattern = new RegExp(
    String.raw`\b(?:prepare|bake|serve|offer|sell|make)s?\s+(${titleWord}(?:\s+${titleWord}){0,4})\b`,
    "gu",
  );
  return [...haystack.matchAll(predicatePattern), ...haystack.matchAll(activePattern)]
    .flatMap((match) => (match[1] ? [match[1]] : []));
}

function stripLikelyMentionDeterminer(value: string): string {
  return value.replace(/^(?:A|An|The|Our|Le|La|Les|Un|Une)\s+/u, "");
}

function normalizeCatalogText(value: string): string {
  return value
    .normalize("NFKC")
    .toLocaleLowerCase("en")
    .replace(/[’‘`]/g, "'")
    .replace(/[‐‑‒–—]/g, "-")
    .replace(/\s+/g, " ")
    .trim();
}

function containsCatalogName(haystack: string, name: string): boolean {
  if (!name) return false;
  let index = haystack.indexOf(name);
  while (index >= 0) {
    const before = haystack[index - 1];
    const after = haystack[index + name.length];
    if (!isWordCharacter(before) && !isWordCharacter(after)) return true;
    index = haystack.indexOf(name, index + name.length);
  }
  return false;
}

function isWordCharacter(value: string | undefined): boolean {
  return Boolean(value && /[\p{L}\p{N}]/u.test(value));
}

function toMinorUnits(value: number | null): number | null {
  if (value === null || !Number.isFinite(value) || value < 0) return null;
  const minorUnits = Math.round(value * 100);
  return Math.abs(value * 100 - minorUnits) < 1e-6 ? minorUnits : null;
}

function normalizeCurrency(value: string): string | null {
  const normalized = value.trim().toUpperCase();
  return /^[A-Z]{3}$/.test(normalized) ? normalized : null;
}

function extractPriceAssertions(haystack: string): PriceAssertion[] {
  const assertions: PriceAssertion[] = [];
  const prefix = new RegExp(
    `(${CURRENCY_TOKEN_PATTERN})[\\s\\u00a0]*(${AMOUNT_PATTERN})`,
    "giu",
  );
  const suffix = new RegExp(
    `(${AMOUNT_PATTERN})[\\s\\u00a0]*(${CURRENCY_TOKEN_PATTERN}|\\b${CURRENCY_WORD_PATTERN}\\b)`,
    "giu",
  );

  for (const match of haystack.matchAll(prefix)) {
    if (match[1] && match[2] && match.index !== undefined) {
      const end = match.index + match[0].length;
      assertions.push({
        index: match.index,
        end,
        currencyToken: match[1],
        amount: match[2],
        hasUnsupportedTail: hasUnsupportedPriceTail(haystack, end),
      });
    }
  }
  for (const match of haystack.matchAll(suffix)) {
    if (match[1] && match[2] && match.index !== undefined) {
      const end = match.index + match[0].length;
      assertions.push({
        index: match.index,
        end,
        currencyToken: match[2],
        amount: match[1],
        hasUnsupportedTail: hasUnsupportedPriceTail(haystack, end),
      });
    }
  }
  return assertions.sort((left, right) => left.index - right.index);
}

function hasUnsupportedPriceTail(haystack: string, end: number): boolean {
  return new RegExp(
    `^(?:\\d|[\\s\\u00a0]*(?:[-‐‑‒–—−/~]|to\\b|à\\b)[\\s\\u00a0]*(?:${CURRENCY_TOKEN_PATTERN}[\\s\\u00a0]*)?\\d)`,
    "iu",
  ).test(haystack.slice(end));
}

function currencyForToken(token: string, facts: SiteFacts): string | null {
  const normalized = token.trim().toUpperCase();
  if (normalized === "€" || normalized.startsWith("EURO")) return "EUR";
  if (normalized === "£" || normalized.startsWith("POUND")) return "GBP";
  if (normalized === "¥") return "JPY";
  if (normalized === "ZŁ") return "PLN";
  if (normalized === "KR") {
    const krCurrencies = new Set(
      facts.catalogItems.flatMap((item) => {
        if (item.price === null) return [];
        const currency = normalizeCurrency(item.currency);
        return currency && ["SEK", "NOK", "DKK"].includes(currency)
          ? [currency]
          : [];
      }),
    );
    return krCurrencies.size === 1 ? [...krCurrencies][0] : null;
  }
  if (normalized !== "$" && !normalized.startsWith("DOLLAR")) {
    return normalizeCurrency(normalized);
  }

  const dollarCurrencies = new Set(
    facts.catalogItems.flatMap((item) => {
      if (item.price === null) return [];
      const currency = normalizeCurrency(item.currency);
      return currency && ["USD", "CAD", "AUD", "NZD"].includes(currency)
        ? [currency]
        : [];
    }),
  );
  return dollarCurrencies.size === 1 ? [...dollarCurrencies][0] : null;
}

function catalogAssertionContextBounds(
  haystack: string,
  index: number,
  assertionEnd: number,
  clause: boolean,
): { start: number; end: number } {
  let start = -1;
  for (let cursor = index - 1; cursor >= 0; cursor -= 1) {
    if (isCatalogContextBoundary(haystack, cursor, clause)) {
      start = cursor;
      break;
    }
  }
  let end = haystack.length;
  for (let cursor = assertionEnd; cursor < haystack.length; cursor += 1) {
    if (isCatalogContextBoundary(haystack, cursor, clause)) {
      end = cursor;
      break;
    }
  }
  return { start: start + 1, end };
}

function isCatalogContextBoundary(
  haystack: string,
  index: number,
  clause: boolean,
): boolean {
  const character = haystack[index];
  if (character === ".") {
    return !(
      /\d/.test(haystack[index - 1] ?? "") &&
      /\d/.test(haystack[index + 1] ?? "")
    );
  }
  if (character === "!" || character === "?" || character === "\n") {
    return true;
  }
  return clause && (character === "," || character === ";");
}

/** Stable content fingerprint used as the generation idempotency key. */
export function articleFingerprint(input: {
  siteId: string;
  batchId: string;
  topicKey: string;
}): string {
  return createHash("sha256")
    .update(`${input.siteId}:${input.batchId}:${input.topicKey}`, "utf8")
    .digest("hex")
    .slice(0, 32);
}

function hashSeed(value: string): number {
  const digest = createHash("sha256").update(value, "utf8").digest();
  return digest.readUInt32BE(0);
}

function rotate<T>(items: T[], by: number): T[] {
  if (items.length <= 1) return items;
  const offset = ((by % items.length) + items.length) % items.length;
  return [...items.slice(offset), ...items.slice(0, offset)];
}
