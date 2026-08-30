import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { getSuperadminAccess } from "@/lib/authorization";
import { getCurrentSession } from "@/lib/current-session";
import {
  getOutreachInbox,
  OUTREACH_INBOX_PAGE_SIZE,
} from "@/lib/outreach-inbox";

export const dynamic = "force-dynamic";
export const metadata: Metadata = {
  title: "Outreach inbox",
  robots: { index: false, follow: false },
};

function formatDate(value: string): string {
  return new Intl.DateTimeFormat("en", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function statusVariant(status: string): "secondary" | "outline" | "destructive" {
  if (status === "DELIVERED" || status === "SENT" || status === "RECEIVED") {
    return "secondary";
  }
  if (status === "FAILED" || status === "BOUNCED" || status === "COMPLAINED") {
    return "destructive";
  }
  return "outline";
}

function SiteThreadLink({
  siteId,
  siteName,
  siteSlug,
}: {
  siteId: string;
  siteName: string | null;
  siteSlug: string | null;
}) {
  const label = siteName ?? siteId;
  return siteSlug ? (
    <Link
      href={`/admin#outreach-${siteSlug}`}
      className="font-medium text-primary underline-offset-4 hover:underline"
    >
      {label}
    </Link>
  ) : (
    label
  );
}

export default async function OutreachInboxPage() {
  if (!(await getCurrentSession())) redirect("/sign-in");
  if (!(await getSuperadminAccess())) notFound();
  const inbox = await getOutreachInbox();

  const summary = [
    { label: "Sends", value: inbox.counts.sends },
    { label: "Replies", value: inbox.counts.replies },
    { label: "Sequences", value: inbox.counts.sequences },
    { label: "Failed messages", value: inbox.counts.failedMessages },
    { label: "Stalled forwards", value: inbox.counts.stalledForwards },
  ];

  return (
    <main className="min-h-screen bg-[#f3f1eb] px-4 py-10">
      <section className="mx-auto max-w-6xl">
        <div className="flex flex-wrap items-end justify-between gap-4">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
              Operator console
            </p>
            <h1 className="font-display mt-2 text-5xl tracking-[-0.04em]">
              Outreach inbox.
            </h1>
            <p className="mt-3 text-sm text-muted-foreground">
              Masked counterparties, delivery outcomes, and dispatch state. Read
              only, and message bodies are never loaded.
            </p>
          </div>
          <Button render={<Link href="/admin" />} variant="outline">
            Back
          </Button>
        </div>

        <div className="mt-8 grid grid-cols-2 gap-3 md:grid-cols-5">
          {summary.map((item) => (
            <Card key={item.label} className="py-0">
              <CardContent className="px-5 py-4">
                <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
                  {item.label}
                </p>
                <p className="mt-1 text-2xl tabular-nums">{item.value}</p>
              </CardContent>
            </Card>
          ))}
        </div>

        <Card className="mt-8 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle>
              Sends and replies (latest {OUTREACH_INBOX_PAGE_SIZE})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[960px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Direction</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3">Counterparty</th>
                  <th className="px-5 py-3">Subject</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Forward</th>
                  <th className="px-5 py-3">Occurred</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inbox.messages.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-4">
                      <Badge variant="outline">
                        {row.direction.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <SiteThreadLink
                        siteId={row.siteId}
                        siteName={row.siteName}
                        siteSlug={row.siteSlug}
                      />
                    </td>
                    <td className="px-5 py-4 font-mono text-xs">
                      {row.counterparty}
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {row.subject ?? "—"}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={statusVariant(row.status)}>
                        {row.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {row.forward
                        ? `${row.forward.deliveryStatus.toLowerCase()}${
                            row.forward.deliveryFailureCode
                              ? ` (${row.forward.deliveryFailureCode})`
                              : ""
                          }`
                        : "—"}
                    </td>
                    <td className="px-5 py-4">{formatDate(row.occurredAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inbox.messages.length === 0 ? (
              <p className="px-5 py-12 text-center text-muted-foreground">
                No outreach messages yet.
              </p>
            ) : null}
            {inbox.messagesTruncated ? (
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                Showing the most recent {inbox.messages.length} of{" "}
                {inbox.counts.sends + inbox.counts.replies}.
              </p>
            ) : null}
          </CardContent>
        </Card>

        <Card className="mt-8 overflow-hidden py-0">
          <CardHeader className="border-b py-5">
            <CardTitle>
              Sequences (latest {OUTREACH_INBOX_PAGE_SIZE})
            </CardTitle>
          </CardHeader>
          <CardContent className="overflow-x-auto p-0">
            <table className="w-full min-w-[1080px] text-left text-sm">
              <thead className="border-b bg-muted/50 text-xs uppercase tracking-[0.12em] text-muted-foreground">
                <tr>
                  <th className="px-5 py-3">Template</th>
                  <th className="px-5 py-3">Site</th>
                  <th className="px-5 py-3">Recipient</th>
                  <th className="px-5 py-3">Status</th>
                  <th className="px-5 py-3">Follow-up</th>
                  <th className="px-5 py-3">Attempt</th>
                  <th className="px-5 py-3">Reviewed</th>
                  <th className="px-5 py-3">Updated</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {inbox.sequences.map((row) => (
                  <tr key={row.id}>
                    <td className="px-5 py-4 font-mono text-xs">
                      {row.template}
                    </td>
                    <td className="px-5 py-4">
                      <SiteThreadLink
                        siteId={row.siteId}
                        siteName={row.siteName}
                        siteSlug={row.siteSlug}
                      />
                    </td>
                    <td className="px-5 py-4 font-mono text-xs">
                      {row.recipient}
                    </td>
                    <td className="px-5 py-4">
                      <Badge variant={statusVariant(row.status)}>
                        {row.status.toLowerCase()}
                      </Badge>
                    </td>
                    <td className="px-5 py-4">
                      <div className="flex flex-wrap gap-1.5">
                        {row.pauseScope ? (
                          <Badge variant="destructive">
                            {row.pauseScope === "global"
                              ? "global paused"
                              : "lead paused"}
                          </Badge>
                        ) : null}
                        {row.inboundStopped ? (
                          <Badge variant="secondary">inbound stopped</Badge>
                        ) : null}
                        {!row.pauseScope && !row.inboundStopped ? (
                          <Badge variant="outline">active</Badge>
                        ) : null}
                      </div>
                    </td>
                    <td className="px-5 py-4 tabular-nums">{row.attempt}</td>
                    <td className="px-5 py-4 text-muted-foreground">
                      {row.reviewedAt ? formatDate(row.reviewedAt) : "—"}
                    </td>
                    <td className="px-5 py-4">{formatDate(row.updatedAt)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {inbox.sequences.length === 0 ? (
              <p className="px-5 py-12 text-center text-muted-foreground">
                No outreach sequences yet.
              </p>
            ) : null}
            {inbox.sequencesTruncated ? (
              <p className="border-t px-5 py-3 text-xs text-muted-foreground">
                Showing the most recent {inbox.sequences.length} of{" "}
                {inbox.counts.sequences}.
              </p>
            ) : null}
          </CardContent>
        </Card>
      </section>
    </main>
  );
}
