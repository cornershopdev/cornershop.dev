import { createHash } from "node:crypto";
import { z } from "zod";
import { availableFacts, type SiteFacts } from "@/lib/articles/site-facts";
import {
  ARTICLE_TEMPLATE_KEYS,
  ARTICLE_TOPIC_KEYS,
  articleTopicPlanByKey,
  type ArticleTemplateKey,
  type ArticleTopicPlan,
} from "@/lib/articles/topic-plans";
import { formatPrice } from "@/lib/site-draft";
import { supportedCurrencySchema } from "@/lib/verticals/schema";

export const ARTICLE_PLAN_CONTRACT_VERSION = 1 as const;
export const MAX_ARTICLES_PER_BATCH = 8;
export const ARTICLE_BODY_MIN_CHARS = 400;
export const ARTICLE_BODY_MAX_CHARS = 12_000;

/**
 * The complete model-visible article contract. It deliberately has no text,
 * catalog name, amount, currency, slug, title, excerpt, or markdown field.
 * Every value that can reach publication is resolved by the server after this
 * object has passed exact topic/template/catalog-id validation.
 */
export const generatedArticlePlanSchema = z
  .object({
    contractVersion: z.literal(ARTICLE_PLAN_CONTRACT_VERSION),
    topicKey: z.enum(ARTICLE_TOPIC_KEYS),
    templateKey: z.enum(ARTICLE_TEMPLATE_KEYS),
    catalogItemId: z.string().min(1).max(128).nullable(),
    priceMode: z.enum(["omit", "exact"]),
  })
  .strict();

export type GeneratedArticlePlan = z.infer<typeof generatedArticlePlanSchema>;

/**
 * The persistence-compatible article snapshot produced only by
 * `renderArticlePlan`. Existing Article rows and publication readers continue
 * to consume these same scalar fields.
 */
export type GeneratedArticleDraft = {
  topicKey: string;
  slug: string;
  title: string;
  excerpt: string;
  bodyMarkdown: string;
};

export type ArticlePlanRenderResult =
  | { ok: true; draft: GeneratedArticleDraft }
  | { ok: false; problems: string[] };

type CatalogItemFact = SiteFacts["catalogItems"][number];
type TemplateLanguage = "en" | "fr";
type TemplateKind = "catalog" | "location" | "contact" | "visit" | "ordering";

type LocalizedTemplateCopy = {
  title: string;
  excerpt: string;
  listing?: string;
};

type TemplateDefinition = {
  kind: TemplateKind;
  en: LocalizedTemplateCopy;
  fr: LocalizedTemplateCopy;
};

// Final public fields must remain safe even though every current value is
// repository-owned. This gate prevents future template slots from bypassing
// the plain/script boundary.
const UNSAFE_PLAIN_ARTICLE_FIELD =
  /[<\u0000-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;
const UNSAFE_ARTICLE_MARKDOWN =
  /[<\u0000-\u0009\u000b-\u001f\u007f-\u009f\u061c\u200e\u200f\u2028\u2029\u202a-\u202e\u2066-\u2069]/u;

/**
 * Repository-owned copy is the only prose source. A catalog item's exact ID
 * selects the factual row, but its name never enters any public article field.
 * Exact mode may insert only the validated canonical price in its fixed slot.
 */
const ARTICLE_TEMPLATES = {
  "restaurant-current-menu": {
    kind: "catalog",
    en: {
      title: "A current menu listing",
      excerpt:
        "This page covers one selected entry in the verified current menu",
      listing: "menu listing",
    },
    fr: {
      title: "Une référence actuelle de la carte",
      excerpt:
        "Cette page présente une référence sélectionnée de la carte actuelle vérifiée",
      listing: "carte",
    },
  },
  "restaurant-location": {
    kind: "location",
    en: { title: "How to find us", excerpt: "The currently published address" },
    fr: { title: "Comment nous trouver", excerpt: "L’adresse actuellement publiée" },
  },
  "restaurant-group-enquiry": {
    kind: "contact",
    en: { title: "Making a group enquiry", excerpt: "The published ways to get in touch" },
    fr: { title: "Faire une demande de groupe", excerpt: "Les moyens de contact publiés" },
  },
  "restaurant-dietary-enquiry": {
    kind: "catalog",
    en: {
      title: "Checking dietary details before ordering",
      excerpt:
        "A selected verified menu entry is the basis for this dietary enquiry guide",
      listing: "menu listing",
    },
    fr: {
      title: "Vérifier les informations alimentaires avant de commander",
      excerpt:
        "Une référence vérifiée de la carte sert de base à ce guide de demande alimentaire",
      listing: "carte",
    },
  },
  "restaurant-menu-facts": {
    kind: "catalog",
    en: {
      title: "What the current menu confirms",
      excerpt:
        "This page is limited to one selected entry in the verified current menu",
      listing: "menu listing",
    },
    fr: {
      title: "Ce que confirme la carte actuelle",
      excerpt:
        "Cette page se limite à une référence sélectionnée de la carte actuelle vérifiée",
      listing: "carte",
    },
  },
  "beauty-treatment-listing": {
    kind: "catalog",
    en: {
      title: "A current treatment listing",
      excerpt:
        "This page covers one selected entry in the verified current treatment list",
      listing: "treatment listing",
    },
    fr: {
      title: "Une prestation actuellement référencée",
      excerpt:
        "Cette page présente une prestation sélectionnée dans la liste actuelle vérifiée",
      listing: "liste des prestations",
    },
  },
  "beauty-aftercare-enquiry": {
    kind: "catalog",
    en: {
      title: "How to ask about aftercare",
      excerpt:
        "A selected verified treatment entry is the basis for this aftercare enquiry guide",
      listing: "treatment listing",
    },
    fr: {
      title: "Comment demander des conseils de suivi",
      excerpt:
        "Une prestation vérifiée sélectionnée sert de base à ce guide de demande de suivi",
      listing: "liste des prestations",
    },
  },
  "beauty-current-listing": {
    kind: "catalog",
    en: {
      title: "What the current service list confirms",
      excerpt:
        "This page is limited to one selected entry in the verified current service list",
      listing: "service listing",
    },
    fr: {
      title: "Ce que confirme la liste actuelle des prestations",
      excerpt:
        "Cette page se limite à une prestation sélectionnée dans la liste actuelle vérifiée",
      listing: "liste des prestations",
    },
  },
  "beauty-visit-planning": {
    kind: "visit",
    en: { title: "Planning your first visit", excerpt: "Published location and opening details" },
    fr: { title: "Préparer votre première visite", excerpt: "Adresse et horaires publiés" },
  },
  "service-current-listing": {
    kind: "catalog",
    en: {
      title: "A current service listing",
      excerpt:
        "This page covers one selected entry in the verified current service list",
      listing: "service listing",
    },
    fr: {
      title: "Une prestation actuellement référencée",
      excerpt:
        "Cette page présente une prestation sélectionnée dans la liste actuelle vérifiée",
      listing: "liste des prestations",
    },
  },
  "service-location": {
    kind: "location",
    en: { title: "Where the business is based", excerpt: "The currently published business address" },
    fr: { title: "Où se trouve l’entreprise", excerpt: "L’adresse professionnelle actuellement publiée" },
  },
  "service-quote-enquiry": {
    kind: "contact",
    en: { title: "How to make a quote enquiry", excerpt: "The published ways to contact the business" },
    fr: { title: "Comment demander un devis", excerpt: "Les moyens publiés pour contacter l’entreprise" },
  },
  "retail-listing-facts": {
    kind: "catalog",
    en: {
      title: "What the current listing confirms",
      excerpt:
        "This page is limited to one selected entry in the verified current shop catalog",
      listing: "shop listing",
    },
    fr: {
      title: "Ce que confirme la référence actuelle",
      excerpt:
        "Cette page se limite à une référence sélectionnée du catalogue actuel vérifié de la boutique",
      listing: "catalogue de la boutique",
    },
  },
  "retail-current-stock": {
    kind: "catalog",
    en: {
      title: "A current shop listing",
      excerpt:
        "This page covers one selected entry in the verified current shop catalog",
      listing: "shop listing",
    },
    fr: {
      title: "Une référence actuelle de la boutique",
      excerpt:
        "Cette page présente une référence sélectionnée du catalogue actuel vérifié de la boutique",
      listing: "catalogue de la boutique",
    },
  },
  "retail-ordering-options": {
    kind: "ordering",
    en: { title: "Ways to shop with us", excerpt: "The ordering options currently published on the site" },
    fr: { title: "Les moyens d’acheter chez nous", excerpt: "Les options de commande actuellement publiées sur le site" },
  },
} satisfies Record<ArticleTemplateKey, TemplateDefinition>;

/**
 * Deterministically picks which topics a batch may fill.
 *
 * Selection is round-robin over the vertical's topic plans filtered to those
 * whose required facts the site actually carries, seeded by the site id so
 * two sites with identical data do not get identical topic orders. Topics
 * covered by either of the site's last two batches are pushed to the back of
 * the queue instead of removed outright.
 */
export function selectBatchTopics(input: {
  facts: SiteFacts;
  plans: Array<{
    key: string;
    requiredFacts: string[];
    requiredAnyIntegrationCapabilities?: SiteFacts["integrationCapabilities"];
  }>;
  count: number;
  recentTopicKeys: string[];
}): Array<{ key: string }> {
  const available = availableFacts(input.facts);
  const capabilities = new Set(input.facts.integrationCapabilities);
  const eligible = input.plans.filter(
    (plan) =>
      plan.requiredFacts.every((fact) => available.has(fact as never)) &&
      (!plan.requiredAnyIntegrationCapabilities?.length ||
        plan.requiredAnyIntegrationCapabilities.some((capability) =>
          capabilities.has(capability),
        )),
  );
  if (!eligible.length) return [];

  const recent = new Set(input.recentTopicKeys);
  const seed = hashSeed(input.facts.slug);
  const rotated = rotate(eligible, seed % eligible.length);
  const fresh = rotated.filter((plan) => !recent.has(plan.key));
  const stale = rotated.filter((plan) => recent.has(plan.key));

  return [...fresh, ...stale]
    .slice(0, Math.max(1, Math.min(input.count, MAX_ARTICLES_PER_BATCH)))
    .map((plan) => ({ key: plan.key }));
}

/** Returns deterministic, human-readable reasons an untrusted plan cannot render. */
export function checkArticlePlan(plan: unknown, facts: SiteFacts): string[] {
  const validated = validateArticlePlan(plan, facts);
  return validated.ok ? [] : validated.problems;
}

/**
 * Validates an untrusted model plan completely before rendering any public
 * text. The function is pure: it never repairs IDs, normalizes identifiers, or
 * mutates the supplied factual snapshot.
 */
export function renderArticlePlan(
  plan: unknown,
  facts: SiteFacts,
): ArticlePlanRenderResult {
  const validated = validateArticlePlan(plan, facts);
  if (!validated.ok) return validated;

  const language = articleLanguage(facts.locale);
  const definition = ARTICLE_TEMPLATES[validated.plan.templateKey];
  const copy = definition[language];
  const draft = renderTemplate({
    plan: validated.plan,
    topic: validated.topic,
    item: validated.item,
    facts,
    language,
    definition,
    copy,
  });
  const problems = checkRenderedArticleDraft(draft);
  return problems.length ? { ok: false, problems } : { ok: true, draft };
}

type ValidatedPlan = {
  ok: true;
  plan: GeneratedArticlePlan;
  topic: ArticleTopicPlan;
  item: CatalogItemFact | null;
};

type InvalidPlan = { ok: false; problems: string[] };

function validateArticlePlan(plan: unknown, facts: SiteFacts): ValidatedPlan | InvalidPlan {
  const parsed = generatedArticlePlanSchema.safeParse(plan);
  if (!parsed.success) {
    return { ok: false, problems: ["article plan does not match the strict schema"] };
  }

  const value = parsed.data;
  const problems: string[] = [];
  const topic = articleTopicPlanByKey(facts.vertical, value.topicKey);
  if (!topic) {
    return {
      ok: false,
      problems: [`topic is not available for vertical: "${value.topicKey}"`],
    };
  }
  if (topic.templateKey !== value.templateKey) {
    problems.push(`template is not allowed for topic: "${value.templateKey}"`);
  }

  const available = availableFacts(facts);
  for (const required of topic.requiredFacts) {
    if (!available.has(required)) problems.push(`required fact is unavailable: "${required}"`);
  }
  if (
    topic.requiredAnyIntegrationCapabilities?.length &&
    !topic.requiredAnyIntegrationCapabilities.some((capability) =>
      facts.integrationCapabilities.includes(capability),
    )
  ) {
    problems.push("required enabled integration capability is unavailable");
  }

  let item: CatalogItemFact | null = null;
  if (topic.catalogItem === "required") {
    if (value.catalogItemId === null) {
      problems.push("catalog-dependent topic requires a catalog item id");
    } else {
      const matches = facts.catalogItems.filter(
        (candidate) => candidate.id === value.catalogItemId,
      );
      if (matches.length === 0) {
        problems.push(`unknown catalog item id: "${value.catalogItemId}"`);
      } else if (matches.length > 1) {
        problems.push(`catalog item id is ambiguous: "${value.catalogItemId}"`);
      } else {
        item = matches[0] ?? null;
      }
    }
  } else {
    if (value.catalogItemId !== null) {
      problems.push("non-catalog topic must not select a catalog item");
    }
    if (value.priceMode !== "omit") {
      problems.push("non-catalog topic must omit catalog prices");
    }
  }

  if (item) {
    if (value.priceMode === "exact") {
      if (item.price === null) {
        problems.push("exact price mode requires a canonical catalog price");
      } else if (
        !Number.isFinite(item.price) ||
        item.price < 0 ||
        item.price > 99_999_999.99
      ) {
        problems.push("selected catalog item has an invalid canonical price");
      }
      if (!supportedCurrencySchema.safeParse(item.currency).success) {
        problems.push("exact price mode requires a supported canonical currency");
      }
    }
  }

  if (problems.length) return { ok: false, problems: [...new Set(problems)] };
  return { ok: true, plan: value, topic, item };
}

function renderTemplate(input: {
  plan: GeneratedArticlePlan;
  topic: ArticleTopicPlan;
  item: CatalogItemFact | null;
  facts: SiteFacts;
  language: TemplateLanguage;
  definition: TemplateDefinition;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const { definition } = input;
  if (definition.kind === "catalog") return renderCatalogTemplate(input);
  if (definition.kind === "location") return renderLocationTemplate(input);
  if (definition.kind === "contact") return renderContactTemplate(input);
  if (definition.kind === "visit") return renderVisitTemplate(input);
  return renderOrderingTemplate(input);
}

function renderCatalogTemplate(input: {
  plan: GeneratedArticlePlan;
  item: CatalogItemFact | null;
  facts: SiteFacts;
  language: TemplateLanguage;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const item = input.item;
  if (!item) throw new Error("validated catalog plan has no selected item");
  const listing = input.copy.listing ?? "catalog listing";

  if (input.plan.priceMode === "exact") {
    if (item.price === null) {
      throw new Error("validated exact-price plan has no canonical price");
    }
    const formattedPrice = formatPrice(
      item.price,
      item.currency,
      input.language,
    );
    return {
      topicKey: input.plan.topicKey,
      slug: input.plan.topicKey,
      title:
        input.language === "fr"
          ? `${input.copy.title} : prix vérifié`
          : `${input.copy.title}: verified price`,
      excerpt:
        input.language === "fr"
          ? `${input.copy.excerpt}. Le prix exact vérifié figure dans l’article.`
          : `${input.copy.excerpt}. The exact verified price appears in the article.`,
      bodyMarkdown: catalogBody({
        language: input.language,
        listing,
        formattedPrice,
      }),
    };
  }

  return {
    topicKey: input.plan.topicKey,
    slug: input.plan.topicKey,
    title: input.copy.title,
    excerpt: `${input.copy.excerpt}.`,
    bodyMarkdown: catalogBody({
      language: input.language,
      listing,
      formattedPrice: null,
    }),
  };
}

function catalogBody(input: {
  language: TemplateLanguage;
  listing: string;
  formattedPrice: string | null;
}): string {
  if (input.language === "fr") {
    const price = input.formattedPrice
      ? ` Le prix exact vérifié pour cette référence est ${input.formattedPrice}.`
      : "";
    return `## Ce que confirme cette page

Cette page s’appuie sur la ${input.listing} vérifiée de l’établissement. La référence sélectionnée appartient à cette liste.${price} Aucun ingrédient, disponibilité, origine, résultat, niveau de popularité, compatibilité, distinction ou autre détail n’est supposé au-delà des informations publiées.

## Vérifier les informations actuelles

Les informations du catalogue peuvent évoluer après la création d’un brouillon. Avant de commander, de réserver, de vous déplacer ou de compter sur une option précise, utilisez les moyens de contact ou de commande publiés ailleurs sur le site pour confirmer sa disponibilité et tout détail important pour votre visite ou votre achat. Cette page reste volontairement limitée aux informations publiées pour la référence sélectionnée.`;
  }

  const price = input.formattedPrice
    ? ` The exact verified price for this listing is ${input.formattedPrice}.`
    : "";
  return `## What this page confirms

This page uses the business's verified ${input.listing}. The selected entry belongs to that listing.${price} No ingredients, availability, origin, results, popularity, suitability, awards, or other details are assumed beyond what the published listing states.

## Checking current details

Catalog information can change after a draft is created. Before ordering, booking, travelling, or relying on a particular option, use the contact or ordering routes published elsewhere on the site to confirm current availability and any detail that matters to your visit or purchase. This page deliberately stays within the published details for the selected listing.`;
}

function renderLocationTemplate(input: {
  plan: GeneratedArticlePlan;
  language: TemplateLanguage;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const body =
    input.language === "fr"
      ? `## Utiliser les informations de localisation publiées

Le site présente déjà l’adresse de l’établissement dans ses informations vérifiées. Consultez ce champ publié pour préparer votre déplacement. Cette page ne transforme pas une adresse en affirmation sur une zone desservie, un point de repère voisin, une durée de trajet, le stationnement, l’accessibilité ou un autre détail géographique absent des données structurées.

## Préparer le déplacement

Consultez les informations publiées juste avant votre départ et utilisez un service d’itinéraire adapté à votre point de départ. Si un détail de l’accès est important pour votre visite, confirmez-le directement par les moyens de contact présents ailleurs sur le site. Cette page reste volontairement générale et n’ajoute aucun nom, prix, lieu ou service non publié.`
      : `## Using the published location details

The site already presents the business address in its verified details. Use that published field when planning a journey. This page does not turn an address into a claim about a service area, nearby landmark, journey time, parking, accessibility, or any other location detail that has not been published.

## Planning the journey

Check the published information shortly before travelling and use a route service appropriate to your starting point. If a particular access detail matters to your visit, confirm it directly through the contact routes elsewhere on the site. This page stays deliberately general and adds no unpublished business name, product, price, place, or service claim.`;
  return {
    topicKey: input.plan.topicKey,
    slug: input.plan.topicKey,
    title: input.copy.title,
    excerpt: `${input.copy.excerpt}.`,
    bodyMarkdown: body,
  };
}

function renderContactTemplate(input: {
  plan: GeneratedArticlePlan;
  language: TemplateLanguage;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const body =
    input.language === "fr"
      ? `## Moyens de contact publiés

Le site présente déjà ses moyens de contact et de demande dans les informations vérifiées de l’établissement. Utilisez ces champs publiés pour transmettre votre question. Leur présence ne promet ni disponibilité, ni capacité, ni délai, ni devis, ni réservation confirmée, et cette page n’ajoute aucun nom ou tarif absent des informations publiées.

## Formuler votre demande

Indiquez directement à l’établissement ce que vous souhaitez organiser ou vérifier, puis attendez sa confirmation avant de prendre un engagement. Les modalités peuvent dépendre de la date et du besoin précis. Consultez les coordonnées affichées ailleurs sur le site : seules les informations publiées doivent guider votre demande, sans supposer de condition de service supplémentaire.`
      : `## Published contact routes

The site already presents its contact and enquiry routes in the business's verified details. Use those published fields when sending a question. Their presence does not promise availability, capacity, timing, a quote, or a confirmed booking, and this page adds no name or price absent from the published information.

## Making the enquiry

Tell the business directly what you want to arrange or verify, then wait for its confirmation before making a commitment. Details may depend on the date and the specific request. Consult the contact values shown elsewhere on the site and rely only on the details the business publishes for your enquiry.`;
  return {
    topicKey: input.plan.topicKey,
    slug: input.plan.topicKey,
    title: input.copy.title,
    excerpt: `${input.copy.excerpt}.`,
    bodyMarkdown: body,
  };
}

function renderVisitTemplate(input: {
  plan: GeneratedArticlePlan;
  language: TemplateLanguage;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const body =
    input.language === "fr"
      ? `## Informations publiées pour la visite

Le site présente déjà l’adresse et les horaires dans les informations vérifiées de l’établissement. Consultez ces champs pour préparer votre visite. Leur présence ne décrit pas le déroulement d’un rendez-vous, le temps d’attente, la disponibilité d’une prestation, un résultat attendu ou les besoins individuels.

## Confirmer avant de venir

Les horaires et modalités peuvent évoluer. Consultez les informations publiées ailleurs sur le site juste avant votre déplacement et contactez directement l’établissement si une contrainte est importante. Cette page s’en tient aux indications générales et n’ajoute ni coordonnées, ni prestation, ni tarif, ni supposition non publiés.`
      : `## Published visit details

The site already presents the address and opening details in the business's verified information. Consult those fields when planning a visit. Their presence does not describe how an appointment runs, waiting time, service availability, an expected result, or individual requirements.

## Confirming before arrival

Hours and arrangements can change. Check the information published elsewhere on the site shortly before travelling and contact the business directly if a particular constraint matters. This page stays with general guidance and adds no unpublished address, service, price, or assumption.`;
  return {
    topicKey: input.plan.topicKey,
    slug: input.plan.topicKey,
    title: input.copy.title,
    excerpt: `${input.copy.excerpt}.`,
    bodyMarkdown: body,
  };
}

function renderOrderingTemplate(input: {
  plan: GeneratedArticlePlan;
  language: TemplateLanguage;
  copy: LocalizedTemplateCopy;
}): GeneratedArticleDraft {
  const body =
    input.language === "fr"
      ? `## Options publiées

Le site affiche déjà ses options de commande dans les informations vérifiées de l’établissement. Consultez ces champs publiés pour choisir la voie adaptée. Cette page ne copie pas leurs libellés et ne déduit ni stock disponible, ni prix, ni délai, ni zone de livraison, ni condition de retrait, ni confirmation de commande.

## Avant de commander

Ouvrez l’option publiée ailleurs sur le site qui correspond à votre besoin et vérifiez les informations qu’elle présente au moment de votre demande. Les disponibilités et modalités peuvent changer. Si un détail est essentiel, confirmez-le directement auprès de l’établissement. Cette page n’ajoute aucun produit, tarif ou fonctionnement non publié.`
      : `## Published options

The site already shows its ordering options in the business's verified information. Consult those published fields to choose the appropriate route. This page does not copy their labels or infer available stock, prices, timing, delivery areas, collection conditions, or a confirmed order.

## Before ordering

Open the option published elsewhere on the site that fits your need and check the information it presents when making the request. Availability and arrangements can change. If a detail is essential, confirm it directly with the business. This page adds no unpublished product, price, label, or operating detail.`;
  return {
    topicKey: input.plan.topicKey,
    slug: input.plan.topicKey,
    title: input.copy.title,
    excerpt: `${input.copy.excerpt}.`,
    bodyMarkdown: body,
  };
}

/** Checks only deterministic rendered-shape invariants, never prose meaning. */
export function checkRenderedArticleDraft(draft: GeneratedArticleDraft): string[] {
  const problems: string[] = [];
  if (draft.bodyMarkdown.length > ARTICLE_BODY_MAX_CHARS) {
    problems.push("body exceeds length budget");
  }
  if (draft.bodyMarkdown.length < ARTICLE_BODY_MIN_CHARS) {
    problems.push("body implausibly short");
  }
  const slug = draft.slug.trim();
  if (!/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(slug)) {
    problems.push(`slug is not a URL-safe kebab-case label: "${slug}"`);
  }
  if (!draft.title.trim() || !draft.excerpt.trim()) {
    problems.push("title and excerpt are required");
  }
  if (
    UNSAFE_PLAIN_ARTICLE_FIELD.test(draft.title) ||
    UNSAFE_PLAIN_ARTICLE_FIELD.test(draft.excerpt)
  ) {
    problems.push("title or excerpt contains unsafe plain-text characters");
  }
  if (UNSAFE_ARTICLE_MARKDOWN.test(draft.bodyMarkdown)) {
    problems.push("body contains unsafe markdown characters");
  }
  return [...new Set(problems)];
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

function articleLanguage(locale: string): TemplateLanguage {
  return locale.toLowerCase().split("-")[0] === "fr" ? "fr" : "en";
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
