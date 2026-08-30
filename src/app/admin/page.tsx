import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import {
  ArrowUpRight,
  Building2,
  CircleDollarSign,
  Inbox,
  Users,
} from "lucide-react";
import { ClaimInvitationForm } from "@/app/admin/claim-invitation-form";
import { OperatorLeadForm } from "@/app/admin/operator-lead-form";
import { OperatorOutreachPanel } from "@/app/admin/operator-outreach-panel";
import { configuredOutreachController } from "@/lib/electronic-outreach-eligibility";
import { OperatorReviewPanel } from "@/app/admin/operator-review-panel";
import { OutreachPauseControl } from "@/app/admin/outreach-pause-control";
import { Brand } from "@/components/brand";
import { AccountActions } from "@/components/account-actions";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSuperadminAccess } from "@/lib/authorization";
import { FACTORY_BRAND } from "@/lib/brand";
import { isVerticalOutreachConfigured } from "@/lib/lead-generation/registry";
import {
  listVerticalIds,
  resolveVerticalConfig,
} from "@/lib/verticals/registry";
import { getCurrentSession } from "@/lib/current-session";
import {
  getOperatorDashboardData,
  type OperatorSiteRow,
} from "@/lib/operator-dashboard";

export const dynamic = "force-dynamic";

export const metadata: Metadata = {
  title: "Operator console",
  robots: { index: false, follow: false },
};

export default async function AdminPage() {
  const session = await getCurrentSession();
  if (!session) redirect("/sign-in");

  const operator = await getSuperadminAccess();
  if (!operator) notFound();

  const data = await getOperatorDashboardData();

  return (
    <main className="min-h-screen bg-[#f3f1eb]">
      <header className="sticky top-0 z-50 flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Brand {...FACTORY_BRAND} href="/admin" />
          <Badge variant="outline">Operator console</Badge>
        </div>
        <div className="flex items-center gap-3">
          <span className="hidden text-xs text-muted-foreground md:block">
            {operator.email}
          </span>
          {session.siteSlug ? (
            <Button
              render={<Link href="/dashboard" />}
              variant="outline"
              size="sm"
            >
              Client dashboard
            </Button>
          ) : null}
          <AccountActions canSwitch />
          <Button
            render={<Link href="/admin/inbox" />}
            variant="outline"
            size="sm"
          >
            Outreach inbox
          </Button>
          <Button
            render={<Link href="/admin/auth" />}
            variant="outline"
            size="sm"
          >
            Sign-in delivery
          </Button>
        </div>
      </header>

      <div className="mx-auto max-w-[1500px] px-4 py-8 md:px-7 lg:px-10">
        <div className="flex flex-col justify-between gap-4 md:flex-row md:items-end">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Portfolio operations
            </p>
            <h1 className="font-display mt-2 text-4xl tracking-[-0.04em] md:text-5xl">
              Leads, customers and requests.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              A platform view across every generated site. Stored contact
              details appear only inside this dual-gated operator console, and
              no outreach is sent without a reviewed preview and confirmation.
            </p>
          </div>
          <Badge variant="secondary">Latest 200 sites</Badge>
        </div>

        <section className="mt-8 grid gap-4 md:grid-cols-2 xl:grid-cols-5">
          <MetricCard
            label="Generated leads"
            value={data.totals.sites}
            detail="All site prospects"
            icon={<Building2 />}
          />
          <MetricCard
            label="Signed up"
            value={data.totals.signedUpSites}
            detail="Sites with an owner"
            icon={<Users />}
          />
          <MetricCard
            label="Active subs"
            value={data.totals.activeSubscriptions}
            detail="Paying organizations"
            icon={<CircleDollarSign />}
          />
          <MetricCard
            label="Booking leads"
            value={data.totals.bookingRequests}
            detail="Stored requests"
            icon={<Inbox />}
          />
          <MetricCard
            label="Needs action"
            value={data.totals.pendingBookingRequests}
            detail="Awaiting contact"
            icon={<Inbox />}
          />
        </section>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Create or reopen a lead</CardTitle>
            <p className="text-xs text-muted-foreground">
              Authorized operator imports persist directly into the private
              preview workflow. Existing unclaimed leads reopen without
              replacing reviewed content.
            </p>
          </CardHeader>
          <CardContent>
            <OperatorLeadForm
              verticalOptions={listVerticalIds().map((vertical) => ({
                id: vertical,
                label: resolveVerticalConfig(vertical).marketing.brand.name,
                audience: resolveVerticalConfig(vertical).marketing.audience,
              }))}
            />
          </CardContent>
        </Card>

        <Card className="mt-6">
          <CardHeader>
            <CardTitle>Niche outreach</CardTitle>
          </CardHeader>
          <CardContent>
            <OutreachPauseControl initialPaused={data.outreachPaused} />
          </CardContent>
        </Card>

        <Card className="mt-6 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle>Live-site performance</CardTitle>
            <p className="text-xs text-muted-foreground">
              Cookieless traffic from verified customer domains only. Preview
              and factory traffic is excluded.
            </p>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[720px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Window
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Visits
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    CTA visitors
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    CTA rate
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Live booking leads
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Lead conversion
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.analytics.windows.map((window) => (
                  <tr key={window.days}>
                    <td className="px-5 py-4 font-medium">
                      {window.days} days
                    </td>
                    <td className="px-5 py-4">{formatNumber(window.visits)}</td>
                    <td className="px-5 py-4">
                      {formatNumber(window.ctaVisitors)}
                    </td>
                    <td className="px-5 py-4">
                      {formatPercent(window.ctaRate)}
                    </td>
                    <td className="px-5 py-4">
                      {formatNumber(window.bookingLeads)}
                    </td>
                    <td className="px-5 py-4">
                      {formatPercent(window.leadRate)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </CardContent>
        </Card>

        <Card className="mt-6 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle>All sites</CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[2600px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Business
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Score
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    City
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Discovered
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Local SEO
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Lifecycle
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Signup
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Subscription
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Source monitoring
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Import
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Booking leads
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Visits · 30d
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Lead conv. · 30d
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Created
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Blocker rollup
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Content review
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Outreach
                  </th>
                  <th scope="col" className="px-5 py-3 font-medium">
                    Concierge claim
                  </th>
                  <th scope="col" className="px-5 py-3 text-right font-medium">
                    Site
                  </th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {data.sites.map((site) => (
                  <SiteRow
                    key={site.id}
                    site={site}
                    outreachPaused={data.outreachPaused}
                  />
                ))}
              </tbody>
            </table>
            {data.sites.length === 0 ? (
              <p className="px-5 py-12 text-center text-sm text-muted-foreground">
                No generated sites yet.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function MetricCard({
  label,
  value,
  detail,
  icon,
}: {
  label: string;
  value: number;
  detail: string;
  icon: React.ReactNode;
}) {
  return (
    <Card>
      <CardContent className="pt-1">
        <div className="flex items-center justify-between text-muted-foreground">
          <span className="text-xs font-medium uppercase tracking-[0.12em]">
            {label}
          </span>
          <span className="[&>svg]:size-4">{icon}</span>
        </div>
        <p className="mt-5 text-3xl font-semibold tracking-[-0.04em]">
          {value}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">{detail}</p>
      </CardContent>
    </Card>
  );
}

function SiteRow({
  site,
  outreachPaused,
}: {
  site: OperatorSiteRow;
  outreachPaused: boolean;
}) {
  const previewHref = `/preview/${site.slug}`;
  return (
    <tr
      id={`outreach-${site.slug}`}
      className="scroll-mt-20 align-top hover:bg-muted/20 target:bg-primary/10"
    >
      <td className="px-5 py-4">
        <p className="font-medium">{site.name}</p>
        <p className="mt-1 font-mono text-[11px] text-muted-foreground">
          {site.slug}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {site.vertical.toLowerCase()}
          {site.verifiedDomain ? ` · ${site.verifiedDomain}` : ""}
        </p>
        <p className="mt-1 text-[11px] text-muted-foreground">
          TLS: {humanize(site.tlsReadiness)}
        </p>
      </td>
      <td className="px-5 py-4">
        {site.discovery ? (
          <>
            <p className="font-medium">{site.discovery.score}</p>
            <p className="mt-1 max-w-56 text-[11px] text-muted-foreground">
              {site.discovery.reasons.slice(0, 2).join(" · ") ||
                "No scoring deductions"}
            </p>
          </>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-4">
        {site.discovery?.city ?? (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-4 text-muted-foreground">
        {site.discovery?.discoveredAt
          ? formatDate(site.discovery.discoveredAt)
          : "—"}
      </td>
      <td className="px-5 py-4">
        {site.localSeoAudit ? (
          <div className="grid min-w-52 gap-1">
            <p className="font-medium">{site.localSeoAudit.score}</p>
            {site.localSeoAudit.topFixes.slice(0, 5).map((fix) => (
              <p key={fix.id} className="text-[11px] text-muted-foreground">
                {fix.title}
              </p>
            ))}
          </div>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-4">
        <Badge variant="outline">{humanize(site.status)}</Badge>
      </td>
      <td className="px-5 py-4">
        <p className="font-medium">
          {site.ownerCount > 0 ? "Signed up" : "Prospect"}
        </p>
        <p className="mt-1 text-xs text-muted-foreground">
          {site.ownerCount > 0
            ? `${site.ownerCount} member${site.ownerCount === 1 ? "" : "s"}`
            : "No owner yet"}
        </p>
      </td>
      <td className="px-5 py-4">
        {site.subscriptionStatus ? (
          <Badge
            variant={
              site.subscriptionStatus === "ACTIVE" ? "secondary" : "outline"
            }
          >
            {humanize(site.subscriptionStatus)}
          </Badge>
        ) : (
          <span className="text-muted-foreground">—</span>
        )}
      </td>
      <td className="px-5 py-4">
        <Button
          render={<Link href={`/admin/source-monitoring/${site.slug}`} />}
          variant="outline"
          size="sm"
        >
          {site.pendingSourceSuggestionCount > 0
            ? `${site.pendingSourceSuggestionCount} to review`
            : "Review"}
        </Button>
        <p className="mt-1 text-[11px] text-muted-foreground">
          {site.sourceMonitorLastSuccessAt
            ? `Last success ${formatDate(site.sourceMonitorLastSuccessAt)}`
            : "No successful run"}
        </p>
      </td>
      <td className="px-5 py-4">
        <p>
          {site.latestImportStatus ? humanize(site.latestImportStatus) : "—"}
        </p>
        {site.latestImportAt ? (
          <p className="mt-1 text-xs text-muted-foreground">
            {formatDate(site.latestImportAt)}
          </p>
        ) : null}
      </td>
      <td className="px-5 py-4">
        <p className="font-medium">{site.bookingRequestCount}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {site.pendingBookingRequestCount} awaiting contact
        </p>
      </td>
      <td className="px-5 py-4">
        <p className="font-medium">{formatNumber(site.analytics30d.visits)}</p>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatNumber(site.analytics30d.ctaVisitors)} CTA visitors
        </p>
      </td>
      <td className="px-5 py-4 font-medium">
        {formatPercent(site.analytics30d.leadRate)}
      </td>
      <td className="px-5 py-4 text-muted-foreground">
        {formatDate(site.createdAt)}
      </td>
      <td className="px-5 py-4">
        <div className="grid min-w-64 gap-1.5">
          {site.blockers.map((blocker) => (
            <div
              key={blocker.stage}
              className="flex items-start justify-between gap-3"
              title={blocker.detail}
            >
              <span className="text-xs">{blocker.label}</span>
              <Badge
                variant={
                  blocker.status === "complete"
                    ? "secondary"
                    : blocker.status === "ready"
                      ? "outline"
                      : "destructive"
                }
              >
                {blocker.status}
              </Badge>
            </div>
          ))}
        </div>
      </td>
      <td className="px-5 py-4">
        <OperatorReviewPanel
          slug={site.slug}
          reviewedAt={site.reviewedAt}
          notes={site.notes}
          contentReview={site.contentReview}
          eligibility={site.eligibility}
        />
      </td>
      <td className="px-5 py-4">
        {isVerticalOutreachConfigured(site.vertical) ? (
          <OperatorOutreachPanel
            slug={site.slug}
            vertical={site.vertical}
            contactEmail={site.contactEmail}
            outreachMessages={site.outreachMessages}
            outreachDispatch={site.outreachDispatch}
            reviewedAt={site.reviewedAt}
            eligibility={site.eligibility}
            outreachPaused={outreachPaused}
            leadOutreachPaused={site.outreachPaused}
            expectedController={configuredOutreachController()}
          />
        ) : (
          <span className="text-xs text-muted-foreground">
            Sender not configured
          </span>
        )}
      </td>
      <td className="px-5 py-4">
        {site.ownerCount === 0 ? (
          <ClaimInvitationForm
            siteSlug={site.slug}
            invitation={site.invitation}
          />
        ) : (
          <span className="text-muted-foreground">Owned</span>
        )}
      </td>
      <td className="px-5 py-4 text-right">
        <Button
          render={<Link href={previewHref} target="_blank" />}
          variant="ghost"
          size="sm"
        >
          Preview <ArrowUpRight />
        </Button>
      </td>
    </tr>
  );
}

function humanize(value: string): string {
  return value
    .toLowerCase()
    .replaceAll("_", " ")
    .replace(/^\w/, (character) => character.toUpperCase());
}

function formatDate(value: Date): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
  }).format(value);
}

function formatNumber(value: number): string {
  return new Intl.NumberFormat("en").format(value);
}

function formatPercent(value: number): string {
  return new Intl.NumberFormat("en", {
    style: "percent",
    maximumFractionDigits: 1,
  }).format(value);
}
