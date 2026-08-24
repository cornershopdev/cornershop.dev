import { getDb } from "@/lib/db";
import { integrationUrlDigest } from "@/lib/evidence-digests";
import { Vertical } from "@/generated/prisma/enums";
import { hashClaimInvitationToken } from "@/lib/claim-invitations";
import { sampleSiteDraft } from "@/lib/restaurant";
import { siteDraftScalarData } from "@/lib/site-persistence";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { e2e } from "./fixtures";

const e2eHeroUrl = `https://assets.example/first-customer/${e2e.targetSlug}/hero.jpg`;

export async function seedFirstCustomerBrowserJourney() {
  await cleanupFirstCustomerBrowserJourney();
  const db = getDb();
  const user = await db.user.create({
    data: { email: e2e.ownerEmail, name: "Browser Journey Owner" },
  });
  const organization = await db.organization.create({
    data: {
      name: "Browser Journey Existing Organization",
      memberships: { create: { userId: user.id, role: "owner" } },
      sites: {
        create: {
          id: e2e.existingId,
          slug: e2e.existingSlug,
          name: e2e.existingName,
          vertical: "RESTAURANT",
          status: "CLAIMED",
        },
      },
    },
  });
  await db.organization.create({
    data: {
      name: "Browser Journey Unauthorized Organization",
      sites: {
        create: {
          id: e2e.unauthorizedId,
          slug: e2e.unauthorizedSlug,
          name: e2e.unauthorizedName,
          vertical: "RESTAURANT",
          status: "CLAIMED",
        },
      },
    },
  });
  await db.site.create({
    data: {
      id: e2e.targetId,
      slug: e2e.targetSlug,
      name: e2e.targetName,
      eyebrow: sampleSiteDraft.eyebrow,
      description: sampleSiteDraft.description,
      address: sampleSiteDraft.address,
      phone: sampleSiteDraft.phone,
      email: e2e.ownerEmail,
      sourceUrl: "https://restaurant.example.test/menu",
      heroImageUrl: e2eHeroUrl,
      heroOriginalImageUrl: e2eHeroUrl,
      heroImageProvenance: "OWNER",
      autoEnhanceImages: sampleSiteDraft.autoEnhanceImages,
      defaultLocale: sampleSiteDraft.defaultLocale,
      translations: sampleSiteDraft.translations,
      businessHours: sampleSiteDraft.businessHours,
      draftTheme: { id: "warm" },
      draftThemeVersion: "legacy-v1",
      draftPalette: sampleSiteDraft.palette,
      attributes: sampleSiteDraft.attributes,
      vertical: "RESTAURANT",
      status: "PREVIEW_READY",
      // Non-zero so the browser cannot pass by inventing a default first-save
      // revision instead of hydrating the persisted owner DTO.
      draftRevision: 7,
      integrations: {
        create: sampleSiteDraft.integrations.map((integration, position) => ({
          type: integration.type.toUpperCase() as
            "BOOKING" | "ORDERING" | "DELIVERY" | "SOCIAL",
          label: integration.label,
          provider: integration.provider,
          url: integration.url,
          enabled: integration.enabled,
          venueId: integration.venueId,
          position,
        })),
      },
      catalogSections: {
        create: sampleSiteDraft.catalogSections.map(
          (section, sectionPosition) => ({
            name: section.name,
            description: section.description,
            position: sectionPosition,
            items: {
              create: section.items.map((item, itemPosition) => ({
                name: item.name,
                description: item.description,
                price: item.price,
                currency: item.currency,
                available: item.available,
                imageUrl: item.imageUrl,
                originalImageUrl: item.originalImageUrl,
                imageProvenance: "OWNER",
                attributes: item.attributes,
                position: itemPosition,
              })),
            },
          }),
        ),
      },
    },
  });
  // The immutable-photo publication gate requires the hero projection to
  // reference an approved PhotoAsset stored immutably, so the browser journey
  // seeds the owner hero through the same pipeline a real import uses.
  await db.photoAsset.create({
    data: {
      siteId: e2e.targetId,
      sourceUrl: `https://restaurant.example.test/hero-${e2e.targetSlug}.jpg`,
      provenance: "OWNER",
      sourceKind: "OWNER_UPLOAD",
      contentSha256: "c".repeat(64),
      originalStorageKey: `first-customer/${e2e.targetSlug}/hero.jpg`,
      originalUrl: e2eHeroUrl,
      mediaType: "image/jpeg",
      byteLength: 1_024,
      candidateUsages: ["HERO"],
      reviewStatus: "APPROVED",
      reviewedAt: new Date(),
      reviewedBy: `owner:${e2e.ownerEmail}`,
      selectedUsage: "HERO",
      activeVariant: "ORIGINAL",
    },
  });
  const foodDraft = {
    ...sampleFoodRetailDraft,
    slug: e2e.foodSlug,
    name: e2e.foodName,
    email: e2e.foodOwnerEmail,
    defaultLocale: "en",
    translations: [],
    integrations: [],
    catalogSections: [
      {
        name: "Product ranges",
        description: "No sourced products in this factory claim fixture.",
        items: [],
      },
    ],
  };
  await db.site.create({
    data: {
      id: e2e.foodId,
      slug: e2e.foodSlug,
      ...siteDraftScalarData(foodDraft, Vertical.FOOD_RETAIL),
      sourceUrl: "https://example.com/private-food-shop",
      vertical: Vertical.FOOD_RETAIL,
      status: "PREVIEW_READY",
      claimInvitations: {
        create: {
          email: e2e.foodOwnerEmail,
          tokenHash: hashClaimInvitationToken(
            e2e.foodSupersededInvitationToken,
          ),
          proofMethod: "DOMAIN_EMAIL",
          expiresAt: new Date(Date.now() + 24 * 60 * 60_000),
        },
      },
      catalogSections: {
        create: {
          name: foodDraft.catalogSections[0].name,
          description: foodDraft.catalogSections[0].description,
          position: 0,
        },
      },
    },
  });
  return { userId: user.id, organizationId: organization.id };
}

export async function cleanupFirstCustomerBrowserJourney() {
  const db = getDb();
  await db.stripeWebhookEvent.deleteMany({
    where: { eventId: { startsWith: "evt_first_customer_" } },
  });
  await db.site.deleteMany({
    where: {
      id: {
        in: [e2e.targetId, e2e.existingId, e2e.unauthorizedId, e2e.foodId],
      },
    },
  });
  await db.organization.deleteMany({
    where: {
      name: {
        in: [
          "Browser Journey Existing Organization",
          "Browser Journey Unauthorized Organization",
        ],
      },
    },
  });
  await db.user.deleteMany({ where: { email: e2e.ownerEmail } });
}

async function seedCustomerDiscoveryArticle() {
  const base = {
    siteId: e2e.targetId,
    locale: "en",
    excerpt: "Seasonal notes from the first customer test kitchen.",
    bodyMarkdown:
      "## Around the table\n\nAn article used to verify customer-owned discovery output.",
    topicKey: "seasonal-menu",
    topicTitle: "Seasonal menu",
  };
  await getDb().article.createMany({
    data: [
      {
        ...base,
        slug: e2e.discoveryArticleSlug,
        title: e2e.discoveryArticleTitle,
        status: "PUBLISHED",
        publishedAt: new Date("2026-08-23T08:00:00.000Z"),
        publishedBy: "browser-e2e",
      },
      {
        ...base,
        slug: "draft-must-stay-private",
        title: "Draft must stay private",
        status: "DRAFT",
      },
      {
        ...base,
        slug: "undated-must-stay-private",
        title: "Undated must stay private",
        status: "PUBLISHED",
        publishedAt: null,
      },
    ],
  });
}

async function activateCustomerDiscoveryDomain() {
  const db = getDb();
  await db.$transaction([
    db.domain.create({
      data: {
        hostname: e2e.customHostname,
        verificationToken: "first-customer-browser-domain-verification",
        verified: true,
        verifiedAt: new Date(),
        tlsStatus: "READY",
        tlsCheckedAt: new Date(),
        siteId: e2e.targetId,
      },
    }),
    db.site.update({
      where: { id: e2e.targetId },
      data: { status: "LIVE" },
    }),
  ]);
}

async function inspectFirstCustomerBrowserJourney() {
  const db = getDb();
  const [site, integrations] = await Promise.all([
    db.site.findUniqueOrThrow({
      where: { id: e2e.targetId },
      select: {
        draftRevision: true,
        publishedSiteVersionId: true,
        status: true,
        claimInvitations: { select: { acceptedAt: true } },
        auditEvents: {
          where: { type: { in: ["site.draft.saved", "site.published"] } },
          select: { type: true },
        },
      },
    }),
    db.integration.findMany({
      where: { siteId: e2e.targetId },
      orderBy: { position: "asc" },
      select: { type: true, url: true, enabled: true },
    }),
  ]);
  return {
    draftRevision: site.draftRevision,
    status: site.status,
    publishedSiteVersionId: site.publishedSiteVersionId,
    invitationAccepted: site.claimInvitations.some(
      ({ acceptedAt }) => acceptedAt instanceof Date,
    ),
    auditTypes: site.auditEvents.map(({ type }) => type).sort(),
    integrationDigest: integrationUrlDigest(
      integrations.map((item) => ({
        type: item.type.toLowerCase(),
        url: item.url,
        enabled: item.enabled,
      })),
    ),
  };
}

const command = process.argv[2];
try {
  if (command === "seed") {
    await seedFirstCustomerBrowserJourney();
  } else if (command === "cleanup") {
    await cleanupFirstCustomerBrowserJourney();
  } else if (command === "inspect") {
    console.log(JSON.stringify(await inspectFirstCustomerBrowserJourney()));
  } else if (command === "seed-discovery") {
    await seedCustomerDiscoveryArticle();
  } else if (command === "activate-custom-domain") {
    await activateCustomerDiscoveryDomain();
  } else {
    throw new Error(
      "Use seed, inspect, cleanup, seed-discovery, or activate-custom-domain.",
    );
  }
} finally {
  await getDb()
    .$disconnect()
    .catch(() => undefined);
}
