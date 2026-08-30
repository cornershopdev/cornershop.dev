import { readFile } from "node:fs/promises";
import {
  evaluateFirstCustomerEvidence,
  FIRST_CUSTOMER_AUTOMATED_CHECKS,
  FIRST_CUSTOMER_REAL_CHECKS,
  firstCustomerProductionManifestSchema,
  fingerprintFirstCustomerIdentifier,
  isHumanAcceptanceWindowComplete,
  isCustomerDomainHostname,
  verifyFirstCustomerEvidenceAttestation,
  type FirstCustomerProductionManifest,
} from "@/lib/first-customer-evidence";
import { getDb } from "@/lib/db";
import { FOUNDING_PRICE, isStripeLiveApiKey } from "@/lib/billing-plans";
import {
  evidenceDigest,
  integrationUrlDigest,
} from "@/lib/evidence-digests";
import { getStripe } from "@/lib/stripe";

type Metadata = Record<string, unknown>;

class VerificationFailure extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "VerificationFailure";
  }
}

let databaseOpened = false;

try {
  const manifest = await loadManifest(parseArguments(process.argv.slice(2)));
  const result = await verifyProductionEvidence(manifest);
  console.log(JSON.stringify(result, null, 2));
  if (result.outcome !== "REAL_CUSTOMER_ACCEPTANCE_VERIFIED") {
    process.exitCode = 1;
  }
} catch (error) {
  console.error(
    JSON.stringify(
      {
        command: "verify-first-customer-production",
        outcome: "NOT_VERIFIED",
        realCustomerAcceptanceVerified: false,
        failure: safeFailureCode(error),
        failedAt: new Date().toISOString(),
      },
      null,
      2,
    ),
  );
  process.exitCode = 1;
} finally {
  if (databaseOpened) {
    await getDb().$disconnect().catch(() => undefined);
  }
}

async function verifyProductionEvidence(
  manifest: FirstCustomerProductionManifest,
) {
  assertProductionConfiguration(manifest);
  const db = getDb();
  databaseOpened = true;

  const site = await db.site.findUnique({
    where: { slug: manifest.siteSlug },
    select: {
      id: true,
      slug: true,
      status: true,
      organizationId: true,
      publishedSiteVersionId: true,
      publishedSiteVersion: {
        select: {
          id: true,
          version: true,
          content: true,
          integrations: true,
          publishedAt: true,
        },
      },
      domains: {
        select: {
          hostname: true,
          verified: true,
          verifiedAt: true,
          tlsStatus: true,
          tlsCheckedAt: true,
        },
      },
      subscription: {
        select: {
          stripeSubscriptionId: true,
          stripePriceId: true,
          status: true,
          organizationId: true,
        },
      },
      claimInvitations: {
        where: { id: manifest.delivery.claimInvitationId },
        take: 1,
        select: {
          id: true,
          verifiedAt: true,
          acceptedAt: true,
          revokedAt: true,
          checkoutSessionId: true,
          approvalEvidenceRef: true,
          approvedAt: true,
          deliveryStatus: true,
          providerMessageId: true,
          deliveredAt: true,
        },
      },
      auditEvents: {
        where: {
          id: {
            in: [
              manifest.publication.sourceImportAuditId,
              manifest.publication.draftSaveAuditId,
              manifest.publication.publishAuditId,
              manifest.delivery.claimReplayRejectionAuditId,
            ],
          },
        },
        select: {
          id: true,
          type: true,
          actor: true,
          metadata: true,
          createdAt: true,
        },
      },
    },
  });
  if (!site) throw new VerificationFailure("site_not_found");

  const [
    webhookEvent,
    provisioningAudit,
    magicLink,
    authProviderEvent,
    claimProviderEvent,
    persistedSession,
    sessionBindingAudit,
    sessionRevocationAudit,
    alerts,
    stripeEvidence,
    publicEvidence,
  ] = await Promise.all([
    db.stripeWebhookEvent.findUnique({
      where: { eventId: manifest.stripe.webhookEventId },
      select: {
        eventId: true,
        type: true,
        livemode: true,
        status: true,
        processedAt: true,
      },
    }),
    db.auditEvent.findFirst({
      where: {
        siteId: site.id,
        type: "stripe.checkout.provisioned",
        metadata: { path: ["stripeEventId"], equals: manifest.stripe.webhookEventId },
      },
      select: { id: true, metadata: true, createdAt: true },
    }),
    db.authMagicLink.findUnique({
      where: { id: manifest.delivery.authMagicLinkId },
      select: {
        id: true,
        userId: true,
        deliveryStatus: true,
        providerMessageId: true,
        providerEventAt: true,
        deliveredAt: true,
        consumedAt: true,
        revokedAt: true,
      },
    }),
    db.authProviderEvent.findUnique({
      where: { id: manifest.delivery.authProviderDeliveryEventId },
      select: {
        id: true,
        authMagicLinkId: true,
        eventType: true,
        providerMessageId: true,
        deliveryStatus: true,
        occurredAt: true,
      },
    }),
    db.claimProviderEvent.findUnique({
      where: { id: manifest.delivery.claimProviderDeliveryEventId },
      select: {
        id: true,
        claimInvitationId: true,
        eventType: true,
        deliveryStatus: true,
        providerMessageId: true,
        occurredAt: true,
      },
    }),
    db.session.findUnique({
      where: { id: manifest.session.sessionId },
      select: { id: true },
    }),
    db.authEvent.findUnique({
      where: { id: manifest.session.bindingAuditId },
      select: {
        id: true,
        type: true,
        subjectUserId: true,
        sessionId: true,
        siteId: true,
        metadata: true,
        createdAt: true,
      },
    }),
    db.authEvent.findUnique({
      where: { id: manifest.session.revocationAuditId },
      select: {
        id: true,
        type: true,
        subjectUserId: true,
        sessionId: true,
        siteId: true,
        createdAt: true,
      },
    }),
    db.operatorAlert.findMany({
      where: {
        id: {
          in: [
            manifest.alerts.checkout.alertId,
            manifest.alerts.publish.alertId,
            manifest.alerts.publicSite.alertId,
          ],
        },
      },
      select: { id: true, kind: true, status: true, deliveredAt: true },
    }),
    inspectStripe(manifest),
    inspectPublicUrl(manifest.publicUrl, manifest.publication.publishedVersionId),
  ]);

  const invitation = site.claimInvitations[0] ?? null;
  const sourceImportAudit = site.auditEvents.find(
    ({ id }) => id === manifest.publication.sourceImportAuditId,
  );
  const draftSaveAudit = site.auditEvents.find(
    ({ id }) => id === manifest.publication.draftSaveAuditId,
  );
  const publishAudit = site.auditEvents.find(
    ({ id }) => id === manifest.publication.publishAuditId,
  );
  const claimReplayAudit = site.auditEvents.find(
    ({ id }) => id === manifest.delivery.claimReplayRejectionAuditId,
  );
  const draftMetadata = metadata(draftSaveAudit?.metadata);
  const publishMetadata = metadata(publishAudit?.metadata);
  const sourceMetadata = metadata(sourceImportAudit?.metadata);
  const provisioningMetadata = metadata(provisioningAudit?.metadata);
  const replayMetadata = metadata(claimReplayAudit?.metadata);
  const sessionBindingMetadata = metadata(sessionBindingAudit?.metadata);
  const previousSessionId =
    typeof sessionBindingMetadata.previousSessionId === "string"
      ? sessionBindingMetadata.previousSessionId
      : null;
  const previousSession = previousSessionId
    ? await db.session.findUnique({
        where: { id: previousSessionId },
        select: { id: true },
      })
    : null;
  const publishedVersion = site.publishedSiteVersion;
  const contentDigest = publishedVersion
    ? evidenceDigest(publishedVersion.content)
    : null;
  const integrationDigest = publishedVersion
    ? integrationDigestFromUnknown(publishedVersion.integrations)
    : null;

  const providerDeliveredClaim =
    invitation?.deliveryStatus === "DELIVERED" &&
    Boolean(invitation.providerMessageId) &&
    invitation.deliveredAt instanceof Date &&
    claimProviderEvent?.claimInvitationId === invitation.id &&
    claimProviderEvent.eventType === "email.delivered" &&
    claimProviderEvent.deliveryStatus === "DELIVERED" &&
    claimProviderEvent.providerMessageId === invitation.providerMessageId &&
    invitation?.acceptedAt instanceof Date &&
    claimProviderEvent.occurredAt.getTime() === invitation.deliveredAt.getTime() &&
    claimProviderEvent.occurredAt <= invitation.acceptedAt;
  const providerDeliveredAuth =
    magicLink?.deliveryStatus === "DELIVERED" &&
    magicLink.deliveredAt instanceof Date &&
    authProviderEvent?.deliveryStatus === "DELIVERED" &&
    authProviderEvent.eventType === "email.delivered" &&
    authProviderEvent.authMagicLinkId === manifest.delivery.authMagicLinkId &&
    Boolean(magicLink?.providerMessageId) &&
    authProviderEvent?.providerMessageId === magicLink?.providerMessageId &&
    authProviderEvent.occurredAt.getTime() === magicLink.deliveredAt.getTime() &&
    magicLink.providerEventAt?.getTime() === magicLink.deliveredAt.getTime() &&
    magicLink?.consumedAt instanceof Date &&
    authProviderEvent.occurredAt <= magicLink.consumedAt &&
    !magicLink?.revokedAt;
  const persistedWebhookProvisioning =
    webhookEvent?.livemode === true &&
    webhookEvent?.status === "PROCESSED" &&
    ["checkout.session.completed", "checkout.session.async_payment_succeeded"].includes(
      webhookEvent.type,
    ) &&
    provisioningMetadata.stripeEventId === manifest.stripe.webhookEventId &&
    provisioningMetadata.livemode === true &&
    provisioningMetadata.claimInvitationId ===
      manifest.delivery.claimInvitationId &&
    provisioningMetadata.checkoutSessionId ===
      manifest.stripe.checkoutSessionId &&
    provisioningMetadata.stripeSubscriptionId === manifest.stripe.subscriptionId &&
    provisioningMetadata.stripePriceId ===
      process.env.STRIPE_PRICE_ID &&
    provisioningMetadata.paymentStatus === "paid" &&
    invitation?.checkoutSessionId === manifest.stripe.checkoutSessionId &&
    Boolean(invitation?.acceptedAt) &&
    site.subscription?.stripeSubscriptionId === manifest.stripe.subscriptionId &&
    site.subscription.status === "ACTIVE";
  const sessionSiteBinding =
    manifest.session.siteId === site.id &&
    persistedSession === null &&
    sessionBindingAudit?.type === "auth.session.rotated" &&
    sessionBindingAudit.sessionId === manifest.session.sessionId &&
    sessionBindingAudit.siteId === site.id &&
    sessionBindingAudit.subjectUserId === magicLink?.userId &&
    sessionBindingMetadata.purpose === "SITE" &&
    sessionBindingMetadata.organizationId === site.organizationId &&
    sessionBindingMetadata.currentSessionId === manifest.session.sessionId &&
    previousSessionId !== null &&
    previousSessionId !== manifest.session.sessionId &&
    previousSession === null &&
    sessionRevocationAudit?.type === "auth.session.revoked" &&
    sessionRevocationAudit.sessionId === manifest.session.sessionId &&
    sessionRevocationAudit.siteId === site.id &&
    sessionRevocationAudit.subjectUserId === magicLink?.userId &&
    sessionRevocationAudit.createdAt > sessionBindingAudit.createdAt &&
    publishAudit?.createdAt instanceof Date &&
    sessionRevocationAudit.createdAt > publishAudit.createdAt;
  const privateDraftEvidence =
    draftSaveAudit?.type === "site.draft.saved" &&
    draftSaveAudit.actor === magicLink?.userId &&
    typeof draftMetadata.revision === "number" &&
    isDigest(draftMetadata.draftContentDigest) &&
    isDigest(draftMetadata.integrationUrlDigest) &&
    (draftMetadata.publishedSiteVersionIdAtSave === null ||
      typeof draftMetadata.publishedSiteVersionIdAtSave === "string") &&
    draftMetadata.publishedSiteVersionIdAtSave !==
      manifest.publication.publishedVersionId;
  const atomicPublishEvidence =
    publishAudit?.type === "site.published" &&
    publishAudit.actor === magicLink?.userId &&
    site.publishedSiteVersionId === manifest.publication.publishedVersionId &&
    publishedVersion?.id === manifest.publication.publishedVersionId &&
    publishMetadata.siteVersionId === manifest.publication.publishedVersionId &&
    publishMetadata.previousSiteVersionId ===
      draftMetadata.publishedSiteVersionIdAtSave &&
    publishMetadata.draftRevision === draftMetadata.revision &&
    publishMetadata.draftContentDigest === contentDigest &&
    publishMetadata.integrationUrlDigest === integrationDigest &&
    draftMetadata.draftContentDigest === contentDigest &&
    draftMetadata.integrationUrlDigest === integrationDigest;
  const preservedIntegrations =
    ["site.import.created", "site.import.updated"].includes(
      sourceImportAudit?.type ?? "",
    ) &&
    isDigest(sourceMetadata.integrationUrlDigest) &&
    integrationDigest === sourceMetadata.integrationUrlDigest &&
    publishMetadata.integrationUrlDigest === sourceMetadata.integrationUrlDigest;
  const tlsAndLiveVersion =
    site.status === "LIVE" &&
    publicEvidence.ok &&
    publicEvidence.versionId === manifest.publication.publishedVersionId &&
    site.domains.some(
      (domain) =>
        domain.hostname === publicEvidence.hostname &&
        domain.verified &&
        Boolean(domain.verifiedAt) &&
        domain.tlsStatus === "READY" &&
        Boolean(domain.tlsCheckedAt),
    );
  const alertReceipts = deliveredAlertEvidence(manifest, alerts);
  const privateEvidenceAttested = verifyFirstCustomerEvidenceAttestation(
    manifest,
    process.env.FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY ?? "",
  );
  const humanAcceptanceWindow =
    stripeEvidence.invoiceSettledAt instanceof Date &&
    draftSaveAudit?.createdAt instanceof Date &&
    isHumanAcceptanceWindowComplete({
      checkoutCreatedAt: stripeEvidence.checkoutCreatedAt,
      invoiceSettledAt: stripeEvidence.invoiceSettledAt,
      draftSavedAt: draftSaveAudit.createdAt,
      ownerEditConfirmedAt: new Date(
        manifest.humanEvidence.ownerEditConfirmedAt,
      ),
      onboardingRecordedAt: new Date(
        manifest.humanEvidence.onboardingRecordedAt,
      ),
      supportWindowEndedAt: new Date(
        manifest.humanEvidence.supportWindowEndedAt,
      ),
      thirtyDayReviewScheduledAt: new Date(
        manifest.humanEvidence.thirtyDayReviewScheduledAt,
      ),
      thirtyDayReviewCompletedAt: new Date(
        manifest.humanEvidence.thirtyDayReviewCompletedAt,
      ),
      now: new Date(),
    });

  const automated = checks(FIRST_CUSTOMER_AUTOMATED_CHECKS, {
    single_use_claim:
      Boolean(invitation?.verifiedAt) &&
      invitation?.acceptedAt instanceof Date &&
      !invitation?.revokedAt &&
      claimReplayAudit?.type === "claim.invitation.rejected" &&
      replayMetadata.reason === "invitation_used" &&
      replayMetadata.invitationId === manifest.delivery.claimInvitationId &&
      claimReplayAudit.createdAt > invitation.acceptedAt,
    webhook_only_provisioning: persistedWebhookProvisioning,
    workspace_binding: sessionSiteBinding,
    private_draft_save: privateDraftEvidence,
    atomic_publish: atomicPublishEvidence,
    live_version_identity: tlsAndLiveVersion,
    integration_preservation: preservedIntegrations,
    failure_alerting: alertReceipts,
  });
  const real = checks(FIRST_CUSTOMER_REAL_CHECKS, {
    production_environment: true,
    owner_authorization:
      privateEvidenceAttested &&
      invitation?.approvalEvidenceRef ===
        manifest.ownerAuthorization.evidenceRef &&
      invitation?.approvedAt?.toISOString() ===
        manifest.ownerAuthorization.authorizedAt &&
      new Date(manifest.ownerAuthorization.authorizedAt) <=
      stripeEvidence.checkoutCreatedAt,
    live_stripe_price: stripeEvidence.livePrice,
    settled_live_payment: stripeEvidence.settledPayment,
    persisted_webhook_provisioning: persistedWebhookProvisioning,
    provider_delivered_claim: providerDeliveredClaim,
    provider_delivered_auth: providerDeliveredAuth,
    session_site_binding: sessionSiteBinding,
    private_draft_save_evidence: privateDraftEvidence,
    atomic_publish_evidence: atomicPublishEvidence,
    verified_tls_and_live_version: tlsAndLiveVersion,
    preserved_integrations: preservedIntegrations,
    delivered_alert_receipts: alertReceipts && privateEvidenceAttested,
    human_cost_and_review_records:
      humanAcceptanceWindow && privateEvidenceAttested,
  });
  const verdict = evaluateFirstCustomerEvidence({
    environment: "production",
    automated,
    real,
  });

  return {
    command: "verify-first-customer-production",
    environment: "production",
    ...verdict,
    evidence: {
      siteSlug: site.slug,
      siteFingerprint: fingerprintFirstCustomerIdentifier(site.id),
      checkoutFingerprint: fingerprintFirstCustomerIdentifier(
        manifest.stripe.checkoutSessionId,
      ),
      subscriptionFingerprint: fingerprintFirstCustomerIdentifier(
        manifest.stripe.subscriptionId,
      ),
      publishedVersionFingerprint: fingerprintFirstCustomerIdentifier(
        manifest.publication.publishedVersionId,
      ),
      publicOrigin: new URL(manifest.publicUrl).origin,
      checkedAt: new Date().toISOString(),
    },
  };
}

async function inspectStripe(manifest: FirstCustomerProductionManifest) {
  const priceId = process.env.STRIPE_PRICE_ID!;
  const stripe = getStripe();
  const checkout = await stripe.checkout.sessions.retrieve(
    manifest.stripe.checkoutSessionId,
  );
  const invoiceId =
    typeof checkout.invoice === "string"
      ? checkout.invoice
      : checkout.invoice?.id ?? null;
  const [price, subscription, paidInvoice] = await Promise.all([
    stripe.prices.retrieve(priceId, { expand: ["product"] }),
    stripe.subscriptions.retrieve(manifest.stripe.subscriptionId),
    invoiceId ? stripe.invoices.retrieve(invoiceId) : Promise.resolve(null),
  ]);
  const checkoutSubscription =
    typeof checkout.subscription === "string"
      ? checkout.subscription
      : checkout.subscription?.id;
  const product = price.product;
  const activeProduct =
    typeof product !== "string" &&
    !("deleted" in product && product.deleted === true) &&
    "active" in product &&
    product.active === true;
  const subscriptionUsesFoundingPrice = subscription.items.data.some(
    (item) => item.price.id === priceId,
  );
  const invoiceSettledAt = paidInvoice?.status_transitions.paid_at
    ? new Date(paidInvoice.status_transitions.paid_at * 1_000)
    : null;
  const checkoutInvoicePaid =
    paidInvoice?.id === invoiceId &&
    paidInvoice.livemode &&
    paidInvoice.status === "paid" &&
    paidInvoice.currency.toLowerCase() === FOUNDING_PRICE.currency &&
    paidInvoice.subtotal === FOUNDING_PRICE.unitAmount &&
    (paidInvoice.total_discount_amounts ?? []).reduce(
      (total, discount) => total + discount.amount,
      0,
    ) === 0 &&
    paidInvoice.amount_paid >= FOUNDING_PRICE.unitAmount &&
    invoiceSettledAt instanceof Date;
  return {
    checkoutCreatedAt: new Date(checkout.created * 1_000),
    invoiceSettledAt,
    livePrice:
      price.livemode &&
      price.active &&
      activeProduct &&
      price.id === priceId &&
      price.currency.toLowerCase() === FOUNDING_PRICE.currency &&
      price.unit_amount === FOUNDING_PRICE.unitAmount &&
      price.tax_behavior === FOUNDING_PRICE.taxBehavior &&
      price.recurring?.interval === FOUNDING_PRICE.interval &&
      price.recurring.interval_count === FOUNDING_PRICE.intervalCount &&
      price.recurring.usage_type !== "metered",
    settledPayment:
      checkout.livemode &&
      checkout.mode === "subscription" &&
      checkout.status === "complete" &&
      checkout.payment_status === "paid" &&
      checkout.currency?.toLowerCase() === FOUNDING_PRICE.currency &&
      checkout.amount_subtotal === FOUNDING_PRICE.unitAmount &&
      (checkout.total_details?.amount_discount ?? 0) === 0 &&
      checkoutSubscription === manifest.stripe.subscriptionId &&
      subscription.livemode &&
      subscription.id === manifest.stripe.subscriptionId &&
      subscription.status === "active" &&
      subscriptionUsesFoundingPrice &&
      checkoutInvoicePaid,
  };
}

async function inspectPublicUrl(publicUrl: string, expectedVersionId: string) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 10_000);
  try {
    const response = await fetch(publicUrl, {
      cache: "no-store",
      headers: { "User-Agent": "cornershopdev-first-customer-verifier/1.0" },
      signal: controller.signal,
    });
    const body = await response.text();
    const headerVersion =
      response.headers.get("x-cornershop-site-version") ??
      response.headers.get("x-cornershop-live-site-version");
    const metaVersion = body.match(
      /<meta\s+name=["']cornershop-site-version["']\s+content=["']([^"']+)["']/i,
    )?.[1];
    const finalUrl = new URL(response.url);
    const requestedUrl = new URL(publicUrl);
    return {
      ok:
        response.ok &&
        finalUrl.protocol === "https:" &&
        finalUrl.hostname.toLowerCase() ===
          requestedUrl.hostname.toLowerCase() &&
        isCustomerDomainHostname(finalUrl.hostname) &&
        (headerVersion === expectedVersionId || metaVersion === expectedVersionId),
      versionId: headerVersion ?? metaVersion ?? null,
      hostname: finalUrl.hostname.toLowerCase(),
    };
  } finally {
    clearTimeout(timeout);
  }
}

function deliveredAlertEvidence(
  manifest: FirstCustomerProductionManifest,
  alerts: Array<{
    id: string;
    kind: string;
    status: string;
    deliveredAt: Date | null;
  }>,
) {
  const expected = [
    [manifest.alerts.checkout.alertId, "CHECKOUT_WEBHOOK_FAILURE"],
    [manifest.alerts.publish.alertId, "PUBLISH_FAILURE"],
    [manifest.alerts.publicSite.alertId, "PUBLIC_SITE_HEALTH_FAILURE"],
  ];
  return expected.every(([id, kind]) =>
    alerts.some(
      (alert) =>
        alert.id === id &&
        alert.kind === kind &&
        alert.status === "DELIVERED" &&
        Boolean(alert.deliveredAt),
    ),
  );
}

function checks<T extends readonly string[]>(
  names: T,
  values: Record<T[number], boolean>,
): Record<T[number], boolean> {
  return Object.fromEntries(
    names.map((name) => [name, values[name as T[number]] === true]),
  ) as Record<T[number], boolean>;
}

function metadata(value: unknown): Metadata {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Metadata)
    : {};
}

function isDigest(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}

function integrationDigestFromUnknown(value: unknown): string | null {
  if (!Array.isArray(value)) return null;
  const integrations: Array<{
    type: string;
    url: string;
    enabled: boolean;
  }> = [];
  for (const item of value) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return null;
    const record = item as Record<string, unknown>;
    if (
      typeof record.type !== "string" ||
      typeof record.url !== "string" ||
      typeof record.enabled !== "boolean"
    ) {
      return null;
    }
    integrations.push({
      type: record.type,
      url: record.url,
      enabled: record.enabled,
    });
  }
  return integrationUrlDigest(integrations);
}

function assertProductionConfiguration(
  manifest: FirstCustomerProductionManifest,
) {
  const databaseUrl = process.env.DATABASE_URL;
  const stripeKey = process.env.STRIPE_SECRET_KEY;
  const priceId = process.env.STRIPE_PRICE_ID;
  const evidencePublicKey = process.env.FIRST_CUSTOMER_EVIDENCE_PUBLIC_KEY;
  if (!databaseUrl || !stripeKey || !priceId || !evidencePublicKey) {
    throw new VerificationFailure("production_configuration_missing");
  }
  const database = new URL(databaseUrl);
  if (
    !["postgres:", "postgresql:"].includes(database.protocol) ||
    ["localhost", "127.0.0.1", "::1"].includes(database.hostname)
  ) {
    throw new VerificationFailure("production_database_invalid");
  }
  if (!isStripeLiveApiKey(stripeKey) || !priceId.startsWith("price_")) {
    throw new VerificationFailure("live_stripe_configuration_required");
  }
  const publicUrl = new URL(manifest.publicUrl);
  const configuredPlatformHostnames = (process.env.PLATFORM_HOSTNAMES ?? "")
    .split(",")
    .map((hostname) => hostname.trim())
    .filter(Boolean);
  if (
    publicUrl.protocol !== "https:" ||
    ["localhost", "127.0.0.1", "::1"].includes(publicUrl.hostname) ||
    !isCustomerDomainHostname(
      publicUrl.hostname,
      configuredPlatformHostnames,
    )
  ) {
    throw new VerificationFailure("public_https_url_required");
  }
}

async function loadManifest(input: { manifestPath: string }) {
  const source =
    input.manifestPath === "-"
      ? await readManifestFromStdin()
      : await readFile(input.manifestPath, "utf8");
  const payload = JSON.parse(source);
  const parsed = firstCustomerProductionManifestSchema.safeParse(payload);
  if (!parsed.success) {
    throw new VerificationFailure(
      `manifest_invalid:${parsed.error.issues
        .map((issue) => issue.path.join("."))
        .filter(Boolean)
        .slice(0, 8)
        .join(",")}`,
    );
  }
  return parsed.data;
}

async function readManifestFromStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 1_000_000) {
      throw new VerificationFailure("manifest_too_large");
    }
    chunks.push(buffer);
  }
  if (size === 0) throw new VerificationFailure("manifest_required");
  return Buffer.concat(chunks).toString("utf8");
}

function parseArguments(args: string[]): { manifestPath: string } {
  let environment: string | undefined;
  let manifestPath: string | undefined;
  let execute = false;
  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index];
    if (argument === "--execute") {
      execute = true;
      continue;
    }
    if (argument === "--environment") {
      environment = args[index + 1];
      index += 1;
      continue;
    }
    if (argument === "--manifest") {
      manifestPath = args[index + 1];
      index += 1;
      continue;
    }
    throw new VerificationFailure("invalid_arguments");
  }
  if (environment !== "production") {
    throw new VerificationFailure("production_environment_required");
  }
  if (!execute) throw new VerificationFailure("execute_confirmation_required");
  if (!manifestPath) throw new VerificationFailure("manifest_required");
  return { manifestPath };
}

function safeFailureCode(error: unknown): string {
  if (error instanceof VerificationFailure) return error.code;
  if (error instanceof SyntaxError) return "manifest_json_invalid";
  return "evidence_source_unavailable";
}
