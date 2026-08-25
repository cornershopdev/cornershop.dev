"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import {
  CircleCheck,
  Copy,
  CreditCard,
  Globe2,
  LoaderCircle,
  RefreshCcw,
  RotateCcw,
  Trash2,
  TriangleAlert,
} from "lucide-react";
import type { DomainSetup } from "@/app/dashboard/dashboard-types";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { BillingAccess } from "@/lib/billing-access";
import {
  OWNER_OPERATION_COPY,
  UNAVAILABLE_OWNER_OPERATION_IDS,
  isOwnerOperationEnabled,
  ownerOperationUnavailableMessage,
  type ClientPublicationHistoryItem,
  type OwnerPaidOperationsHookInput,
  type RecordPublishedVersionInput,
} from "@/lib/owner-operations";
import type {
  OwnerOperationId,
  OwnerOperationState,
  VerticalOwnerOperations,
} from "@/lib/verticals/types";

export function useOwnerPaidOperations(input: OwnerPaidOperationsHookInput) {
  const [publicationHistory, setPublicationHistory] = useState(
    input.initialPublicationHistory,
  );
  const currentPublished = publicationHistory.find((item) => item.current);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(
    currentPublished?.version ?? null,
  );
  const [rollbackLoading, setRollbackLoading] = useState<string | null>(null);
  const [portalLoading, setPortalLoading] = useState(false);
  const [domain, setDomain] = useState("");
  const [domainSetup, setDomainSetup] = useState<DomainSetup | null>(null);
  const [domainError, setDomainError] = useState<string | null>(null);
  const [domainNotice, setDomainNotice] = useState<string | null>(null);
  const [domainLoading, setDomainLoading] = useState(false);
  const [operationError, setOperationError] = useState<string | null>(null);

  const canLoadDomain =
    isOwnerOperationEnabled(input.capabilities.customDomain) && !input.isDemo;

  useEffect(() => {
    if (!canLoadDomain) return;
    let active = true;
    void fetch(`/api/domains?siteSlug=${encodeURIComponent(input.siteSlug)}`, {
      cache: "no-store",
    })
      .then(async (response) => {
        const result = (await response.json()) as {
          domains?: DomainSetup[];
          error?: string;
        };
        if (!response.ok) {
          throw new Error(result.error ?? "Could not load domain");
        }
        if (!active || !result.domains?.[0]) return;
        setDomainSetup(result.domains[0]);
        setDomain(result.domains[0].hostname);
      })
      .catch((caught: unknown) => {
        if (active) {
          setDomainError(
            caught instanceof Error ? caught.message : "Could not load domain",
          );
        }
      });
    return () => {
      active = false;
    };
  }, [canLoadDomain, input.siteSlug]);

  const liveUrl =
    domainSetup?.verified && domainSetup.hostname
      ? `https://${domainSetup.hostname}`
      : input.platformUrl;
  const isPublished =
    publishedVersion !== null ||
    publicationHistory.some((item) => item.current);

  async function openBillingPortal() {
    setPortalLoading(true);
    setOperationError(null);
    try {
      const response = await fetch("/api/billing/portal", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteSlug: input.siteSlug }),
      });
      const result = (await response.json()) as {
        url?: string;
        error?: string;
      };
      if (!response.ok || !result.url) {
        throw new Error(result.error ?? "Billing portal could not open");
      }
      window.location.assign(result.url);
    } catch (caught) {
      setOperationError(
        caught instanceof Error
          ? caught.message
          : "Billing portal could not open",
      );
      setPortalLoading(false);
    }
  }

  function recordPublished(published: RecordPublishedVersionInput) {
    setPublishedVersion(published.version);
    setPublicationHistory((current) => [
      {
        id: published.id,
        version: published.version,
        publishedAt: published.publishedAt,
        changeSummary: published.changeSummary,
        current: true,
        theme: published.theme,
      },
      ...current.map((item) => ({ ...item, current: false })),
    ]);
  }

  function markDraftUnpublished() {
    setPublishedVersion(null);
  }

  async function rollback(siteVersionId: string) {
    if (!isOwnerOperationEnabled(input.capabilities.publicationMutation)) {
      setOperationError(
        ownerOperationUnavailableMessage(
          "publicationMutation",
          input.capabilities.publicationMutation === "enabled"
            ? "gated"
            : input.capabilities.publicationMutation,
        ),
      );
      return;
    }
    const target = publicationHistory.find((item) => item.id === siteVersionId);
    if (!target || target.current) return;
    if (
      !window.confirm(
        `Restore the public site to version ${target.version}? Your private draft will not change.`,
      )
    ) {
      return;
    }

    setRollbackLoading(siteVersionId);
    setOperationError(null);
    try {
      const response = await fetch(`/api/sites/${input.siteSlug}/rollback`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ siteVersionId }),
      });
      const result = (await response.json()) as {
        error?: string;
        published?: RecordPublishedVersionInput;
      };
      if (!response.ok || !result.published) {
        throw new Error(result.error ?? "Rollback failed");
      }
      recordPublished({
        ...result.published,
        publishedAt:
          result.published.publishedAt ?? new Date().toISOString(),
        changeSummary: `Rollback to v${target.version}: ${target.changeSummary}`,
        theme: result.published.theme,
      });
    } catch (caught) {
      setOperationError(
        caught instanceof Error ? caught.message : "Rollback failed",
      );
    } finally {
      setRollbackLoading(null);
    }
  }

  async function connectDomain() {
    setDomainLoading(true);
    setDomainError(null);
    setDomainNotice(null);
    try {
      const response = await fetch("/api/domains", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: domain,
          siteSlug: input.siteSlug,
        }),
      });
      const result = (await response.json()) as DomainSetup & {
        error?: string;
      };
      if (!response.ok) throw new Error(result.error ?? "Could not add domain");
      setDomainSetup(result);
      setDomain(result.hostname);
    } catch (caught) {
      setDomainError(
        caught instanceof Error ? caught.message : "Could not add domain",
      );
    } finally {
      setDomainLoading(false);
    }
  }

  async function checkDomain() {
    if (!domainSetup) return;
    setDomainLoading(true);
    setDomainError(null);
    setDomainNotice(null);
    try {
      const response = await fetch("/api/domains", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: domainSetup.hostname,
          siteSlug: input.siteSlug,
        }),
      });
      const result = (await response.json()) as DomainSetup & {
        error?: string;
      };
      if (!response.ok) {
        throw new Error(result.error ?? "Could not check the domain");
      }
      setDomainSetup(result);
    } catch (caught) {
      setDomainError(
        caught instanceof Error
          ? caught.message
          : "Could not check the domain",
      );
    } finally {
      setDomainLoading(false);
    }
  }

  async function removeDomain() {
    if (
      !domainSetup ||
      !window.confirm(
        `Remove ${domainSetup.hostname}? Guests will use ${input.platformUrl.replace(/^https:\/\//, "")} instead.`,
      )
    ) {
      return;
    }
    setDomainLoading(true);
    setDomainError(null);
    setDomainNotice(null);
    try {
      const response = await fetch("/api/domains", {
        method: "DELETE",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          hostname: domainSetup.hostname,
          siteSlug: input.siteSlug,
        }),
      });
      const result = (await response.json()) as {
        removed?: boolean;
        error?: string;
      };
      if (!response.ok || !result.removed) {
        throw new Error(result.error ?? "Could not remove the domain");
      }
      setDomainSetup(null);
      setDomain("");
      setDomainNotice(
        `Domain removed. Guests now use ${input.platformUrl.replace(/^https:\/\//, "")}.`,
      );
    } catch (caught) {
      setDomainError(
        caught instanceof Error
          ? caught.message
          : "Could not remove the domain",
      );
    } finally {
      setDomainLoading(false);
    }
  }

  return {
    capabilities: input.capabilities,
    billingAccess: input.billingAccess,
    brandName: input.brandName,
    platformUrl: input.platformUrl,
    isDemo: Boolean(input.isDemo),
    portalLoading,
    openBillingPortal,
    publicationHistory,
    rollbackLoading,
    rollback,
    recordPublished,
    markDraftUnpublished,
    publishedVersion,
    isPublished,
    liveUrl,
    domain,
    setDomain,
    domainSetup,
    domainError,
    domainNotice,
    domainLoading,
    connectDomain,
    checkDomain,
    removeDomain,
    operationError,
  };
}

export type OwnerPaidOperationsController = ReturnType<
  typeof useOwnerPaidOperations
>;

export function OwnerBillingBanner({
  billingAccess,
  portalLoading,
  onOpenPortal,
}: {
  billingAccess: BillingAccess | null;
  portalLoading: boolean;
  onOpenPortal: () => void;
}) {
  if (!billingAccess || billingAccess.ok) return null;
  return (
    <div className="border-b border-amber-200 bg-amber-50 px-5 py-3 text-center text-sm text-amber-900">
      {billingAccess.message}. Publishing and paid operations are paused.
      {billingAccess.customerPortalAvailable ? (
        <Button
          variant="link"
          className="ml-1 h-auto p-0 text-amber-950 underline"
          onClick={onOpenPortal}
          disabled={portalLoading}
        >
          Manage billing
        </Button>
      ) : null}
    </div>
  );
}

export function OwnerBillingButton({
  billingAccess,
  portalLoading,
  onOpenPortal,
}: {
  billingAccess: BillingAccess | null;
  portalLoading: boolean;
  onOpenPortal: () => void;
}) {
  if (!billingAccess?.ok) return null;
  return (
    <Button
      variant="outline"
      size="sm"
      onClick={onOpenPortal}
      disabled={portalLoading}
    >
      {portalLoading ? <LoaderCircle className="animate-spin" /> : <CreditCard />}
      Billing
    </Button>
  );
}

export function OwnerBillingStateCard({
  billingAccess,
  portalLoading,
  onOpenPortal,
}: {
  billingAccess: BillingAccess | null;
  portalLoading: boolean;
  onOpenPortal: () => void;
}) {
  if (billingAccess?.ok) {
    return (
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            {OWNER_OPERATION_COPY.billing.title}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <p className="text-sm text-muted-foreground">
            Subscription is active on the founding plan.
          </p>
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPortal}
            disabled={portalLoading}
          >
            {portalLoading ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <CreditCard />
            )}
            Manage billing
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {OWNER_OPERATION_COPY.billing.title}
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="text-sm text-muted-foreground" role="status">
          {billingAccess && !billingAccess.ok
            ? billingAccess.message
            : "Subscription state is not available for this session."}
        </p>
        {billingAccess &&
        !billingAccess.ok &&
        billingAccess.customerPortalAvailable ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onOpenPortal}
            disabled={portalLoading}
          >
            Manage billing
          </Button>
        ) : null}
      </CardContent>
    </Card>
  );
}

export function OwnerPublicationHistoryCard({
  history,
  rollbackLoading,
  mutationEnabled,
  mutationState,
  isDemo,
  onRollback,
}: {
  history: ClientPublicationHistoryItem[];
  rollbackLoading: string | null;
  mutationEnabled: boolean;
  mutationState: OwnerOperationState;
  isDemo: boolean;
  onRollback: (siteVersionId: string) => void;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">Published history</CardTitle>
        <p className="text-xs leading-5 text-muted-foreground">
          Rollback creates a new immutable version from a previous snapshot.
          Your private draft remains untouched.
        </p>
      </CardHeader>
      <CardContent>
        {!mutationEnabled ? (
          <OwnerUnavailableCard
            operation="publicationMutation"
            state={mutationState === "enabled" ? "gated" : mutationState}
          />
        ) : null}
        {history.length > 0 ? (
          <div className="divide-y">
            {history.map((item) => (
              <div
                key={item.id}
                className="flex flex-col gap-3 py-4 sm:flex-row sm:items-center sm:justify-between"
              >
                <div>
                  <div className="flex flex-wrap items-center gap-2">
                    <p className="text-sm font-semibold">
                      Version {item.version}
                    </p>
                    {item.current ? (
                      <Badge className="bg-emerald-600 text-white">Live</Badge>
                    ) : null}
                    <Badge variant="outline">
                      {item.theme.id} · {item.theme.version}
                    </Badge>
                  </div>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {item.changeSummary} ·{" "}
                    {new Intl.DateTimeFormat(undefined, {
                      dateStyle: "medium",
                      timeStyle: "short",
                    }).format(new Date(item.publishedAt))}
                  </p>
                </div>
                <Button
                  variant="outline"
                  size="sm"
                  disabled={
                    item.current ||
                    rollbackLoading !== null ||
                    isDemo ||
                    !mutationEnabled
                  }
                  onClick={() => onRollback(item.id)}
                >
                  {rollbackLoading === item.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <RotateCcw />
                  )}
                  {item.current ? "Currently live" : "Rollback"}
                </Button>
              </div>
            ))}
          </div>
        ) : (
          <p className="text-sm text-muted-foreground">
            Publish the site once to start immutable version history.
          </p>
        )}
      </CardContent>
    </Card>
  );
}

export function OwnerDomainPanel({
  brandName,
  platformUrl,
  liveUrl,
  domain,
  domainSetup,
  domainError,
  domainNotice,
  domainLoading,
  enabled,
  state,
  onDomainChange,
  onConnect,
  onCheck,
  onRemove,
}: {
  brandName: string;
  platformUrl: string;
  liveUrl: string;
  domain: string;
  domainSetup: DomainSetup | null;
  domainError: string | null;
  domainNotice: string | null;
  domainLoading: boolean;
  enabled: boolean;
  state: OwnerOperationState;
  onDomainChange: (value: string) => void;
  onConnect: () => void;
  onCheck: () => void;
  onRemove: () => void;
}) {
  if (!enabled) {
    return (
      <OwnerUnavailableCard
        operation="customDomain"
        state={state === "enabled" ? "gated" : state}
      />
    );
  }

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Your site address</CardTitle>
        </CardHeader>
        <CardContent>
          <p className="text-sm leading-6 text-muted-foreground">
            Guests can open this address as soon as you publish. A custom
            domain below is optional.
          </p>
          <p className="mt-3 font-mono text-sm">
            <Link href={liveUrl} target="_blank" className="underline">
              {liveUrl.replace(/^https:\/\//, "")}
            </Link>
          </p>
        </CardContent>
      </Card>
      <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              Use your own domain (optional)
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Label htmlFor="owner-domain">Domain name</Label>
            <Input
              id="owner-domain"
              value={domain}
              onChange={(event) => onDomainChange(event.target.value)}
              placeholder="yourdomain.com"
              className="mt-2 h-11"
            />
            {domainError ? (
              <p className="mt-3 text-xs text-destructive" role="alert">
                {domainError}
              </p>
            ) : null}
            {domainNotice ? (
              <p className="mt-3 text-xs text-muted-foreground" role="status">
                {domainNotice}
              </p>
            ) : null}
            <Button
              className="mt-4 w-full"
              onClick={onConnect}
              disabled={!domain || domainLoading}
            >
              {domainLoading ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Globe2 />
              )}
              Add domain
            </Button>
            <p className="mt-4 text-xs leading-5 text-muted-foreground">
              Optional. {brandName} authorizes the domain for automatic SSL
              before asking for DNS changes.
            </p>
          </CardContent>
        </Card>
        <Card>
          <CardHeader>
            <CardTitle className="text-base">
              {domainSetup ? "DNS records to copy" : "What happens next"}
            </CardTitle>
          </CardHeader>
          <CardContent>
            {domainSetup ? (
              <div className="space-y-3">
                {domainSetup.records.map((record) => (
                  <div
                    key={`${record.type}-${record.name}`}
                    className="grid grid-cols-[70px_1fr_auto] items-center gap-3 rounded-xl border bg-muted/35 p-3"
                  >
                    <Badge variant="outline">{record.type}</Badge>
                    <div className="min-w-0">
                      <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                        {record.name}
                      </p>
                      <p className="truncate font-mono text-xs">
                        {record.value}
                      </p>
                    </div>
                    <Button
                      variant="ghost"
                      size="icon-sm"
                      onClick={() =>
                        void navigator.clipboard.writeText(record.value)
                      }
                    >
                      <Copy />
                    </Button>
                  </div>
                ))}
                <div className="grid gap-2 rounded-xl border bg-muted/20 p-3 sm:grid-cols-2">
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      DNS
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs font-medium">
                      {domainSetup.verified ? (
                        <CircleCheck className="size-4 text-emerald-500" />
                      ) : (
                        <RefreshCcw className="size-4 text-muted-foreground" />
                      )}
                      {domainSetup.verified
                        ? "Verified"
                        : "Waiting for records"}
                    </p>
                  </div>
                  <div>
                    <p className="text-[10px] uppercase tracking-wide text-muted-foreground">
                      HTTPS
                    </p>
                    <p className="mt-1 flex items-center gap-2 text-xs font-medium">
                      {domainSetup.tls.status === "READY" ? (
                        <CircleCheck className="size-4 text-emerald-500" />
                      ) : domainSetup.tls.status === "ERROR" ? (
                        <TriangleAlert className="size-4 text-amber-500" />
                      ) : (
                        <RefreshCcw className="size-4 text-muted-foreground" />
                      )}
                      {domainSetup.tls.status === "READY"
                        ? "Secure connection ready"
                        : domainSetup.tls.status === "ERROR"
                          ? "Needs attention"
                          : "Certificate pending"}
                    </p>
                  </div>
                  <p className="text-xs leading-5 text-muted-foreground sm:col-span-2">
                    {domainSetup.tls.message}
                  </p>
                </div>
                <Button
                  variant="outline"
                  className="w-full"
                  onClick={onCheck}
                  disabled={domainLoading}
                >
                  <RefreshCcw
                    className={domainLoading ? "animate-spin" : ""}
                  />
                  {domainSetup.verified
                    ? "Check HTTPS again"
                    : "Check DNS again"}
                </Button>
                <Button
                  variant="ghost"
                  className="w-full text-destructive hover:text-destructive"
                  onClick={onRemove}
                  disabled={domainLoading}
                >
                  <Trash2 />
                  Remove domain
                </Button>
                <p className="text-xs leading-5 text-muted-foreground">
                  Removing the domain sends guests back to{" "}
                  {platformUrl.replace(/^https:\/\//, "")}. Your private
                  preview and published version are kept.
                </p>
              </div>
            ) : (
              <ol className="space-y-5 text-sm">
                {[
                  `${brandName} authorizes the domain on the production host.`,
                  "The exact DNS record appears here for copying into your DNS provider.",
                  "Once DNS resolves, SSL is issued and that custom domain becomes the public address.",
                ].map((step, index) => (
                  <li key={step} className="flex gap-3">
                    <span className="grid size-6 shrink-0 place-items-center rounded-full border font-mono text-[10px]">
                      {index + 1}
                    </span>
                    <span className="leading-6 text-muted-foreground">
                      {step}
                    </span>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}

export function OwnerUnavailableCard({
  operation,
  state,
}: {
  operation: OwnerOperationId;
  state: Exclude<OwnerOperationState, "enabled">;
}) {
  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base">
          {OWNER_OPERATION_COPY[operation].title}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-sm text-muted-foreground" role="status">
          {ownerOperationUnavailableMessage(operation, state)}
        </p>
      </CardContent>
    </Card>
  );
}

export function OwnerUnavailableOperations({
  capabilities,
}: {
  capabilities: VerticalOwnerOperations;
}) {
  const unavailable = UNAVAILABLE_OWNER_OPERATION_IDS.filter(
    (id) => !isOwnerOperationEnabled(capabilities[id]),
  );
  if (unavailable.length === 0) return null;
  return (
    <div className="space-y-5">
      {unavailable.map((id) => (
        <OwnerUnavailableCard
          key={id}
          operation={id}
          state={
            capabilities[id] === "enabled" ? "gated" : capabilities[id]
          }
        />
      ))}
    </div>
  );
}

export function OwnerPaidOperationsSection({
  paid,
}: {
  paid: OwnerPaidOperationsController;
}) {
  return (
    <div className="space-y-5">
      {isOwnerOperationEnabled(paid.capabilities.billing) ? (
        <OwnerBillingStateCard
          billingAccess={paid.billingAccess}
          portalLoading={paid.portalLoading}
          onOpenPortal={() => void paid.openBillingPortal()}
        />
      ) : (
        <OwnerUnavailableCard
          operation="billing"
          state={
            paid.capabilities.billing === "enabled"
              ? "gated"
              : paid.capabilities.billing
          }
        />
      )}
      {isOwnerOperationEnabled(paid.capabilities.publicationHistory) ? (
        <OwnerPublicationHistoryCard
          history={paid.publicationHistory}
          rollbackLoading={paid.rollbackLoading}
          mutationEnabled={isOwnerOperationEnabled(
            paid.capabilities.publicationMutation,
          )}
          mutationState={paid.capabilities.publicationMutation}
          isDemo={paid.isDemo}
          onRollback={(siteVersionId) => void paid.rollback(siteVersionId)}
        />
      ) : (
        <OwnerUnavailableCard
          operation="publicationHistory"
          state={
            paid.capabilities.publicationHistory === "enabled"
              ? "gated"
              : paid.capabilities.publicationHistory
          }
        />
      )}
      <OwnerDomainPanel
        brandName={paid.brandName}
        platformUrl={paid.platformUrl}
        liveUrl={paid.liveUrl}
        domain={paid.domain}
        domainSetup={paid.domainSetup}
        domainError={paid.domainError}
        domainNotice={paid.domainNotice}
        domainLoading={paid.domainLoading}
        enabled={isOwnerOperationEnabled(paid.capabilities.customDomain)}
        state={paid.capabilities.customDomain}
        onDomainChange={paid.setDomain}
        onConnect={() => void paid.connectDomain()}
        onCheck={() => void paid.checkDomain()}
        onRemove={() => void paid.removeDomain()}
      />
      <OwnerUnavailableOperations capabilities={paid.capabilities} />
    </div>
  );
}
