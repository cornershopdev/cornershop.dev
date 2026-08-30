import { describe, expect, it, mock } from "bun:test";
import type Stripe from "stripe";
import type { PrismaClient } from "@/generated/prisma/client";
import { processStripeWebhookEvent } from "@/lib/stripe-webhook";

describe("Stripe webhook event idempotency", () => {
  it("acknowledges an already committed event without calling Stripe again", async () => {
    const retrieve = mock(async () => {
      throw new Error("must not retrieve duplicate events");
    });
    const stripe = {
      checkout: { sessions: { retrieve } },
    } as unknown as Stripe;
    const transaction = mock(async () => "processed");
    const db = {
      stripeWebhookEvent: {
        findUnique: async () => ({ eventId: "evt_duplicate" }),
      },
      $transaction: transaction,
    } as unknown as Pick<
      PrismaClient,
      "stripeWebhookEvent" | "$transaction"
    >;

    const result = await processStripeWebhookEvent(
      {
        id: "evt_duplicate",
        type: "checkout.session.completed",
        created: 1,
        livemode: false,
        data: { object: { id: "cs_test_1" } },
      } as Stripe.Event,
      stripe,
      db,
    );

    expect(result).toBe("duplicate");
    expect(retrieve).not.toHaveBeenCalled();
    expect(transaction).not.toHaveBeenCalled();
  });

  it("ignores event types that are not part of the configured allowlist", async () => {
    const db = {
      stripeWebhookEvent: {
        findUnique: async () => {
          throw new Error("ignored events must not hit storage");
        },
      },
    } as unknown as Pick<
      PrismaClient,
      "stripeWebhookEvent" | "$transaction"
    >;
    const result = await processStripeWebhookEvent(
      {
        id: "evt_ignored",
        type: "customer.created",
      } as Stripe.Event,
      {} as Stripe,
      db,
    );
    expect(result).toBe("ignored");
  });

  it("records and acknowledges a signed Checkout event that is not ours", async () => {
    const created: unknown[] = [];
    const db = {
      stripeWebhookEvent: {
        findUnique: async () => null,
      },
      $transaction: async (
        operation: (transaction: unknown) => Promise<unknown>,
      ) =>
        operation({
          stripeWebhookEvent: {
            create: async (input: unknown) => {
              created.push(input);
            },
          },
        }),
    } as unknown as Pick<
      PrismaClient,
      "stripeWebhookEvent" | "$transaction"
    >;
    const stripe = {
      checkout: {
        sessions: {
          retrieve: async () => ({
            id: "cs_test_unrelated",
            livemode: false,
            subscription: null,
          }),
        },
      },
    } as unknown as Stripe;
    const logged = mock(() => {});
    const original = console.error;
    console.error = logged;
    try {
      const result = await processStripeWebhookEvent(
        {
          id: "evt_unrelated",
          type: "checkout.session.completed",
          created: 1,
          livemode: false,
          data: { object: { id: "cs_test_unrelated" } },
        } as Stripe.Event,
        stripe,
        db,
      );
      expect(result).toBe("rejected");
      expect(created).toHaveLength(1);
    } finally {
      console.error = original;
    }
  });

  it("provisions once without a browser return and converges lifecycle events", async () => {
    const previousPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_PRICE_ID = "price_founding";

    const { db, state } = createWebhookDatabase();
    let currentSubscription = subscriptionFixture();
    const stripe = {
      checkout: {
        sessions: {
          retrieve: async () =>
            checkoutFixture(currentSubscription),
        },
      },
      subscriptions: {
        retrieve: async () => currentSubscription,
      },
    } as unknown as Stripe;

    try {
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_checkout_1", 100),
          stripe,
          db,
        ),
      ).toBe("processed");
      expect(state.users).toHaveLength(1);
      expect(state.organizations).toHaveLength(1);
      expect(state.memberships).toHaveLength(1);
      expect(state.subscriptions).toHaveLength(1);
      expect(state.sites[0]).toMatchObject({
        status: "CLAIMED",
        organizationId: state.organizations[0].id,
      });
      expect(state.invitation.acceptedAt).toBeInstanceOf(Date);
      expect(state.audits).toHaveLength(2);
      expect(state.audits).toContainEqual({
        data: expect.objectContaining({
          type: "stripe.checkout.provisioned",
          siteId: "site_1",
          metadata: expect.objectContaining({
            stripeEventId: "evt_checkout_1",
            stripeEventType: "checkout.session.completed",
            livemode: false,
            claimInvitationId: "invite_1",
            checkoutSessionId: "cs_test_1",
            stripePriceId: "price_founding",
            paymentStatus: "paid",
          }),
        }),
      });

      // A transport retry and a second valid completion event are both safe.
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_checkout_1", 100),
          stripe,
          db,
        ),
      ).toBe("duplicate");
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_checkout_2", 101),
          stripe,
          db,
        ),
      ).toBe("processed");
      expect(state.users).toHaveLength(1);
      expect(state.organizations).toHaveLength(1);
      expect(state.memberships).toHaveLength(1);
      expect(state.subscriptions).toHaveLength(1);
      expect(state.audits).toHaveLength(2);

      currentSubscription = subscriptionFixture({ status: "past_due" });
      expect(
        await processStripeWebhookEvent(
          subscriptionEvent("evt_past_due", 200, currentSubscription),
          stripe,
          db,
        ),
      ).toBe("processed");
      expect(state.subscriptions[0].status).toBe("PAST_DUE");
      expect(state.sites[0].status).toBe("PAUSED");

      // A late older event reads Stripe's current resource but still cannot
      // overwrite a state already recorded at a newer event timestamp.
      currentSubscription = subscriptionFixture({ status: "active" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_late_active", 150, currentSubscription),
        stripe,
        db,
      );
      expect(state.subscriptions[0].status).toBe("PAST_DUE");
      expect(state.sites[0].status).toBe("PAUSED");

      currentSubscription = subscriptionFixture({ status: "canceled" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_canceled", 300, currentSubscription),
        stripe,
        db,
      );
      expect(state.subscriptions[0].status).toBe("CANCELED");
      expect(state.sites[0].status).toBe("PAUSED");

      currentSubscription = subscriptionFixture({ status: "active" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_resumed", 400, currentSubscription),
        stripe,
        db,
      );
      expect(state.subscriptions[0].status).toBe("ACTIVE");
      expect(state.sites[0].status).toBe("CLAIMED");
      expect(state.events).toHaveLength(6);
    } finally {
      restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
    }
  });

  for (const stripeStatus of ["past_due", "canceled"] as const) {
    it(`pauses delayed Checkout provisioning after an earlier ${stripeStatus} event`, async () => {
      await withConfiguredBilling(async () => {
        const { db, state } = createWebhookDatabase();
        const currentSubscription = subscriptionFixture({
          status: stripeStatus,
        });
        const stripe = {
          checkout: {
            sessions: {
              retrieve: async () => checkoutFixture(currentSubscription),
            },
          },
          subscriptions: {
            retrieve: async () => currentSubscription,
          },
        } as unknown as Stripe;

        expect(
          await processStripeWebhookEvent(
            subscriptionEvent(
              `evt_${stripeStatus}_before_checkout`,
              200,
              currentSubscription,
            ),
            stripe,
            db,
          ),
        ).toBe("processed");
        expect(state.subscriptions).toHaveLength(0);

        expect(
          await processStripeWebhookEvent(
            checkoutEvent(`evt_checkout_after_${stripeStatus}`, 100),
            stripe,
            db,
          ),
        ).toBe("processed");
        expect(state.subscriptions[0].status).toBe(
          stripeStatus === "past_due" ? "PAST_DUE" : "CANCELED",
        );
        expect(state.sites[0].status).toBe("PAUSED");

        expect(
          await processStripeWebhookEvent(
            checkoutEvent(`evt_checkout_after_${stripeStatus}`, 100),
            stripe,
            db,
          ),
        ).toBe("duplicate");
        expect(
          await processStripeWebhookEvent(
            subscriptionEvent(
              `evt_${stripeStatus}_after_checkout`,
              201,
              currentSubscription,
            ),
            stripe,
            db,
          ),
        ).toBe("processed");
        expect(state.sites[0].status).toBe("PAUSED");
        expect(
          state.audits.filter(
            (audit) =>
              (audit as { data?: { type?: string } }).data?.type ===
              "billing.site.paused",
          ),
        ).toHaveLength(1);
      });
    });
  }

  it("rolls back partial claim writes and persists a durable rejection", async () => {
    const previousPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_PRICE_ID = "price_founding";
    const { db, state } = createWebhookDatabase({ loseClaimRace: true });
    const stripe = {
      checkout: {
        sessions: {
          retrieve: async () => checkoutFixture(subscriptionFixture()),
        },
      },
    } as unknown as Stripe;
    const original = console.error;
    console.error = mock(() => {});
    try {
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_rejected", 500),
          stripe,
          db,
        ),
      ).toBe("rejected");
      expect(state.users).toHaveLength(0);
      expect(state.organizations).toHaveLength(0);
      expect(state.memberships).toHaveLength(0);
      expect(state.subscriptions).toHaveLength(0);
      expect(state.invitation.acceptedAt).toBeNull();
      expect(state.events).toEqual([
        expect.objectContaining({
          eventId: "evt_rejected",
          status: "REJECTED",
          failureReason: "This site is not available to claim",
        }),
      ]);
      expect(state.audits).toHaveLength(1);
    } finally {
      console.error = original;
      restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
    }
  });

  it("restores a published platform-only site to CLAIMED after a billing pause", async () => {
    await withConfiguredBilling(async () => {
      const { db, state } = createWebhookDatabase();
      let currentSubscription = subscriptionFixture();
      const stripe = {
        checkout: {
          sessions: {
            retrieve: async () => checkoutFixture(currentSubscription),
          },
        },
        subscriptions: { retrieve: async () => currentSubscription },
      } as unknown as Stripe;

      await processStripeWebhookEvent(
        checkoutEvent("evt_claim", 100),
        stripe,
        db,
      );
      state.sites[0].publishedSiteVersionId = "version_1";
      currentSubscription = subscriptionFixture({ status: "past_due" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_pause_platform", 200, currentSubscription),
        stripe,
        db,
      );
      currentSubscription = subscriptionFixture({ status: "active" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_resume_platform", 300, currentSubscription),
        stripe,
        db,
      );

      expect(state.sites[0].status).toBe("CLAIMED");
      expect(state.audits).toContainEqual({
        data: expect.objectContaining({
          type: "billing.site.restored",
          metadata: expect.objectContaining({ restoredTo: "CLAIMED" }),
        }),
      });
    });
  });

  it("restores a published verified-domain site to LIVE after a billing pause", async () => {
    await withConfiguredBilling(async () => {
      const { db, state } = createWebhookDatabase();
      let currentSubscription = subscriptionFixture();
      const stripe = {
        checkout: {
          sessions: {
            retrieve: async () => checkoutFixture(currentSubscription),
          },
        },
        subscriptions: { retrieve: async () => currentSubscription },
      } as unknown as Stripe;

      await processStripeWebhookEvent(
        checkoutEvent("evt_claim", 100),
        stripe,
        db,
      );
      state.sites[0].publishedSiteVersionId = "version_1";
      state.domains.push({ siteId: "site_1", verified: true });
      currentSubscription = subscriptionFixture({ status: "past_due" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_pause_domain", 200, currentSubscription),
        stripe,
        db,
      );
      currentSubscription = subscriptionFixture({ status: "active" });
      await processStripeWebhookEvent(
        subscriptionEvent("evt_resume_domain", 300, currentSubscription),
        stripe,
        db,
      );

      expect(state.sites[0].status).toBe("LIVE");
      expect(state.audits).toContainEqual({
        data: expect.objectContaining({
          type: "billing.site.restored",
          metadata: expect.objectContaining({ restoredTo: "LIVE" }),
        }),
      });
    });
  });

  it("refuses a completed Checkout that did not collect payment", async () => {
    const previousPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_PRICE_ID = "price_founding";
    const { db, state } = createWebhookDatabase();
    const fixture = checkoutFixture(subscriptionFixture());
    fixture.payment_status = "no_payment_required";
    const stripe = {
      checkout: { sessions: { retrieve: async () => fixture } },
    } as unknown as Stripe;
    const original = console.error;
    console.error = mock(() => {});

    try {
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_no_payment", 550),
          stripe,
          db,
        ),
      ).toBe("rejected");
      expect(state.users).toHaveLength(0);
      expect(state.subscriptions).toHaveLength(0);
      expect(state.invitation.acceptedAt).toBeNull();
      expect(state.events).toEqual([
        expect.objectContaining({
          eventId: "evt_no_payment",
          status: "REJECTED",
          failureReason: "Checkout is not paid and complete",
        }),
      ]);
    } finally {
      console.error = original;
      restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
    }
  });

  it("refuses provisioning when an old operator approval lacks evidence", async () => {
    const previousPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_PRICE_ID = "price_founding";
    const { db, state } = createWebhookDatabase();
    state.invitation.proofMethod = "OPERATOR_APPROVAL";
    const stripe = {
      checkout: {
        sessions: { retrieve: async () => checkoutFixture(subscriptionFixture()) },
      },
    } as unknown as Stripe;
    const original = console.error;
    console.error = mock(() => {});

    try {
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_missing_approval_evidence", 560),
          stripe,
          db,
        ),
      ).toBe("rejected");
      expect(state.users).toHaveLength(0);
      expect(state.subscriptions).toHaveLength(0);
      expect(state.invitation.acceptedAt).toBeNull();
      expect(state.events).toEqual([
        expect.objectContaining({
          status: "REJECTED",
          failureReason: "Claim invitation ownership evidence is invalid",
        }),
      ]);
    } finally {
      console.error = original;
      restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
    }
  });

  it("refuses a discounted founding Checkout even when Stripe marks it paid", async () => {
    const previousPrice = process.env.STRIPE_PRICE_ID;
    process.env.STRIPE_PRICE_ID = "price_founding";
    const { db, state } = createWebhookDatabase();
    state.invitation.stripePriceId = "price_founding";
    const subscription = subscriptionFixture();
    subscription.items.data[0].price.id = "price_founding";
    const fixture = checkoutFixture(subscription);
    fixture.metadata = { ...fixture.metadata, plan: "founding" };
    fixture.total_details = {
      amount_discount: 1_000,
      amount_shipping: 0,
      amount_tax: 0,
    };
    const stripe = {
      checkout: { sessions: { retrieve: async () => fixture } },
    } as unknown as Stripe;
    const original = console.error;
    console.error = mock(() => {});

    try {
      expect(
        await processStripeWebhookEvent(
          checkoutEvent("evt_discounted", 575),
          stripe,
          db,
        ),
      ).toBe("rejected");
      expect(state.users).toHaveLength(0);
      expect(state.subscriptions).toHaveLength(0);
      expect(state.events).toEqual([
        expect.objectContaining({
          status: "REJECTED",
          failureReason: "Checkout total does not match the founding offer",
        }),
      ]);
    } finally {
      console.error = original;
      restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
    }
  });

  it("rejects a Checkout on a retired price", async () => {
    await withConfiguredBilling(async () => {
      const { db, state } = createWebhookDatabase();
      state.invitation.stripePriceId = "price_retired";
      const subscription = subscriptionFixture();
      subscription.items.data[0].price.id = "price_retired";
      const stripe = {
        checkout: {
          sessions: {
            retrieve: async () => checkoutFixture(subscription),
          },
        },
      } as unknown as Stripe;
      const original = console.error;
      console.error = mock(() => {});
      try {
        expect(
          await processStripeWebhookEvent(
            checkoutEvent("evt_retired_price", 600),
            stripe,
            db,
          ),
        ).toBe("rejected");
        expect(state.subscriptions).toHaveLength(0);
        expect(state.events).toContainEqual(
          expect.objectContaining({
            status: "REJECTED",
            failureReason: "Checkout price is not configured",
          }),
        );
      } finally {
        console.error = original;
      }
    });
  });
});

type SiteRow = {
  id: string;
  slug: string;
  status: string;
  organizationId: string | null;
  publishedSiteVersionId: string | null;
};

type SubscriptionRow = {
  stripeCustomerId: string;
  stripeSubscriptionId: string | null;
  stripePriceId: string | null;
  status: string;
  currentPeriodEnd: Date | null;
  cancelAtPeriodEnd: boolean;
  lastStripeEventAt: Date | null;
  siteId: string;
  organizationId: string;
};

function createWebhookDatabase(
  options: { loseClaimRace?: boolean } = {},
) {
  const state = {
    events: [] as Array<{
      eventId: string;
      status?: string;
      failureReason?: string;
    }>,
    invitation: {
      id: "invite_1",
      email: "owner@chez-lea.test",
      proofMethod: "DOMAIN_EMAIL",
      approvalEvidenceRef: null as string | null,
      approvedBy: null as string | null,
      approvedAt: null as Date | null,
      expiresAt: new Date("2099-01-01"),
      acceptedAt: null as Date | null,
      revokedAt: null as Date | null,
      checkoutSessionId: "cs_test_1",
      stripePriceId: "price_founding",
      siteId: "site_1",
    },
    sites: [
      {
        id: "site_1",
        slug: "chez-lea",
        status: "PREVIEW_READY",
        organizationId: null,
        publishedSiteVersionId: null,
      },
    ] as SiteRow[],
    users: [] as Array<{ id: string; email: string }>,
    organizations: [] as Array<{ id: string; name: string }>,
    memberships: [] as Array<{
      userId: string;
      organizationId: string;
      role: string;
    }>,
    domains: [] as Array<{ siteId: string; verified: boolean }>,
    subscriptions: [] as SubscriptionRow[],
    audits: [] as unknown[],
  };
  let sequence = 0;
  const nextId = (prefix: string) => `${prefix}_${(sequence += 1)}`;

  const tx = {
    stripeWebhookEvent: {
      create: async ({
        data,
      }: {
        data: {
          eventId: string;
          status?: string;
          failureReason?: string;
        };
      }) => {
        if (state.events.some((row) => row.eventId === data.eventId)) {
          throw Object.assign(new Error("duplicate"), { code: "P2002" });
        }
        state.events.push(data);
      },
    },
    claimInvitation: {
      findUnique: async () => ({
        ...state.invitation,
        site: { ...state.sites[0] },
      }),
      updateMany: async ({
        where,
        data,
      }: {
        where: { id: string; acceptedAt: null };
        data: { acceptedAt: Date };
      }) => {
        if (
          state.invitation.id !== where.id ||
          state.invitation.acceptedAt !== null
        ) {
          return { count: 0 };
        }
        state.invitation.acceptedAt = data.acceptedAt;
        return { count: 1 };
      },
    },
    user: {
      upsert: async ({
        where,
        create,
      }: {
        where: { email: string };
        create: { email: string };
      }) => {
        const existing = state.users.find((row) => row.email === where.email);
        if (existing) return existing;
        const user = { id: nextId("user"), email: create.email };
        state.users.push(user);
        return user;
      },
    },
    membership: {
      findFirst: async ({
        where,
      }: {
        where: { userId: string; organizationId: string; role: string };
      }) =>
        state.memberships.find(
          (row) =>
            row.userId === where.userId &&
            row.organizationId === where.organizationId &&
            row.role === where.role,
        ) ?? null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: {
          userId_organizationId: { userId: string; organizationId: string };
        };
        update: { role: string };
        create: { userId: string; organizationId: string; role: string };
      }) => {
        const key = where.userId_organizationId;
        const existing = state.memberships.find(
          (row) =>
            row.userId === key.userId &&
            row.organizationId === key.organizationId,
        );
        if (existing) return Object.assign(existing, update);
        state.memberships.push(create);
        return create;
      },
    },
    organization: {
      upsert: async ({
        where,
        create,
      }: {
        where: { id: string };
        create: { id: string; name: string };
      }) => {
        const existing = state.organizations.find(
          (row) => row.id === where.id,
        );
        if (existing) return existing;
        state.organizations.push(create);
        return create;
      },
    },
    site: {
      findUnique: async ({
        where,
      }: {
        where: { slug?: string; id?: string };
      }) => {
        const site = state.sites.find(
          (row) =>
            (where.slug !== undefined && row.slug === where.slug) ||
            (where.id !== undefined && row.id === where.id),
        );
        if (!site) return null;
        return {
          ...site,
          publishedSiteVersion: site.publishedSiteVersionId
            ? {
                id: site.publishedSiteVersionId,
                siteId: site.id,
                publishedAt: new Date("2026-08-20T00:00:00.000Z"),
              }
            : null,
        };
      },
      update: async ({
        where,
        data,
      }: {
        where: { id: string };
        data: Partial<SiteRow>;
      }) => {
        const site = state.sites.find((row) => row.id === where.id);
        if (!site) throw new Error("site not found");
        Object.assign(site, data);
        return site;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          slug: string;
          organizationId: null;
          status: { in: string[] };
        };
        data: Partial<SiteRow>;
      }) => {
        if (options.loseClaimRace && data.status === "CLAIMED") {
          return { count: 0 };
        }
        const matches = state.sites.filter(
          (row) =>
            row.slug === where.slug &&
            row.organizationId === null &&
            where.status.in.includes(row.status),
        );
        for (const row of matches) Object.assign(row, data);
        return { count: matches.length };
      },
      count: async ({
        where,
      }: {
        where: { slug: string; organizationId: string };
      }) =>
        state.sites.filter(
          (row) =>
            row.slug === where.slug &&
            row.organizationId === where.organizationId,
        ).length,
    },
    subscription: {
      findFirst: async ({
        where,
      }: {
        where: { stripeSubscriptionId: string };
      }) => {
        const subscription = state.subscriptions.find(
          (row) => row.stripeSubscriptionId === where.stripeSubscriptionId,
        );
        if (!subscription) return null;
        const site = state.sites.find((row) => row.id === subscription.siteId);
        if (!site) return null;
        return {
          siteId: subscription.siteId,
          site: {
            status: site.status,
            publishedSiteVersionId: site.publishedSiteVersionId,
            publishedSiteVersion: site.publishedSiteVersionId
              ? {
                  id: site.publishedSiteVersionId,
                  siteId: site.id,
                  publishedAt: new Date("2026-08-20T00:00:00.000Z"),
                }
              : null,
          },
        };
      },
      findUnique: async ({
        where,
      }: {
        where: { siteId: string };
      }) =>
        state.subscriptions.find(
          (row) => row.siteId === where.siteId,
        ) ?? null,
      upsert: async ({
        where,
        update,
        create,
      }: {
        where: { siteId: string };
        update: Partial<SubscriptionRow>;
        create: SubscriptionRow;
      }) => {
        const existing = state.subscriptions.find(
          (row) => row.siteId === where.siteId,
        );
        if (existing) return Object.assign(existing, update);
        state.subscriptions.push(create);
        return create;
      },
      updateMany: async ({
        where,
        data,
      }: {
        where: {
          stripeSubscriptionId: string;
          OR: Array<
            | { lastStripeEventAt: null }
            | { lastStripeEventAt: { lte: Date } }
          >;
        };
        data: Partial<SubscriptionRow>;
      }) => {
        const existing = state.subscriptions.find(
          (row) =>
            row.stripeSubscriptionId === where.stripeSubscriptionId,
        );
        if (!existing) return { count: 0 };
        const eligible = where.OR.some((condition) => {
          if (condition.lastStripeEventAt === null) {
            return existing.lastStripeEventAt === null;
          }
          return (
            existing.lastStripeEventAt !== null &&
            existing.lastStripeEventAt <= condition.lastStripeEventAt.lte
          );
        });
        if (!eligible) return { count: 0 };
        Object.assign(existing, data);
        return { count: 1 };
      },
    },
    auditEvent: {
      create: async (input: unknown) => {
        state.audits.push(input);
      },
    },
    domain: {
      count: async ({
        where,
      }: {
        where: { siteId: string; verified: boolean };
      }) =>
        state.domains.filter(
          (row) =>
            row.siteId === where.siteId && row.verified === where.verified,
        ).length,
    },
  };
  const db = {
    stripeWebhookEvent: {
      findUnique: async ({ where }: { where: { eventId: string } }) =>
        state.events.some((row) => row.eventId === where.eventId)
          ? { eventId: where.eventId }
          : null,
    },
    $transaction: async (
      operation: (transaction: unknown) => Promise<unknown>,
    ) => {
      const snapshot = structuredClone(state);
      try {
        return await operation(tx);
      } catch (error) {
        Object.assign(state, snapshot);
        throw error;
      }
    },
  } as unknown as Pick<
    PrismaClient,
    "stripeWebhookEvent" | "$transaction"
  >;
  return { db, state };
}

function checkoutFixture(
  subscription: Stripe.Subscription,
): Stripe.Checkout.Session {
  return {
    id: "cs_test_1",
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
    adaptive_pricing: { enabled: true },
    presentment_details: {
      presentment_amount: 5_300,
      presentment_currency: "usd",
    },
    client_reference_id: "invite_1",
    customer: "cus_1",
    customer_email: "owner@chez-lea.test",
    customer_details: { email: "owner@chez-lea.test" },
    metadata: {
      claimInvitationId: "invite_1",
      siteSlug: "chez-lea",
      plan: "founding",
    },
    subscription,
  } as unknown as Stripe.Checkout.Session;
}

function subscriptionFixture(
  overrides: Partial<Stripe.Subscription> = {},
): Stripe.Subscription {
  return {
    id: "sub_1",
    customer: "cus_1",
    status: "active",
    cancel_at_period_end: false,
    items: {
      data: [
        {
          id: "si_1",
          current_period_end: 1_785_110_400,
          price: { id: "price_founding" },
        },
      ],
    },
    ...overrides,
  } as Stripe.Subscription;
}

function checkoutEvent(id: string, created: number): Stripe.Event {
  return {
    id,
    type: "checkout.session.completed",
    created,
    livemode: false,
    data: { object: { id: "cs_test_1" } },
  } as Stripe.Event;
}

function subscriptionEvent(
  id: string,
  created: number,
  subscription: Stripe.Subscription,
): Stripe.Event {
  return {
    id,
    type: "customer.subscription.updated",
    created,
    livemode: false,
    data: { object: subscription },
  } as Stripe.Event;
}

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

async function withConfiguredBilling(run: () => Promise<void>) {
  const previousPrice = process.env.STRIPE_PRICE_ID;
  process.env.STRIPE_PRICE_ID = "price_founding";
  try {
    await run();
  } finally {
    restoreEnvironment("STRIPE_PRICE_ID", previousPrice);
  }
}
