"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import {
  ExternalLink,
  LoaderCircle,
  Plus,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import { AccountActions } from "@/components/account-actions";
import { Brand } from "@/components/brand";
import {
  OwnerBillingBanner,
  OwnerBillingButton,
  OwnerPaidOperationsSection,
  useOwnerPaidOperations,
} from "@/components/owner-paid-operations";
import { PhotoLibraryPanel } from "@/components/photo-library-panel";
import { SourceMonitoringPanel } from "@/components/source-monitoring-panel";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { BillingAccess } from "@/lib/billing-access";
import type { BrandIdentity } from "@/lib/brand";
import {
  isOwnerOperationEnabled,
  localServiceOwnerOperations,
  ownerOperationUnavailableMessage,
  type ClientPublicationHistoryItem,
} from "@/lib/owner-operations";
import {
  EMPTY_SOURCE_MONITORING_DASHBOARD,
  type SourceMonitoringDashboardDto,
} from "@/lib/source-monitoring-diff";
import type { VerticalOwnerOperations } from "@/lib/verticals/types";
import {
  canEnableOwnerIntegration,
  createOwnerIntegration,
  formatOwnerDraftIssues,
  mergeOwnerDraftIssues,
  ownerIntegrationFieldPath,
  ownerIntegrationIssueMessage,
  type OwnerIntegrationIssue,
  validateOwnerIntegrations,
  withOwnerIntegrationEnabled,
  withOwnerIntegrationUrl,
  zodIssuesToOwnerIssues,
} from "@/lib/owner-integration";
import {
  localServiceSiteDraftSchema,
  type LocalServiceAttributes,
  type LocalServiceSiteDraft,
} from "@/lib/verticals/local-service/schema";
import {
  OwnerDraftDirtyGuard,
  acknowledgeOwnerDraftSave,
  ownerDraftNavigationProps,
  useOwnerDraftDirtyState,
} from "@/lib/owner-draft-dirty-state";

const tradeTypes: LocalServiceAttributes["tradeType"][] = [
  "plumber",
  "electrician",
  "builder",
  "repair",
  "artisan",
  "general-trades",
];

const availabilityPostures: LocalServiceAttributes["availabilityPosture"][] = [
  "not-stated",
  "scheduled",
  "same-day",
  "emergency-callout",
  "24-7-emergency",
  "by-appointment",
];

const linkTypes: LocalServiceSiteDraft["integrations"][number]["type"][] = [
  "quote",
  "contact",
  "booking",
  "social",
];

export function reconcileLocalServiceDraftAfterSave(input: {
  submittedDraft: LocalServiceSiteDraft;
  persistedDraft: LocalServiceSiteDraft;
  currentDraft: LocalServiceSiteDraft;
  submittedMutationVersion: number;
  currentMutationVersion: number;
  savedRevision: number;
}) {
  const acknowledged = acknowledgeOwnerDraftSave(
    {
      draft: input.currentDraft,
      baseline: input.submittedDraft,
      revision: 0,
      mutationVersion: input.currentMutationVersion,
      dirty: true,
    },
    {
      submittedDraft: input.submittedDraft,
      persistedDraft: input.persistedDraft,
      submittedMutationVersion: input.submittedMutationVersion,
      savedRevision: input.savedRevision,
    },
  );
  return {
    draft: acknowledged.state.draft,
    revision: acknowledged.state.revision,
    dirty: acknowledged.state.dirty,
    hadNewerEdits: acknowledged.hadNewerEdits,
  };
}

export function LocalServiceDashboard({
  initialDraft,
  initialRevision,
  email,
  brand,
  canSwitchWorkspace,
  initiallyPublished,
  platformUrl,
  ownerOperations = localServiceOwnerOperations,
  billingAccess = null,
  publicationHistory = [],
  sourceMonitoring = EMPTY_SOURCE_MONITORING_DASHBOARD,
}: {
  initialDraft: LocalServiceSiteDraft;
  initialRevision: number;
  email: string;
  brand: BrandIdentity;
  canSwitchWorkspace: boolean;
  initiallyPublished: boolean;
  platformUrl: string;
  ownerOperations?: VerticalOwnerOperations;
  billingAccess?: BillingAccess | null;
  publicationHistory?: ClientPublicationHistoryItem[];
  sourceMonitoring?: SourceMonitoringDashboardDto;
}) {
  const {
    draft,
    revision: savedRevision,
    dirty,
    setDraft,
    applyAuxiliary,
    setRevision,
    beginSave,
    acknowledgeSave,
    acknowledgeSnapshot,
  } = useOwnerDraftDirtyState(initialDraft, initialRevision);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const paidOps = useOwnerPaidOperations({
    siteSlug: initialDraft.slug,
    platformUrl,
    brandName: brand.name,
    capabilities: ownerOperations,
    billingAccess,
    initialPublicationHistory: publicationHistory,
  });
  const publishedVersion = paidOps.publishedVersion;
  const published = initiallyPublished || paidOps.isPublished;
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [integrationIssues, setIntegrationIssues] = useState<
    OwnerIntegrationIssue[]
  >([]);

  const handlePhotoRevision = useCallback(
    (nextRevision: number) => {
      setRevision(nextRevision);
    },
    [setRevision],
  );
  const handlePhotoHeroChange = useCallback(
    (
      hero: {
        url: string;
        originalUrl: string;
        provenance: "official" | "owner" | "permissioned-ugc";
      } | null,
    ) => {
      applyAuxiliary((current) => ({
        ...current,
        heroImageUrl: hero?.url ?? null,
        heroOriginalImageUrl: hero?.originalUrl ?? null,
        heroImageProvenance: hero?.provenance ?? null,
      }));
    },
    [applyAuxiliary],
  );
  const handlePhotoGalleryChange = useCallback(
    (
      galleryImages: Array<{
        url: string;
        originalUrl: string;
        provenance: "official" | "owner" | "permissioned-ugc";
      }>,
    ) => {
      applyAuxiliary((current) => ({
        ...current,
        galleryImages,
        attributes: {
          ...current.attributes,
          projects: current.attributes.projects.map((project, index) => {
            const selected = galleryImages[index];
            if (!selected) return project;
            return {
              ...project,
              imageUrl: selected.url,
              originalImageUrl: selected.originalUrl,
              imageProvenance: selected.provenance,
            };
          }),
        },
      }));
    },
    [applyAuxiliary],
  );
  const handlePhotoCatalogChange = useCallback(
    (change: {
      sectionIndex: number;
      itemIndex: number;
      url: string | null;
      originalUrl: string | null;
      provenance: "official" | "owner" | "permissioned-ugc" | null;
    }) => {
      applyAuxiliary((current) => ({
        ...current,
        catalogSections: current.catalogSections.map((section, sectionIndex) =>
          sectionIndex !== change.sectionIndex
            ? section
            : {
                ...section,
                items: section.items.map((item, itemIndex) =>
                  itemIndex !== change.itemIndex
                    ? item
                    : {
                        ...item,
                        imageUrl: change.url,
                        originalImageUrl: change.originalUrl,
                        imageProvenance: change.provenance,
                      },
                ),
              },
        ),
      }));
    },
    [applyAuxiliary],
  );

  function change(mutator: (next: LocalServiceSiteDraft) => void) {
    setDraft((current) => {
      const next = structuredClone(current);
      mutator(next);
      return next;
    });
    setNotice(null);
    setError(null);
    setIntegrationIssues([]);
  }

  async function save(): Promise<number | null> {
    const submitted = beginSave();
    const submittedDraft = submitted.submittedDraft;
    const ownerIssues = validateOwnerIntegrations(submittedDraft.integrations);
    const parsed = localServiceSiteDraftSchema.safeParse(submittedDraft);
    if (ownerIssues.length > 0 || !parsed.success) {
      const issues = mergeOwnerDraftIssues(
        ownerIssues,
        parsed.success ? [] : zodIssuesToOwnerIssues(parsed.error.issues),
      );
      setIntegrationIssues(
        issues.filter((issue) => issue.path.startsWith("integrations.")),
      );
      setError(formatOwnerDraftIssues(issues) || "Check the draft fields");
      return null;
    }
    setSaving(true);
    setError(null);
    setIntegrationIssues([]);
    try {
      const response = await fetch(`/api/sites/${submittedDraft.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          expectedRevision: submitted.expectedRevision,
        }),
      });
      const result = (await response.json()) as {
        error?: string;
        revision?: number;
      };
      if (!response.ok) throw new Error(result.error ?? "Save failed");
      if (
        typeof result.revision !== "number" ||
        !Number.isInteger(result.revision)
      ) {
        throw new Error("Save succeeded without a draft revision");
      }
      const reconciled = acknowledgeSave({
        submittedDraft,
        persistedDraft: parsed.data,
        submittedMutationVersion: submitted.submittedMutationVersion,
        savedRevision: result.revision,
      });
      setNotice(
        reconciled.hadNewerEdits
          ? `Draft revision ${reconciled.state.revision} saved; newer edits remain unsaved`
          : "Private draft saved",
      );
      return reconciled.hadNewerEdits ? null : reconciled.state.revision;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publish() {
    if (!isOwnerOperationEnabled(ownerOperations.publicationMutation)) {
      setError(
        ownerOperationUnavailableMessage(
          "publicationMutation",
          ownerOperations.publicationMutation === "enabled"
            ? "gated"
            : ownerOperations.publicationMutation,
        ),
      );
      return;
    }
    const changeSummary = window
      .prompt(
        "Summarize what will change on the public site:",
        "Publish reviewed service website",
      )
      ?.trim();
    if (!changeSummary) return;
    if (changeSummary.length < 3 || changeSummary.length > 280) {
      setError("Use a change summary between 3 and 280 characters.");
      return;
    }
    if (!window.confirm("Publish this reviewed service website now?")) return;

    setPublishing(true);
    setError(null);
    try {
      const expectedRevision = await save();
      if (expectedRevision === null) return;
      const response = await fetch(`/api/sites/${draft.slug}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeSummary, expectedRevision }),
      });
      const result = (await response.json()) as {
        error?: string;
        published?: {
          id: string;
          version: number;
          publishedAt: string;
          theme: { id: string; version: string };
        };
      };
      if (!response.ok || !result.published) {
        throw new Error(result.error ?? "Publish failed");
      }
      paidOps.recordPublished({
        id: result.published.id,
        version: result.published.version,
        publishedAt: result.published.publishedAt,
        changeSummary,
        theme: result.published.theme,
      });
      setNotice(`Published version ${result.published.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  function applyAcceptedSourceMonitoringDraft(input: {
    revision: number;
    draft: unknown;
  }) {
    const accepted = localServiceSiteDraftSchema.parse(input.draft);
    acknowledgeSnapshot(accepted, input.revision);
    setNotice("Source suggestion saved to the private draft.");
    setError(null);
  }

  return (
    <OwnerDraftDirtyGuard dirty={dirty}>
    <div
      className="min-h-screen bg-background text-foreground"
      {...ownerDraftNavigationProps(dirty)}
    >
      <header className="border-b border-border/70">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4 px-6 py-4">
          <Brand {...brand} />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
            <OwnerBillingButton
              billingAccess={paidOps.billingAccess}
              portalLoading={paidOps.portalLoading}
              onOpenPortal={() => void paidOps.openBillingPortal()}
            />
            <AccountActions canSwitch={canSwitchWorkspace} />
          </div>
        </div>
      </header>
      <OwnerBillingBanner
        billingAccess={paidOps.billingAccess}
        portalLoading={paidOps.portalLoading}
        onOpenPortal={() => void paidOps.openBillingPortal()}
      />

      <main className="mx-auto max-w-7xl px-6 py-10">
        <div className="flex flex-col gap-5 lg:flex-row lg:items-end lg:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
              Local-service editor
            </p>
            <h1 className="font-display mt-2 text-5xl leading-none tracking-[-0.045em]">
              Services, proof and contact.
            </h1>
            <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
              Edit only facts the business can support. Phone, WhatsApp and
              quote links stay external; publish only after the owner has
              reviewed every claim.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              render={
                <Link
                  href={published ? paidOps.liveUrl : `/preview/${draft.slug}`}
                  target="_blank"
                />
              }
              nativeButton={false}
              variant="outline"
            >
              {published ? "View live" : "Preview"} <ExternalLink />
            </Button>
            <Button
              onClick={() => void save()}
              disabled={saving || publishing || !dirty}
            >
              {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
              {dirty ? "Save draft" : "Saved"}
            </Button>
            <Button
              variant="outline"
              onClick={() => void publish()}
              disabled={saving || publishing}
            >
              {publishing ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Rocket />
              )}
              {publishedVersion ? `Published v${publishedVersion}` : "Publish"}
            </Button>
          </div>
        </div>

        <div className="mt-5 flex flex-wrap items-center gap-2 text-xs">
          <Badge variant={dirty ? "outline" : "secondary"}>
            {dirty ? "Unsaved changes" : `Draft revision ${savedRevision}`}
          </Badge>
          <Badge variant="outline">
            {published ? "Live on platform URL" : "Private draft"}
          </Badge>
          {notice ? (
            <span role="status" className="text-emerald-700">
              {notice}
            </span>
          ) : null}
        </div>
        {error || paidOps.operationError ? (
          <p
            role="alert"
            className="mt-4 rounded-xl border border-destructive/25 bg-destructive/5 p-4 text-sm text-destructive"
          >
            {error ?? paidOps.operationError}
          </p>
        ) : null}

        <div className="mt-8">
          <OwnerPaidOperationsSection paid={paidOps} />
        </div>
        {isOwnerOperationEnabled(ownerOperations.sourceMonitoring) ? (
          <div className="mt-8">
            <SourceMonitoringPanel
              siteSlug={draft.slug}
              initial={sourceMonitoring}
              draftRevision={savedRevision}
              hasUnsavedChanges={dirty}
              onAcceptedDraft={applyAcceptedSourceMonitoringDraft}
            />
          </div>
        ) : null}
        {isOwnerOperationEnabled(ownerOperations.photoLibrary) ? (
          <div className="mt-8">
            <PhotoLibraryPanel
              siteSlug={draft.slug}
              onRevision={handlePhotoRevision}
              onHeroChange={handlePhotoHeroChange}
              onGalleryChange={handlePhotoGalleryChange}
              onCatalogChange={handlePhotoCatalogChange}
            />
          </div>
        ) : null}

        <div className="mt-8 grid gap-6 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)]">
          <Card>
            <CardHeader>
              <CardTitle>Business essentials</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Business name">
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    change((next) => {
                      next.name = event.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={draft.phone}
                  onChange={(event) =>
                    change((next) => {
                      next.phone = event.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Hero eyebrow">
                <Input
                  value={draft.eyebrow}
                  onChange={(event) =>
                    change((next) => {
                      next.eyebrow = event.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Address">
                <Input
                  value={draft.address}
                  onChange={(event) =>
                    change((next) => {
                      next.address = event.target.value;
                    })
                  }
                />
              </Field>
              <Field label="Description" className="md:col-span-2">
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    change((next) => {
                      next.description = event.target.value;
                    })
                  }
                />
              </Field>
              <Field
                label="Hours — one “days | hours” row per line"
                className="md:col-span-2"
              >
                <Textarea
                  value={draft.businessHours
                    .map((row) => `${row.days} | ${row.hours}`)
                    .join("\n")}
                  onChange={(event) =>
                    change((next) => {
                      next.businessHours = parsePairs(event.target.value).map(
                        ([days, hours]) => ({ days, hours }),
                      );
                    })
                  }
                />
              </Field>
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Trade posture</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 md:grid-cols-2">
              <Field label="Trade type">
                <select
                  className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"
                  value={draft.attributes.tradeType}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.tradeType = event.target
                        .value as LocalServiceAttributes["tradeType"];
                    })
                  }
                >
                  {tradeTypes.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Availability">
                <select
                  className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"
                  value={draft.attributes.availabilityPosture}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.availabilityPosture = event.target
                        .value as LocalServiceAttributes["availabilityPosture"];
                    })
                  }
                >
                  {availabilityPostures.map((value) => (
                    <option key={value}>{value}</option>
                  ))}
                </select>
              </Field>
              <Field label="Service areas — one per line">
                <Textarea
                  value={draft.attributes.serviceAreas.join("\n")}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.serviceAreas = lines(event.target.value);
                    })
                  }
                />
              </Field>
              <div>
                <Label
                  id="insurance-posture-label"
                  htmlFor="insurance-posture"
                  className="mb-2 block"
                >
                  Insurance posture
                </Label>
                <select
                  id="insurance-posture"
                  className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"
                  value={draft.attributes.insuranceStatus}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.insuranceStatus = event.target
                        .value as LocalServiceAttributes["insuranceStatus"];
                    })
                  }
                >
                  <option>not-stated</option>
                  <option>insured</option>
                  <option>not-insured</option>
                </select>
                <span id="insurance-posture-detail" className="sr-only">
                  detail
                </span>
                <Input
                  id="insurance-posture-evidence"
                  aria-labelledby="insurance-posture-label insurance-posture-detail"
                  className="mt-2"
                  value={draft.attributes.insuranceDetail}
                  placeholder="Evidence-backed detail"
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.insuranceDetail = event.target.value;
                    })
                  }
                />
              </div>
              <Field
                label="Credentials — name | issuer | reference"
                className="md:col-span-2"
              >
                <Textarea
                  value={draft.attributes.credentials
                    .map((item) =>
                      [item.name, item.issuer, item.reference].join(" | "),
                    )
                    .join("\n")}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.credentials = parseTriples(
                        event.target.value,
                      ).map(([name, issuer, reference]) => ({
                        name,
                        issuer,
                        reference,
                      }));
                    })
                  }
                />
              </Field>
              <Field
                label="Trust signals — label | evidence"
                className="md:col-span-2"
              >
                <Textarea
                  value={draft.attributes.trustSignals
                    .map((item) => [item.label, item.detail].join(" | "))
                    .join("\n")}
                  onChange={(event) =>
                    change((next) => {
                      next.attributes.trustSignals = parsePairs(
                        event.target.value,
                      ).map(([label, detail]) => ({ label, detail }));
                    })
                  }
                />
              </Field>
            </CardContent>
          </Card>
        </div>

        <EditorSection
          title="Services"
          actionLabel="Add service group"
          onAdd={() =>
            change((next) => {
              next.catalogSections.push({
                name: "New service group",
                description: "",
                items: [],
              });
              next.translations.forEach((translation) => {
                translation.catalogSections.push({
                  name: "New service group",
                  description: "",
                  items: [],
                });
              });
            })
          }
        >
          {draft.catalogSections.map((section, sectionIndex) => (
            <Card key={`section-${sectionIndex}`}>
              <CardContent className="space-y-4 pt-2">
                <div className="grid gap-3 md:grid-cols-[1fr_1.5fr_auto]">
                  <Input
                    aria-label="Service group name"
                    value={section.name}
                    onChange={(event) =>
                      change((next) => {
                        next.catalogSections[sectionIndex].name =
                          event.target.value;
                      })
                    }
                  />
                  <Input
                    aria-label="Service group description"
                    value={section.description}
                    onChange={(event) =>
                      change((next) => {
                        next.catalogSections[sectionIndex].description =
                          event.target.value;
                      })
                    }
                  />
                  <Button
                    variant="destructive"
                    size="icon"
                    aria-label={`Delete ${section.name}`}
                    disabled={draft.catalogSections.length === 1}
                    onClick={() =>
                      change((next) => {
                        next.catalogSections.splice(sectionIndex, 1);
                        next.translations.forEach((translation) => {
                          translation.catalogSections.splice(sectionIndex, 1);
                        });
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
                {section.items.map((item, itemIndex) => (
                  <div
                    key={`service-${sectionIndex}-${itemIndex}`}
                    className="grid gap-3 rounded-xl border p-4 md:grid-cols-2"
                  >
                    <Field label="Service">
                      <Input
                        value={item.name}
                        onChange={(event) =>
                          change((next) => {
                            next.catalogSections[sectionIndex].items[
                              itemIndex
                            ].name = event.target.value;
                          })
                        }
                      />
                    </Field>
                    <Field label="Description">
                      <Input
                        value={item.description}
                        onChange={(event) =>
                          change((next) => {
                            next.catalogSections[sectionIndex].items[
                              itemIndex
                            ].description = event.target.value;
                          })
                        }
                      />
                    </Field>
                    <Field label="Pricing model">
                      <select
                        className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"
                        value={item.attributes.pricingModel}
                        onChange={(event) =>
                          change((next) => {
                            next.catalogSections[sectionIndex].items[
                              itemIndex
                            ].attributes.pricingModel = event.target
                              .value as typeof item.attributes.pricingModel;
                          })
                        }
                      >
                        <option>not-stated</option>
                        <option>fixed</option>
                        <option>from</option>
                        <option>hourly</option>
                        <option>quote</option>
                      </select>
                    </Field>
                    <div>
                      <Label
                        id={`service-price-unit-${sectionIndex}-${itemIndex}-label`}
                        htmlFor={`service-price-unit-${sectionIndex}-${itemIndex}-price`}
                        className="mb-2 block"
                      >
                        Price / unit
                      </Label>
                      <div className="grid grid-cols-2 gap-2">
                        <span
                          id={`service-price-unit-${sectionIndex}-${itemIndex}-price-label`}
                          className="sr-only"
                        >
                          price
                        </span>
                        <span
                          id={`service-price-unit-${sectionIndex}-${itemIndex}-unit-label`}
                          className="sr-only"
                        >
                          unit
                        </span>
                        <Input
                          id={`service-price-unit-${sectionIndex}-${itemIndex}-price`}
                          aria-labelledby={`service-price-unit-${sectionIndex}-${itemIndex}-label service-price-unit-${sectionIndex}-${itemIndex}-price-label`}
                          type="number"
                          min="0"
                          value={item.price ?? ""}
                          placeholder="No price"
                          onChange={(event) =>
                            change((next) => {
                              next.catalogSections[sectionIndex].items[
                                itemIndex
                              ].price =
                                event.target.value === ""
                                  ? null
                                  : Number(event.target.value);
                            })
                          }
                        />
                        <Input
                          id={`service-price-unit-${sectionIndex}-${itemIndex}-unit`}
                          aria-labelledby={`service-price-unit-${sectionIndex}-${itemIndex}-label service-price-unit-${sectionIndex}-${itemIndex}-unit-label`}
                          value={item.attributes.priceUnit}
                          placeholder="per hour"
                          onChange={(event) =>
                            change((next) => {
                              next.catalogSections[sectionIndex].items[
                                itemIndex
                              ].attributes.priceUnit = event.target.value;
                            })
                          }
                        />
                      </div>
                    </div>
                    <label className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={item.attributes.emergencyEligible}
                        onChange={(event) =>
                          change((next) => {
                            next.catalogSections[sectionIndex].items[
                              itemIndex
                            ].attributes.emergencyEligible =
                              event.target.checked;
                          })
                        }
                      />{" "}
                      Emergency-eligible
                    </label>
                    <Button
                      variant="destructive"
                      size="sm"
                      onClick={() =>
                        change((next) => {
                          next.catalogSections[sectionIndex].items.splice(
                            itemIndex,
                            1,
                          );
                          next.translations.forEach((translation) => {
                            translation.catalogSections[
                              sectionIndex
                            ]?.items.splice(itemIndex, 1);
                          });
                        })
                      }
                    >
                      <Trash2 /> Remove service
                    </Button>
                  </div>
                ))}
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() =>
                    change((next) => {
                      next.catalogSections[sectionIndex].items.push({
                        name: "New service",
                        description: "",
                        price: null,
                        currency: "EUR",
                        available: null,
                        imageUrl: null,
                        attributes: {
                          pricingModel: "not-stated",
                          priceUnit: "",
                          emergencyEligible: false,
                        },
                      });
                      next.translations.forEach((translation) => {
                        translation.catalogSections[sectionIndex]?.items.push({
                          name: "New service",
                          description: "",
                          attributes: {},
                        });
                      });
                    })
                  }
                >
                  <Plus /> Add service
                </Button>
              </CardContent>
            </Card>
          ))}
        </EditorSection>

        <EditorSection
          title="Projects"
          actionLabel="Add project"
          onAdd={() =>
            change((next) => {
              next.attributes.projects.push({
                title: "New project",
                description: "",
                imageUrl: null,
                location: "",
              });
              next.attributes.showProjectGallery = true;
            })
          }
        >
          <label className="mb-4 flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={draft.attributes.showProjectGallery}
              onChange={(event) =>
                change((next) => {
                  next.attributes.showProjectGallery = event.target.checked;
                })
              }
            />
            Show project gallery
          </label>
          <div className="grid gap-4 md:grid-cols-2">
            {draft.attributes.projects.map((project, index) => (
              <Card key={`project-${index}`}>
                <CardContent className="grid gap-3 pt-2">
                  <Input
                    aria-label="Project title"
                    value={project.title}
                    onChange={(event) =>
                      change((next) => {
                        next.attributes.projects[index].title =
                          event.target.value;
                      })
                    }
                  />
                  <Input
                    aria-label="Project location"
                    value={project.location}
                    placeholder="Location"
                    onChange={(event) =>
                      change((next) => {
                        next.attributes.projects[index].location =
                          event.target.value;
                      })
                    }
                  />
                  <Textarea
                    aria-label="Project description"
                    value={project.description}
                    onChange={(event) =>
                      change((next) => {
                        next.attributes.projects[index].description =
                          event.target.value;
                      })
                    }
                  />
                  {project.imageUrl ? (
                    <p className="text-xs text-muted-foreground">
                      Project image is selected from the reviewed photo library
                      {project.imageProvenance
                        ? ` · ${project.imageProvenance.replaceAll("-", " ")}`
                        : ""}
                      .
                    </p>
                  ) : (
                    <p className="text-xs text-muted-foreground">
                      Choose an approved gallery photo for this project in the
                      photo library.
                    </p>
                  )}
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      change((next) => {
                        next.attributes.projects.splice(index, 1);
                      })
                    }
                  >
                    <Trash2 /> Remove project
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </EditorSection>

        <EditorSection
          title="External tools"
          actionLabel="Add link"
          onAdd={() =>
            change((next) => {
              const integration = createOwnerIntegration({ type: "quote" });
              next.integrations.push(integration);
              next.translations.forEach((translation) => {
                translation.integrationLabels.push(integration.label);
              });
            })
          }
        >
          <div className="grid gap-4 md:grid-cols-2">
            {draft.integrations.map((integration, index) => (
              <Card key={`link-${index}`}>
                <CardContent className="grid gap-3 pt-2 md:grid-cols-2">
                  <Field label="Type">
                    <select
                      className="h-8 w-full rounded-lg border bg-background px-2.5 text-sm"
                      value={integration.type}
                      onChange={(event) =>
                        change((next) => {
                          next.integrations[index].type = event.target
                            .value as typeof integration.type;
                        })
                      }
                    >
                      {linkTypes.map((value) => (
                        <option key={value}>{value}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Label">
                    <Input
                      value={integration.label}
                      onChange={(event) =>
                        change((next) => {
                          next.integrations[index].label = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field
                    label="HTTPS destination"
                    className="md:col-span-2"
                    error={ownerIntegrationIssueMessage(
                      integrationIssues,
                      ownerIntegrationFieldPath(index, "url"),
                    )}
                  >
                    <Input
                      type="url"
                      value={integration.url}
                      onChange={(event) =>
                        change((next) => {
                          const current = next.integrations[index];
                          if (!current) return;
                          next.integrations[index] = withOwnerIntegrationUrl(
                            current,
                            event.target.value,
                          );
                        })
                      }
                    />
                  </Field>
                  <div className="flex items-center justify-between gap-3">
                    <Label htmlFor={`integration-enabled-${index}`}>
                      Visible in preview
                    </Label>
                    <Switch
                      id={`integration-enabled-${index}`}
                      aria-label="Visible in preview"
                      checked={integration.enabled}
                      disabled={!canEnableOwnerIntegration(integration.url)}
                      onCheckedChange={(enabled) =>
                        change((next) => {
                          const current = next.integrations[index];
                          if (!current) return;
                          next.integrations[index] =
                            withOwnerIntegrationEnabled(current, enabled);
                        })
                      }
                    />
                  </div>
                  <Button
                    variant="destructive"
                    size="sm"
                    onClick={() =>
                      change((next) => {
                        next.integrations.splice(index, 1);
                        next.translations.forEach((translation) => {
                          translation.integrationLabels.splice(index, 1);
                        });
                      })
                    }
                  >
                    <Trash2 /> Remove link
                  </Button>
                </CardContent>
              </Card>
            ))}
          </div>
        </EditorSection>
      </main>
    </div>
    </OwnerDraftDirtyGuard>
  );
}

function EditorSection({
  title,
  actionLabel,
  onAdd,
  children,
}: {
  title: string;
  actionLabel: string;
  onAdd: () => void;
  children: React.ReactNode;
}) {
  return (
    <section className="mt-10">
      <div className="mb-4 flex items-center justify-between gap-4">
        <h2 className="font-display text-3xl tracking-[-0.035em]">{title}</h2>
        <Button variant="outline" size="sm" onClick={onAdd}>
          <Plus /> {actionLabel}
        </Button>
      </div>
      {children}
    </section>
  );
}

function lines(value: string): string[] {
  return value
    .split("\n")
    .map((item) => item.trim())
    .filter(Boolean);
}

function parsePairs(value: string): Array<[string, string]> {
  return lines(value).map((row) => {
    const [first = "", ...rest] = row.split("|");
    return [first.trim(), rest.join("|").trim()];
  });
}

function parseTriples(value: string): Array<[string, string, string]> {
  return lines(value).map((row) => {
    const [first = "", second = "", ...rest] = row.split("|");
    return [first.trim(), second.trim(), rest.join("|").trim()];
  });
}
