"use client";

import { useState } from "react";
import {
  Check,
  Clock3,
  ExternalLink,
  LoaderCircle,
  X,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Textarea } from "@/components/ui/textarea";
import type { SourceMonitoringDashboardDto } from "@/lib/source-monitoring-diff";

export function SourceMonitoringPanel({
  siteSlug,
  initial,
  demo = false,
  draftRevision,
  hasUnsavedChanges,
  onAcceptedDraft,
}: {
  siteSlug: string;
  initial: SourceMonitoringDashboardDto;
  demo?: boolean;
  draftRevision: number;
  hasUnsavedChanges: boolean;
  onAcceptedDraft?: (input: { revision: number; draft: unknown }) => void;
}) {
  const [suggestions, setSuggestions] = useState(initial.suggestions);
  const [editing, setEditing] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      initial.suggestions.map((suggestion) => [
        suggestion.id,
        JSON.stringify(suggestion.suggestedValue, null, 2),
      ]),
    ),
  );
  const [updating, setUpdating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function review(id: string, action: "accept" | "reject") {
    if (demo) return;
    if (action === "accept" && hasUnsavedChanges) {
      setError(
        "Save or discard your current draft edits before accepting a monitored change.",
      );
      return;
    }
    setUpdating(id);
    setError(null);
    try {
      const editedValue =
        action === "accept" ? JSON.parse(editing[id] ?? "null") : undefined;
      const response = await fetch(
        `/api/sites/${encodeURIComponent(siteSlug)}/source-monitoring/suggestions/${encodeURIComponent(id)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            action,
            editedValue,
            ...(action === "accept" ? { expectedRevision: draftRevision } : {}),
          }),
        },
      );
      const result = (await response.json()) as {
        error?: string;
        revision?: number;
        draft?: unknown;
      };
      const acceptedRevision = result.revision;
      if (!response.ok) {
        throw new Error(result.error ?? "Suggestion review failed");
      }
      if (
        action === "accept" &&
        (typeof acceptedRevision !== "number" ||
          !Number.isInteger(acceptedRevision))
      ) {
        throw new Error("Suggestion review did not return a draft revision");
      }
      setSuggestions((current) =>
        current.filter((suggestion) => suggestion.id !== id),
      );
      if (action === "accept") {
        if (typeof acceptedRevision !== "number") {
          throw new Error("Suggestion review did not return a draft revision");
        }
        if (onAcceptedDraft) {
          if (result.draft === undefined) {
            throw new Error("Suggestion review did not return the accepted draft");
          }
          onAcceptedDraft({ revision: acceptedRevision, draft: result.draft });
        } else {
          // The operator surface has no local draft editor to reconcile.
          window.location.reload();
        }
      }
    } catch (caught) {
      setError(
        caught instanceof SyntaxError
          ? "The edited JSON is not valid."
          : caught instanceof Error
            ? caught.message
            : "Suggestion review failed",
      );
    } finally {
      setUpdating(null);
    }
  }

  return (
    <div>
      <div className="flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
            Source monitoring
          </p>
          <h2 className="font-display mt-2 text-4xl tracking-[-0.04em]">
            Changes wait for your approval.
          </h2>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            We re-check the original website and known links. Suggestions update
            only the private draft; publishing always remains a separate action.
          </p>
        </div>
        <Badge variant={suggestions.length > 0 ? "secondary" : "outline"}>
          {suggestions.length} awaiting review
        </Badge>
      </div>

      <div className="mt-8 grid gap-4 md:grid-cols-3">
        <StatusCard
          label="Cadence"
          value={
            initial.cadenceDays
              ? `Every ${initial.cadenceDays} days`
              : "Not scheduled"
          }
        />
        <StatusCard
          label="Last successful check"
          value={formatDateTime(initial.lastSuccessAt)}
        />
        <StatusCard
          label="Next check"
          value={formatDateTime(initial.nextRunAt)}
        />
      </div>
      {initial.lastFailureAt ? (
        <p className="mt-4 text-xs text-amber-700" role="status">
          The last failed check was {formatDateTime(initial.lastFailureAt)}.
          The durable workflow will retry safely.
        </p>
      ) : null}
      {initial.latestRun?.failedSourceCount ? (
        <p className="mt-4 text-xs text-amber-700" role="status">
          {initial.latestRun.failedSourceCount} known link
          {initial.latestRun.failedSourceCount === 1 ? "" : "s"} could not be
          checked during the latest run. Successful evidence is still available
          below.
        </p>
      ) : null}
      {initial.latestRun?.notificationFailureCode ? (
        <p className="mt-4 text-xs text-amber-700" role="status">
          The review queue is current, but the email notification was not
          delivered. Operators can still review the same suggestions here.
        </p>
      ) : null}
      {error ? (
        <p className="mt-4 text-sm text-destructive" role="alert">
          {error}
        </p>
      ) : null}

      <div className="mt-8 space-y-5">
        {suggestions.map((suggestion) => (
          <Card key={suggestion.id}>
            <CardHeader className="gap-3 sm:flex-row sm:items-start sm:justify-between">
              <div>
                <CardTitle>{fieldLabel(suggestion.field)}</CardTitle>
                <p className="mt-1 font-mono text-[11px] text-muted-foreground">
                  {suggestion.path}
                </p>
              </div>
              <Badge variant="outline">Suggestion only</Badge>
            </CardHeader>
            <CardContent className="space-y-4">
              <div>
                <p className="mb-2 text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                  Proposed private-draft value
                </p>
                <Textarea
                  value={editing[suggestion.id] ?? ""}
                  onChange={(event) =>
                    setEditing((current) => ({
                      ...current,
                      [suggestion.id]: event.target.value,
                    }))
                  }
                  className="min-h-40 font-mono text-xs"
                  aria-label={`Edit ${fieldLabel(suggestion.field)} suggestion`}
                />
              </div>
              <div className="rounded-xl border bg-muted/30 p-4">
                <p className="text-xs font-semibold">Source evidence</p>
                <div className="mt-3 space-y-3">
                  {suggestion.evidence.map((evidence, index) => (
                    <div key={`${evidence.contentDigest}-${index}`}>
                      <a
                        href={evidence.url}
                        target="_blank"
                        rel="noreferrer"
                        className="inline-flex items-center gap-1 text-xs font-medium text-primary"
                      >
                        Open source <ExternalLink className="size-3" />
                      </a>
                      <p className="mt-1 text-xs leading-5 text-muted-foreground">
                        {evidence.excerpt}
                      </p>
                    </div>
                  ))}
                </div>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  variant="outline"
                  onClick={() => void review(suggestion.id, "reject")}
                  disabled={updating === suggestion.id || demo}
                >
                  {updating === suggestion.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <X />
                  )}
                  Reject
                </Button>
                <Button
                  onClick={() => void review(suggestion.id, "accept")}
                  disabled={updating === suggestion.id || demo}
                >
                  {updating === suggestion.id ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Check />
                  )}
                  Accept edited value
                </Button>
              </div>
            </CardContent>
          </Card>
        ))}
        {suggestions.length === 0 ? (
          <Card>
            <CardContent className="flex items-center gap-3 py-8">
              <Clock3 className="size-5 text-muted-foreground" />
              <div>
                <p className="font-medium">Nothing needs review.</p>
                <p className="mt-1 text-xs text-muted-foreground">
                  Real run and success timestamps appear above after the first
                  scheduled check.
                </p>
              </div>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

function StatusCard({ label, value }: { label: string; value: string }) {
  return (
    <Card>
      <CardContent>
        <p className="text-xs uppercase tracking-[0.12em] text-muted-foreground">
          {label}
        </p>
        <p className="mt-2 font-medium">{value}</p>
      </CardContent>
    </Card>
  );
}

function formatDateTime(value: string | null) {
  return value
    ? new Intl.DateTimeFormat("en", {
        dateStyle: "medium",
        timeStyle: "short",
      }).format(new Date(value))
    : "No completed run yet";
}

function fieldLabel(value: string) {
  return (
    {
      MENU: "Catalog changes",
      CONTACT: "Contact details",
      HOURS: "Business hours",
      LINKS: "External links",
    }[value] ?? value
  );
}
