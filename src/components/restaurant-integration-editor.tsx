"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  ExternalLink,
  Link2,
  LoaderCircle,
  Plus,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import type { RestaurantDraft } from "@/lib/restaurant";
import {
  integrationPlacement,
  RESTAURANT_INTEGRATION_TYPES,
  type RestaurantIntegrationMutation,
} from "@/lib/restaurant-integration-editor";
import type { MenuValidationIssue } from "@/lib/restaurant-menu-editor";
import { restaurantIntegrationSchema } from "@/lib/verticals/restaurant/schema";

export function RestaurantIntegrationEditor({
  draft,
  dirty,
  saving,
  saveError,
  validationIssues,
  savedRevision,
  canUndo,
  onMutation,
  onTranslationLabelChange,
  onReviewTranslation,
  onUndo,
  onSave,
}: {
  draft: RestaurantDraft;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  validationIssues: MenuValidationIssue[];
  savedRevision: number | null;
  canUndo: boolean;
  onMutation: (
    mutation: RestaurantIntegrationMutation,
    destructive?: boolean,
  ) => void;
  onTranslationLabelChange: (
    locale: string,
    integrationIndex: number,
    label: string,
  ) => void;
  onReviewTranslation: (locale: string) => void;
  onUndo: () => void;
  onSave: () => void;
}) {
  const [activeLocale, setActiveLocale] = useState(draft.defaultLocale);
  const translation = draft.translations.find(
    (candidate) => candidate.locale === activeLocale,
  );
  const canonical = activeLocale === draft.defaultLocale;

  return (
    <div>
      <div className="flex flex-col gap-5 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            Existing systems
          </p>
          <h1 className="font-display mt-2 text-5xl leading-none tracking-[-0.045em]">
            Keep what already works.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Maintain safe link-outs to booking, ordering and delivery. Nothing
            here migrates customer or reservation data.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            disabled={!canUndo}
            onClick={onUndo}
          >
            <Undo2 /> Undo removal
          </Button>
          <Button size="sm" disabled={saving || !dirty} onClick={onSave}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {dirty ? "Save links" : "Saved"}
          </Button>
        </div>
      </div>

      <Card className="mt-8">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Integration locale">
            <Button
              size="sm"
              variant={canonical ? "default" : "outline"}
              onClick={() => setActiveLocale(draft.defaultLocale)}
            >
              {draft.defaultLocale.toUpperCase()} · canonical
            </Button>
            {draft.translations.map((candidate) => (
              <Button
                key={candidate.locale}
                size="sm"
                variant={
                  candidate.locale === activeLocale ? "default" : "outline"
                }
                onClick={() => setActiveLocale(candidate.locale)}
              >
                {candidate.locale.toUpperCase()}
                {candidate.status !== "current" ? (
                  <span className="size-2 rounded-full bg-amber-400" />
                ) : null}
              </Button>
            ))}
          </div>
          <Badge variant={dirty ? "outline" : "secondary"}>
            {dirty
              ? "Unsaved changes"
              : savedRevision
                ? `Draft revision ${savedRevision}`
                : "Draft saved"}
          </Badge>
        </CardContent>
      </Card>

      {saveError ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" /> {saveError}
          </span>
          <Button variant="outline" size="sm" onClick={onSave}>
            Retry
          </Button>
        </div>
      ) : null}

      {validationIssues.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Fix these links before saving:</p>
          <ul className="mt-2 list-disc space-y-1 pl-5">
            {validationIssues.slice(0, 8).map((issue) => (
              <li key={`${issue.path}-${issue.message}`}>
                {issue.path}: {issue.message}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {!canonical && translation ? (
        <Card className="mt-5 border-amber-200">
          <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">
                {translation.locale.toUpperCase()} customer labels
              </p>
              <p className="mt-1 text-xs text-muted-foreground">
                Link type, destination, provider and availability stay
                canonical. Only customer-facing labels are localized.
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Badge variant="outline">{translation.status}</Badge>
              <Button
                size="sm"
                disabled={translation.status === "current"}
                onClick={() => onReviewTranslation(translation.locale)}
              >
                <Check /> Mark reviewed
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5 grid gap-5 xl:grid-cols-[minmax(0,1fr)_280px]">
        <div className="space-y-4">
          {draft.integrations.map((integration, integrationIndex) => (
            <Card
              key={`${activeLocale}-${integrationIndex}`}
              className={!integration.enabled ? "opacity-70" : undefined}
            >
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="flex items-center gap-3">
                  <span className="grid size-10 place-items-center rounded-xl bg-muted">
                    <Link2 className="size-4" />
                  </span>
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium">
                        {canonical
                          ? integration.label
                          : translation?.integrationLabels[
                              integrationIndex
                            ] ?? integration.label}
                      </p>
                      <Badge variant="secondary">
                        {integration.type}
                      </Badge>
                      {!integration.enabled ? (
                        <Badge variant="outline">Hidden publicly</Badge>
                      ) : null}
                    </div>
                    <p className="mt-1 text-xs text-muted-foreground">
                      {integrationPlacement(integration.type).label}
                    </p>
                  </div>
                </div>
                {canonical ? (
                  <Switch
                    aria-label={`Show ${integration.label} publicly`}
                    checked={integration.enabled}
                    onCheckedChange={(enabled) =>
                      onMutation({
                        type: "update",
                        integrationIndex,
                        changes: { enabled },
                      })
                    }
                  />
                ) : null}
              </CardHeader>
              <CardContent>
                {canonical ? (
                  <>
                    <div className="grid gap-4 md:grid-cols-2">
                      <Field label="Link type">
                        <select
                          id={`integration-type-${integrationIndex}`}
                          className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                          value={integration.type}
                          onChange={(event) =>
                            onMutation({
                              type: "update",
                              integrationIndex,
                              changes: {
                                type: event.target
                                  .value as typeof integration.type,
                              },
                            })
                          }
                        >
                          {RESTAURANT_INTEGRATION_TYPES.map((type) => (
                            <option key={type}>{type}</option>
                          ))}
                        </select>
                      </Field>
                      <Field label="Customer-facing label">
                        <Input
                          id={`integration-label-${integrationIndex}`}
                          value={integration.label}
                          onChange={(event) =>
                            onMutation({
                              type: "update",
                              integrationIndex,
                              changes: { label: event.target.value },
                            })
                          }
                        />
                      </Field>
                    </div>
                    <div className="mt-4 grid gap-4 md:grid-cols-[1fr_180px]">
                      <Field label="HTTPS destination">
                        <Input
                          id={`integration-url-${integrationIndex}`}
                          type="url"
                          inputMode="url"
                          value={integration.url}
                          placeholder="https://provider.example/venue"
                          onChange={(event) =>
                            onMutation({
                              type: "update",
                              integrationIndex,
                              changes: { url: event.target.value },
                            })
                          }
                        />
                      </Field>
                      <div className="grid gap-2">
                        <p className="text-sm leading-none font-medium">
                          Provider identity
                        </p>
                        <div className="flex h-9 items-center rounded-md border bg-muted/40 px-3 text-sm">
                          {integration.provider ?? "Independent link"}
                        </div>
                      </div>
                    </div>
                    <div className="mt-4 flex flex-wrap items-center gap-2">
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Move ${integration.label} up`}
                        disabled={integrationIndex === 0}
                        onClick={() =>
                          onMutation({
                            type: "move",
                            integrationIndex,
                            direction: -1,
                          })
                        }
                      >
                        <ArrowUp />
                      </Button>
                      <Button
                        variant="outline"
                        size="icon-sm"
                        aria-label={`Move ${integration.label} down`}
                        disabled={
                          integrationIndex ===
                          draft.integrations.length - 1
                        }
                        onClick={() =>
                          onMutation({
                            type: "move",
                            integrationIndex,
                            direction: 1,
                          })
                        }
                      >
                        <ArrowDown />
                      </Button>
                      <Button
                        variant="outline"
                        size="sm"
                        onClick={() =>
                          onMutation(
                            { type: "remove", integrationIndex },
                            true,
                          )
                        }
                      >
                        <Trash2 /> Remove
                      </Button>
                      {restaurantIntegrationSchema.safeParse(integration)
                        .success ? (
                        <Button
                          render={
                            <a
                              href={integration.url}
                              target="_blank"
                              rel="noreferrer"
                            />
                          }
                          variant="ghost"
                          size="sm"
                        >
                          Test link <ExternalLink />
                        </Button>
                      ) : null}
                    </div>
                  </>
                ) : (
                  <Field label="Localized customer-facing label">
                    <Input
                      id={`translated-integration-${integrationIndex}`}
                      value={
                        translation?.integrationLabels[integrationIndex] ??
                        integration.label
                      }
                      onChange={(event) =>
                        onTranslationLabelChange(
                          activeLocale,
                          integrationIndex,
                          event.target.value,
                        )
                      }
                    />
                  </Field>
                )}
              </CardContent>
            </Card>
          ))}

          {canonical ? (
            <div className="grid gap-2 sm:grid-cols-4">
              {RESTAURANT_INTEGRATION_TYPES.map((type) => (
                <Button
                  key={type}
                  variant="outline"
                  className="h-12 border-dashed"
                  disabled={draft.integrations.length >= 12}
                  onClick={() =>
                    onMutation({ type: "add", integrationType: type })
                  }
                >
                  <Plus /> Add {type}
                </Button>
              ))}
            </div>
          ) : null}
        </div>

        <Card className="h-fit xl:sticky xl:top-6">
          <CardHeader>
            <p className="font-semibold">Placement preview</p>
            <p className="text-xs leading-5 text-muted-foreground">
              Enabled links occupy these public-site regions. Exact styling
              follows the selected restaurant theme.
            </p>
          </CardHeader>
          <CardContent>
            <div className="overflow-hidden rounded-xl border bg-muted/20">
              {(["header", "content", "footer"] as const).map((region) => {
                const links = draft.integrations.filter(
                  (integration) =>
                    integration.enabled &&
                    integrationPlacement(integration.type).regions.includes(
                      region,
                    ),
                );
                return (
                  <div
                    key={region}
                    className="border-b p-4 last:border-b-0"
                  >
                    <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">
                      {region}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {links.length ? (
                        links.map((integration, index) => (
                          <Badge
                            key={`${integration.type}-${index}`}
                            variant="secondary"
                          >
                            {integration.label}
                          </Badge>
                        ))
                      ) : (
                        <span className="text-xs text-muted-foreground">
                          No external action
                        </span>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
            <p className="mt-3 text-xs leading-5 text-muted-foreground">
              Social links must use an approved provider. Operational links may
              point to the restaurant’s independent HTTPS system.
            </p>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
