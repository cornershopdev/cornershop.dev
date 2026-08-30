import { randomUUID } from "node:crypto";
import {
  afterAll,
  beforeAll,
  describe,
  expect,
  mock,
  test,
} from "bun:test";
import type Stripe from "stripe";

mock.module("server-only", () => ({}));
mock.module("next/cache", () => ({
  revalidateTag: () => undefined,
  revalidatePath: () => undefined,
  updateTag: () => undefined,
  refresh: () => undefined,
  unstable_cache: <T extends (...args: never[]) => unknown>(callback: T): T =>
    callback,
  unstable_noStore: () => undefined,
  cacheLife: () => undefined,
  cacheTag: () => undefined,
  unstable_cacheLife: () => undefined,
  unstable_cacheTag: () => undefined,
}));

const providerSend = mock(async () => ({
  data: { id: "resend_first_customer_test" },
  error: null,
  headers: null,
}));
const enabled = process.env.FIRST_CUSTOMER_FLOW_POSTGRES_TEST === "1";
const suffix = randomUUID();
const siteId = `first-customer-site-${suffix}`;
const slug = `first-customer-${suffix}`;
const ownerEmail = `owner-${suffix}@restaurant.example.test`;
const firstCustomerHeroSourceUrl = `https://restaurant.example.test/hero-${suffix}.jpg`;
const firstCustomerHeroUrl = `https://assets.example/first-customer/${suffix}/hero.jpg`;
const eventId = `evt_first_customer_${suffix}`;
const checkoutSessionId = `cs_test_${suffix}`;
const selectionSessionId = `session_select_${suffix}`;
const siteSessionId = `session_site_${suffix}`;

let db: ReturnType<typeof import("@/lib/db").getDb>;
let invitationToken = "";
let invitationId = "";
let organizationId = "";
let userId = "";

describe.skipIf(!enabled)(
  "safe-double first-customer PostgreSQL journey",
  () => {
    beforeAll(async () => {
      process.env.DATABASE_URL ||= "postgresql://unused.invalid/cornershopdev";
      process.env.NEXT_PUBLIC_APP_URL = "http://127.0.0.1:3000";
      process.env.STRIPE_PRICE_ID = "price_founding_test";
      process.env.STRIPE_SECRET_KEY = "sk_test_first_customer";
      process.env.CLAIM_TOKEN_SECRET =
        "first-customer-test-only-secret-at-least-32-characters";
      process.env.BETTER_AUTH_SECRET =
        "first-customer-test-only-auth-secret-at-least-32-characters";

      const database = await import("@/lib/db");
      const { sampleSiteDraft } = await import("@/lib/restaurant");
      db = database.getDb();
      await db.site.create({
        data: {
          id: siteId,
          slug,
          name: sampleSiteDraft.name,
          eyebrow: sampleSiteDraft.eyebrow,
          description: sampleSiteDraft.description,
          address: sampleSiteDraft.address,
          phone: sampleSiteDraft.phone,
          email: ownerEmail,
          sourceUrl: "https://restaurant.example.test/menu",
          heroImageUrl: firstCustomerHeroUrl,
          heroOriginalImageUrl: firstCustomerHeroUrl,
          heroImageProvenance: "OWNER",
          draftTheme: { id: "warm" },
          draftThemeVersion: "legacy-v1",
          draftPalette: sampleSiteDraft.palette,
          attributes: sampleSiteDraft.attributes,
          autoEnhanceImages: sampleSiteDraft.autoEnhanceImages,
          defaultLocale: sampleSiteDraft.defaultLocale,
          translations: sampleSiteDraft.translations,
          businessHours: sampleSiteDraft.businessHours,
          vertical: "RESTAURANT",
          status: "PREVIEW_READY",
          integrations: {
            create: sampleSiteDraft.integrations.map(
              (integration, position) => ({
                type: integration.type.toUpperCase() as
                  | "BOOKING"
                  | "ORDERING"
                  | "DELIVERY"
                  | "SOCIAL",
                label: integration.label,
                provider: integration.provider,
                url: integration.url,
                enabled: integration.enabled,
                venueId: integration.venueId,
                position,
              }),
            ),
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
      // reference an approved PhotoAsset stored immutably, so the journey
      // seeds the owner hero through the same pipeline a real import uses.
      await db.photoAsset.create({
        data: {
          siteId,
          sourceUrl: firstCustomerHeroSourceUrl,
          provenance: "OWNER",
          sourceKind: "OWNER_UPLOAD",
          contentSha256: "b".repeat(64),
          originalStorageKey: `first-customer/${suffix}/hero.jpg`,
          originalUrl: firstCustomerHeroUrl,
          mediaType: "image/jpeg",
          byteLength: 1_024,
          candidateUsages: ["HERO"],
          reviewStatus: "APPROVED",
          reviewedAt: new Date(),
          reviewedBy: `owner:${ownerEmail}`,
          selectedUsage: "HERO",
          activeVariant: "ORIGINAL",
        },
      });
    });

    afterAll(async () => {
      if (!db) return;
      await db.stripeWebhookEvent.deleteMany({ where: { eventId } });
      await db.site.deleteMany({ where: { id: siteId } });
      if (organizationId) {
        await db.organization.deleteMany({ where: { id: organizationId } });
      }
      if (userId) await db.user.deleteMany({ where: { id: userId } });
    });

    test("rejects evidence-less operator approvals written by the predecessor binary", async () => {
      const missingEvidenceId = `legacy-missing-${suffix}`;
      const acceptedLegacyId = `legacy-accepted-${suffix}`;
      const validApprovalId = `operator-valid-${suffix}`;

      expect(
        await db.$queryRaw<
          Array<{
            constraintName: string;
            constraintType: string;
            validated: boolean;
            definition: string;
          }>
        >`
          SELECT
            conname AS "constraintName",
            contype::text AS "constraintType",
            convalidated AS "validated",
            pg_get_constraintdef(oid) AS "definition"
          FROM pg_constraint
          WHERE conname = 'ClaimInvitation_operator_approval_evidence_check'
            AND conrelid = '"ClaimInvitation"'::regclass
        `,
      ).toEqual([
        {
          constraintName: "ClaimInvitation_operator_approval_evidence_check",
          constraintType: "c",
          validated: true,
          definition: expect.stringContaining('"approvalEvidenceRef"'),
        },
      ]);
      const constraintDefinition = (
        await db.$queryRaw<Array<{ definition: string }>>`
          SELECT pg_get_constraintdef(oid) AS "definition"
          FROM pg_constraint
          WHERE conname = 'ClaimInvitation_operator_approval_evidence_check'
            AND conrelid = '"ClaimInvitation"'::regclass
        `
      )[0]!.definition;
      for (const requiredColumn of [
        '"proofMethod"',
        '"acceptedAt"',
        '"revokedAt"',
        '"approvalEvidenceRef"',
        '"approvedBy"',
        '"approvedAt"',
      ]) {
        expect(constraintDefinition).toContain(requiredColumn);
      }

      const rejectedOldBinaryInsert = await db.$executeRaw`
          INSERT INTO "ClaimInvitation" (
            "id", "email", "tokenHash", "proofMethod", "expiresAt", "siteId"
          ) VALUES (
            ${missingEvidenceId}, ${ownerEmail}, ${`token-${missingEvidenceId}`},
            'OPERATOR_APPROVAL', ${new Date(Date.now() + 60_000)}, ${siteId}
          )
        `.then(
          () => null,
          (error: unknown) => error,
        );
      expect(rejectedOldBinaryInsert).toMatchObject({ code: "P2010" });

      await db.$executeRaw`
        INSERT INTO "ClaimInvitation" (
          "id", "email", "tokenHash", "proofMethod", "expiresAt", "acceptedAt", "siteId"
        ) VALUES (
          ${acceptedLegacyId}, ${ownerEmail}, ${`token-${acceptedLegacyId}`},
          'OPERATOR_APPROVAL', ${new Date(Date.now() + 60_000)}, CURRENT_TIMESTAMP, ${siteId}
        )
      `;
      await db.claimInvitation.delete({ where: { id: acceptedLegacyId } });

      await db.$executeRaw`
        INSERT INTO "ClaimInvitation" (
          "id", "email", "tokenHash", "proofMethod", "approvalEvidenceRef",
          "approvedBy", "approvedAt", "expiresAt", "siteId"
        ) VALUES (
          ${validApprovalId}, ${ownerEmail}, ${`token-${validApprovalId}`},
          'OPERATOR_APPROVAL', 'private-crm:fixture-owner-consent',
          'operator:postgres-regression', CURRENT_TIMESTAMP,
          ${new Date(Date.now() + 60_000)}, ${siteId}
        )
      `;
      await db.claimInvitation.delete({ where: { id: validApprovalId } });
    });

    test("delivers one-time claim, provisions by paid webhook, rotates workspace access, saves privately, publishes atomically, and routes the exact live version", async () => {
      const claim = await import("@/lib/claim-invitations");
      const { processStripeWebhookEvent } = await import(
        "@/lib/stripe-webhook"
      );
      const { recordResendClaimEvent } = await import(
        "@/lib/claim-delivery-event-recorder"
      );
      const { sampleSiteDraft } = await import("@/lib/restaurant");
      const { updateSiteDraft } = await import("@/lib/site-persistence");
      const { publishSiteDraft } = await import("@/lib/site-publication");
      const { findPublishedSiteView, findSiteView } = await import(
        "@/lib/sites"
      );
      const { decideCustomerHostRoute } = await import("@/lib/domain-routing");
      const { evidenceDigest, integrationUrlDigest } = await import(
        "@/lib/evidence-digests"
      );
      const { persistWorkspaceRotation } = await import(
        "@/lib/workspace-auth-plugin"
      );
      const { revokeCurrentSessionAtomically } = await import(
        "@/lib/auth-sessions"
      );
      const { recordResendAuthEvent } = await import(
        "@/lib/auth-delivery-event-recorder"
      );
      const { markMagicLinkConsumed } = await import(
        "@/lib/magic-link-consumption"
      );
      const { hashAuthToken } = await import("@/lib/session");

      const issued = await claim.issueClaimInvitation({
        siteSlug: slug,
        email: ownerEmail,
        proofMethod: "DOMAIN_EMAIL",
        actor: "claimant:self-serve",
      });
      invitationId = issued.id;
      invitationToken = issued.token;
      await claim.deliverClaimInvitation(issued, "http://127.0.0.1:3000", {
        send: providerSend,
      });
      expect(providerSend).toHaveBeenCalledTimes(1);
      expect(providerSend).toHaveBeenCalledWith(
        expect.objectContaining({
          tags: expect.arrayContaining([
            { name: "category", value: "claim_invitation" },
            { name: "claim_invitation_id", value: invitationId },
          ]),
        }),
        expect.objectContaining({
          headers: {
            "Idempotency-Key": `claim-invitation-${invitationId}`,
          },
        }),
      );
      expect(
        await recordResendClaimEvent({
          eventId: `resend-delivered-${suffix}`,
          eventType: "email.delivered",
          occurredAt: new Date(),
          providerMessageId: "resend_first_customer_test",
          taggedClaimInvitationId: invitationId,
        }),
      ).toEqual({ handled: true, updated: 1 });
      const deliveredInvitation =
        await db.claimInvitation.findUniqueOrThrow({
          where: { id: invitationId },
          include: { providerEvents: true },
        });
      expect(JSON.stringify(deliveredInvitation)).not.toContain(
        invitationToken,
      );
      expect(deliveredInvitation).toMatchObject({
        deliveryStatus: "DELIVERED",
        deliveryAttempts: 1,
        providerMessageId: "resend_first_customer_test",
        deliveredAt: expect.any(Date),
      });
      expect(deliveredInvitation.providerEvents).toEqual([
        expect.objectContaining({
          eventType: "email.delivered",
          deliveryStatus: "DELIVERED",
          providerMessageId: "resend_first_customer_test",
        }),
      ]);

      const authorized = await claim.authorizeClaimInvitationForCheckout({
        siteSlug: slug,
        token: invitationToken,
      });
      await claim.bindClaimInvitationToCheckout({
        invitation: authorized,
        stripeCheckoutSessionId: checkoutSessionId,
        stripePriceId: "price_founding_test",
        checkoutAttempt: 1,
        checkoutReturnTokenHash: evidenceDigest("test-return-token"),
        checkoutReturnExpiresAt: new Date(Date.now() + 30 * 60_000),
      });

      // A browser return is intentionally absent. Only the paid, signed-provider
      // boundary below is allowed to create ownership and billing records.
      const subscription = subscriptionFixture();
      const stripe = {
        checkout: {
          sessions: { retrieve: async () => checkoutFixture(subscription) },
        },
        subscriptions: { retrieve: async () => subscription },
      } as unknown as Stripe;
      const webhookEvent = checkoutEvent();
      expect(
        await processStripeWebhookEvent(webhookEvent, stripe, db),
      ).toBe("processed");
      expect(
        await processStripeWebhookEvent(webhookEvent, stripe, db),
      ).toBe("duplicate");

      const claimed = await db.site.findUniqueOrThrow({
        where: { id: siteId },
        include: {
          organization: { include: { memberships: true } },
          subscription: true,
        },
      });
      organizationId = claimed.organizationId!;
      userId = claimed.organization!.memberships[0]!.userId;
      expect(claimed).toMatchObject({
        status: "CLAIMED",
        subscription: {
          status: "ACTIVE",
          stripePriceId: "price_founding_test",
        },
      });
      expect(claimed.organization?.memberships).toHaveLength(1);
      expect(claimed.organization?.memberships[0]?.role).toBe("owner");
      await expect(
        claim.authorizeClaimInvitationForCheckout({
          siteSlug: slug,
          token: invitationToken,
        }),
      ).rejects.toMatchObject({
        code: "invitation_used",
        invitationId,
      });

      const magicLinkToken = `magic-link-${suffix}`;
      await db.user.update({
        where: { id: userId },
        data: { authLinkSequence: 1, authLinkActiveGeneration: 1 },
      });
      const magicLink = await db.authMagicLink.create({
        data: {
          tokenHash: hashAuthToken(magicLinkToken),
          destination: "WORKSPACE",
          brandVertical: "RESTAURANT",
          deliveryStatus: "SENT",
          deliveryAttempts: 1,
          providerMessageId: `resend-auth-${suffix}`,
          rotationGeneration: 1,
          expiresAt: new Date(Date.now() + 20 * 60_000),
          userId,
        },
      });
      expect(
        await recordResendAuthEvent({
          eventId: `resend-auth-delivered-${suffix}`,
          eventType: "email.delivered",
          occurredAt: new Date(),
          providerMessageId: `resend-auth-${suffix}`,
          taggedAuthMagicLinkId: magicLink.id,
        }),
      ).toEqual({ handled: true, updated: 1 });
      await markMagicLinkConsumed(magicLinkToken);
      expect(
        await db.authMagicLink.findUniqueOrThrow({
          where: { id: magicLink.id },
          include: { providerEvents: true },
        }),
      ).toMatchObject({
        deliveryStatus: "DELIVERED",
        deliveredAt: expect.any(Date),
        consumedAt: expect.any(Date),
        providerEvents: [
          expect.objectContaining({
            eventType: "email.delivered",
            deliveryStatus: "DELIVERED",
          }),
        ],
      });

      const sessionExpiresAt = new Date(Date.now() + 30 * 24 * 60 * 60_000);
      await db.session.createMany({
        data: [
          {
            id: selectionSessionId,
            token: `selection-token-${suffix}`,
            purpose: "WORKSPACE_SELECTION",
            expiresAt: sessionExpiresAt,
            userId,
          },
          {
            id: siteSessionId,
            token: `site-token-${suffix}`,
            purpose: "SITE",
            expiresAt: sessionExpiresAt,
            userId,
            organizationId,
            siteId,
          },
        ],
      });
      await db.$transaction(async (tx) => {
        await persistWorkspaceRotation(
          {
            currentSessionId: selectionSessionId,
            currentSessionToken: `selection-token-${suffix}`,
            createdSessionId: siteSessionId,
            siteId,
            organizationId,
            userId,
          },
          tx,
        );
      });
      expect(
        await db.session.findUnique({ where: { id: selectionSessionId } }),
      ).toBeNull();
      expect(
        await db.session.findUnique({ where: { id: siteSessionId } }),
      ).toMatchObject({
        purpose: "SITE",
        siteId,
        organizationId,
        userId,
      });
      expect(
        await db.authEvent.findFirst({
          where: { type: "auth.session.rotated", sessionId: siteSessionId },
        }),
      ).toMatchObject({
        subjectUserId: userId,
        siteId,
        metadata: expect.objectContaining({
          previousSessionId: selectionSessionId,
          currentSessionId: siteSessionId,
        }),
      });

      await db.domain.create({
        data: {
          hostname: `${slug}.example.test`,
          verificationToken: randomUUID(),
          verified: true,
          verifiedAt: new Date(),
          tlsStatus: "READY",
          tlsCheckedAt: new Date(),
          siteId,
        },
      });
      const editedDraft = {
        ...sampleSiteDraft,
        slug,
        name: "Private first-customer edit",
        heroImageUrl: firstCustomerHeroUrl,
        heroOriginalImageUrl: firstCustomerHeroUrl,
        heroImageProvenance: "owner" as const,
      };
      const originalIntegrationDigest = integrationUrlDigest(
        sampleSiteDraft.integrations,
      );
      const saved = await updateSiteDraft(slug, editedDraft, "RESTAURANT", {
        actor: { id: userId, email: ownerEmail },
      });
      expect((await findSiteView(slug))?.draft.name).toBe(
        "Private first-customer edit",
      );
      expect(await findPublishedSiteView(slug)).toBeNull();

      const published = await publishSiteDraft({
        siteId,
        slug,
        vertical: "RESTAURANT",
        actor: { id: userId, email: ownerEmail },
        changeSummary: "First-customer test-mode publication",
        expectedRevision: saved.revision,
      });
      const live = await findPublishedSiteView(slug);
      expect(live?.draft.name).toBe("Private first-customer edit");
      expect(integrationUrlDigest(live!.draft.integrations)).toBe(
        originalIntegrationDigest,
      );
      const domain = await db.domain.findUniqueOrThrow({
        where: { hostname: `${slug}.example.test` },
        include: {
          site: {
            include: { publishedSiteVersion: true },
          },
        },
      });
      expect(
        decideCustomerHostRoute({
          hostname: domain.hostname,
          pathname: "/",
          records: [domain],
        }),
      ).toEqual({
        kind: "page",
        slug,
        versionId: published.id,
        locale: null,
      });

      await revokeCurrentSessionAtomically({
        id: siteSessionId,
        token: `site-token-${suffix}`,
        userId,
        purpose: "SITE",
        organizationId,
        siteId,
        siteSlug: slug,
        expiresAt: sessionExpiresAt,
      });
      expect(
        await db.session.findUnique({ where: { id: siteSessionId } }),
      ).toBeNull();
      expect(
        await db.authEvent.findFirst({
          where: { type: "auth.session.revoked", sessionId: siteSessionId },
        }),
      ).toMatchObject({ subjectUserId: userId, siteId });
    });
  },
);

function subscriptionFixture(): Stripe.Subscription {
  return {
    id: `sub_${suffix}`,
    customer: `cus_${suffix}`,
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: `si_${suffix}`,
          current_period_end: Math.floor(Date.now() / 1_000) + 30 * 24 * 60 * 60,
          price: { id: "price_founding_test" },
        },
      ],
    },
  } as Stripe.Subscription;
}

function checkoutFixture(
  subscription: Stripe.Subscription,
): Stripe.Checkout.Session {
  return {
    id: checkoutSessionId,
    livemode: false,
    mode: "subscription",
    status: "complete",
    payment_status: "paid",
    currency: "eur",
    amount_subtotal: 4_900,
    total_details: {
      amount_discount: 0,
      amount_shipping: 0,
      amount_tax: 0,
    },
    client_reference_id: invitationId,
    customer: `cus_${suffix}`,
    customer_email: ownerEmail,
    customer_details: { email: ownerEmail },
    metadata: {
      claimInvitationId: invitationId,
      siteSlug: slug,
      plan: "founding",
    },
    subscription,
  } as unknown as Stripe.Checkout.Session;
}

function checkoutEvent(): Stripe.Event {
  return {
    id: eventId,
    type: "checkout.session.completed",
    created: Math.floor(Date.now() / 1_000),
    livemode: false,
    data: { object: { id: checkoutSessionId } },
  } as Stripe.Event;
}
