"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import {
  Check,
  ExternalLink,
  Languages,
  LoaderCircle,
  Plus,
  Rocket,
  Save,
  Trash2,
} from "lucide-react";
import { AccountActions } from "@/components/account-actions";
import { Brand } from "@/components/brand";
import { SiteRenderer } from "@/components/site-renderer";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import { Vertical } from "@/generated/prisma/enums";
import type { BrandIdentity } from "@/lib/brand";
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
  appendFoodRetailCategoryTranslations,
  appendFoodRetailIntegrationTranslations,
  appendFoodRetailItemTranslations,
  FOOD_RETAIL_NEW_LINK_LABEL,
  hasUnreviewedFoodRetailTranslations,
  markFoodRetailTranslationReviewed,
  markFoodRetailTranslationsStale,
  reconcileFoodRetailDraftAfterSave,
  updateFoodRetailTranslation,
} from "@/lib/verticals/food-retail/editor";
import {
  foodRetailSiteDraftSchema,
  type FoodRetailSiteDraft,
} from "@/lib/verticals/food-retail/schema";

export function FoodRetailDashboard({
  email,
  brand,
  initialDraft,
  initialRevision,
  canSwitchWorkspace,
  initiallyPublished,
  platformUrl,
}: {
  email: string;
  brand: BrandIdentity;
  initialDraft: FoodRetailSiteDraft;
  initialRevision: number;
  canSwitchWorkspace: boolean;
  initiallyPublished: boolean;
  platformUrl: string;
}) {
  const [draft, setDraftState] = useState(initialDraft);
  const draftRef = useRef(initialDraft);
  function setDraft(
    next:
      | FoodRetailSiteDraft
      | ((current: FoodRetailSiteDraft) => FoodRetailSiteDraft),
  ) {
    const resolved = typeof next === "function" ? next(draftRef.current) : next;
    draftRef.current = resolved;
    setDraftState(resolved);
  }
  const [revision, setRevision] = useState(initialRevision);
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [publishedVersion, setPublishedVersion] = useState<number | null>(null);
  const [published, setPublished] = useState(initiallyPublished);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [integrationIssues, setIntegrationIssues] = useState<
    OwnerIntegrationIssue[]
  >([]);

  function updateSection(
    sectionIndex: number,
    update: (section: FoodRetailSiteDraft["catalogSections"][number]) => void,
  ) {
    setDraft((current) => {
      const next = structuredClone(current);
      update(next.catalogSections[sectionIndex]);
      return markFoodRetailTranslationsStale(next);
    });
    setNotice(null);
  }

  function updateItem(
    sectionIndex: number,
    itemIndex: number,
    update: (
      item: FoodRetailSiteDraft["catalogSections"][number]["items"][number],
    ) => void,
  ) {
    updateSection(sectionIndex, (section) => update(section.items[itemIndex]));
  }

  function removeSection(sectionIndex: number) {
    setDraft((current) =>
      markFoodRetailTranslationsStale({
        ...current,
        catalogSections: current.catalogSections.filter(
          (_, index) => index !== sectionIndex,
        ),
        translations: current.translations.map((translation) => ({
          ...translation,
          catalogSections: translation.catalogSections.filter(
            (_, index) => index !== sectionIndex,
          ),
        })),
      }),
    );
  }

  function addSection() {
    const name = window.prompt("Enter the sourced category name:")?.trim();
    if (!name) return;
    setDraft((current) =>
      appendFoodRetailCategoryTranslations({
        ...current,
        catalogSections: [
          ...current.catalogSections,
          { name, description: "", items: [] },
        ],
      }),
    );
  }

  function removeItem(sectionIndex: number, itemIndex: number) {
    setDraft((current) => {
      const next = structuredClone(current);
      next.catalogSections[sectionIndex].items.splice(itemIndex, 1);
      next.translations.forEach((translation) => {
        translation.catalogSections[sectionIndex]?.items.splice(itemIndex, 1);
      });
      return markFoodRetailTranslationsStale(next);
    });
  }

  function addItem(sectionIndex: number) {
    const name = window.prompt("Enter the sourced product name:")?.trim();
    if (!name) return;
    setDraft((current) => {
      const next = structuredClone(current);
      next.catalogSections[sectionIndex].items.push({
        name,
        description: "",
        price: null,
        currency: "EUR",
        available: null,
        imageUrl: null,
        attributes: {
          visible: true,
          stockSourceUrl: null,
          seasonalAvailability: "",
          preorderRequired: null,
          preorderNote: "",
          allergens: [],
          allergenSourceUrl: null,
        },
      });
      return appendFoodRetailItemTranslations(next, sectionIndex);
    });
  }

  function addIntegration() {
    setDraft((current) =>
      appendFoodRetailIntegrationTranslations({
        ...current,
        integrations: [
          ...current.integrations,
          createOwnerIntegration({
            type: "ordering",
            label: FOOD_RETAIL_NEW_LINK_LABEL,
          }),
        ],
      }),
    );
    setIntegrationIssues([]);
  }

  function removeIntegration(integrationIndex: number) {
    setDraft((current) =>
      markFoodRetailTranslationsStale({
        ...current,
        integrations: current.integrations.filter(
          (_, index) => index !== integrationIndex,
        ),
        translations: current.translations.map((translation) => ({
          ...translation,
          integrationLabels: translation.integrationLabels.filter(
            (_, index) => index !== integrationIndex,
          ),
        })),
      }),
    );
  }

  function changeTranslation(
    locale: string,
    updater: (translation: FoodRetailSiteDraft["translations"][number]) => void,
  ) {
    setDraft((current) =>
      updateFoodRetailTranslation(current, locale, updater),
    );
    setNotice(null);
    setError(null);
  }

  function reviewTranslation(locale: string) {
    try {
      setDraft(markFoodRetailTranslationReviewed(draft, locale));
      setNotice(`${locale.toUpperCase()} translation reviewed.`);
      setError(null);
    } catch {
      setError(
        "Complete every required translated name and label before review.",
      );
    }
  }

  async function saveDraft(): Promise<number | null> {
    const submittedDraft = draft;
    const ownerIssues = validateOwnerIntegrations(submittedDraft.integrations);
    const parsed = foodRetailSiteDraftSchema.safeParse(submittedDraft);
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
    setNotice(null);
    try {
      const response = await fetch(`/api/sites/${draft.slug}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          ...parsed.data,
          expectedRevision: revision,
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
        throw new Error("Save response did not include a draft revision");
      }
      const hadNewerEdits = draftRef.current !== submittedDraft;
      setDraft((current) =>
        reconcileFoodRetailDraftAfterSave(submittedDraft, parsed.data, current),
      );
      setRevision(result.revision);
      if (hadNewerEdits) {
        setError(
          "New edits were made while saving. Save them before leaving this private preview.",
        );
        return null;
      }
      setNotice("Draft saved privately.");
      return result.revision;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Save failed");
      return null;
    } finally {
      setSaving(false);
    }
  }

  async function publishDraft() {
    if (hasUnreviewedFoodRetailTranslations(draftRef.current)) {
      setError("Review every draft or stale translation before publishing.");
      return;
    }
    const changeSummary = window
      .prompt(
        "Summarize what will change on the public site:",
        "Publish reviewed storefront",
      )
      ?.trim();
    if (!changeSummary) return;
    if (changeSummary.length < 3 || changeSummary.length > 280) {
      setError("Use a change summary between 3 and 280 characters.");
      return;
    }
    if (!window.confirm("Publish this reviewed storefront now?")) return;

    setPublishing(true);
    setError(null);
    try {
      const expectedRevision = await saveDraft();
      if (expectedRevision === null) return;
      const response = await fetch(`/api/sites/${draft.slug}/publish`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ changeSummary, expectedRevision }),
      });
      const result = (await response.json()) as {
        error?: string;
        published?: { version: number };
      };
      if (!response.ok || !result.published) {
        throw new Error(result.error ?? "Publish failed");
      }
      setPublished(true);
      setPublishedVersion(result.published.version);
      setNotice(`Published version ${result.published.version}.`);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Publish failed");
    } finally {
      setPublishing(false);
    }
  }

  return (
    <div className="min-h-screen bg-muted/35 text-foreground">
      <header className="border-b bg-background">
        <div className="mx-auto flex max-w-[1500px] items-center justify-between gap-4 px-5 py-4">
          <Brand {...brand} />
          <div className="flex items-center gap-3">
            <span className="hidden text-xs text-muted-foreground sm:inline">
              {email}
            </span>
            <AccountActions canSwitch={canSwitchWorkspace} />
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-[1500px] gap-6 px-5 py-6 xl:grid-cols-[minmax(0,0.9fr)_minmax(430px,1.1fr)]">
        <div className="space-y-5">
          <Card>
            <CardHeader className="flex-row items-center justify-between gap-4">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.14em] text-primary">
                  Food retail owner workspace
                </p>
                <CardTitle className="mt-1">
                  Products, pickup and hours
                </CardTitle>
                <p className="mt-2 max-w-2xl text-sm text-muted-foreground">
                  Save privately, review every sourced fact and translation,
                  then publish to the business&apos;s platform URL.
                </p>
              </div>
              <div className="flex flex-wrap justify-end gap-2">
                <Button
                  render={
                    <Link
                      href={published ? platformUrl : `/preview/${draft.slug}`}
                      target="_blank"
                    />
                  }
                  nativeButton={false}
                  variant="outline"
                >
                  {published ? "View live" : "Preview"} <ExternalLink />
                </Button>
                <Button
                  variant="outline"
                  disabled={saving || publishing}
                  onClick={() => void saveDraft()}
                >
                  <Save /> {saving ? "Saving…" : "Save"}
                </Button>
                <Button
                  disabled={saving || publishing}
                  onClick={() => void publishDraft()}
                >
                  {publishing ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <Rocket />
                  )}
                  {publishedVersion
                    ? `Published v${publishedVersion}`
                    : "Publish"}
                </Button>
              </div>
            </CardHeader>
            <CardContent>
              {notice ? (
                <p role="status" className="text-sm text-emerald-700">
                  {notice}
                </p>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}
            </CardContent>
          </Card>

          <Card>
            <CardHeader>
              <CardTitle>Shop details</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-4 sm:grid-cols-2">
              <Field label="Business name">
                <Input
                  value={draft.name}
                  onChange={(event) =>
                    setDraft({ ...draft, name: event.target.value })
                  }
                />
              </Field>
              <Field label="Shop type">
                <select
                  className="h-9 w-full rounded-lg border bg-background px-3 text-sm"
                  value={draft.attributes.shopType}
                  onChange={(event) =>
                    setDraft({
                      ...draft,
                      attributes: {
                        ...draft.attributes,
                        shopType: event.target
                          .value as FoodRetailSiteDraft["attributes"]["shopType"],
                      },
                    })
                  }
                >
                  <option value="bakery">Bakery</option>
                  <option value="patisserie">Patisserie</option>
                  <option value="butcher">Butcher</option>
                  <option value="deli">Deli</option>
                  <option value="cheesemonger">Cheesemonger</option>
                  <option value="grocer">Grocer</option>
                  <option value="local-food-shop">Local food shop</option>
                </select>
              </Field>
              <Field label="Address">
                <Input
                  value={draft.address}
                  onChange={(event) =>
                    setDraft({ ...draft, address: event.target.value })
                  }
                />
              </Field>
              <Field label="Phone">
                <Input
                  value={draft.phone}
                  onChange={(event) =>
                    setDraft({ ...draft, phone: event.target.value })
                  }
                />
              </Field>
              <Field label="Pickup details" className="sm:col-span-2">
                <Textarea
                  value={draft.attributes.pickupDetails}
                  onChange={(event) =>
                    setDraft((current) =>
                      markFoodRetailTranslationsStale({
                        ...current,
                        attributes: {
                          ...current.attributes,
                          pickupDetails: event.target.value,
                        },
                      }),
                    )
                  }
                />
              </Field>
              <Field label="Description" className="sm:col-span-2">
                <Textarea
                  value={draft.description}
                  onChange={(event) =>
                    setDraft((current) =>
                      markFoodRetailTranslationsStale({
                        ...current,
                        description: event.target.value,
                      }),
                    )
                  }
                />
              </Field>
              <div className="flex items-center justify-between gap-4 sm:col-span-2">
                <div>
                  <Label htmlFor="show-product-images">
                    Show product gallery
                  </Label>
                  <p className="text-xs text-muted-foreground">
                    Only source or owner-approved images are rendered.
                  </p>
                </div>
                <Switch
                  id="show-product-images"
                  checked={draft.attributes.showProductImages}
                  onCheckedChange={(checked) =>
                    setDraft({
                      ...draft,
                      attributes: {
                        ...draft.attributes,
                        showProductImages: checked,
                      },
                    })
                  }
                />
              </div>
            </CardContent>
          </Card>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Store hours</CardTitle>
              <Button
                size="sm"
                variant="outline"
                onClick={() =>
                  setDraft({
                    ...draft,
                    businessHours: [
                      ...draft.businessHours,
                      { days: "", hours: "" },
                    ],
                  })
                }
              >
                <Plus /> Add hours
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.businessHours.map((row, index) => (
                <div
                  key={index}
                  className="grid grid-cols-[1fr_1fr_auto] gap-2"
                >
                  <Input
                    aria-label={`Days ${index + 1}`}
                    placeholder="Monday–Friday"
                    value={row.days}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        businessHours: draft.businessHours.map(
                          (candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, days: event.target.value }
                              : candidate,
                        ),
                      })
                    }
                  />
                  <Input
                    aria-label={`Hours ${index + 1}`}
                    placeholder="07:00–16:00"
                    value={row.hours}
                    onChange={(event) =>
                      setDraft({
                        ...draft,
                        businessHours: draft.businessHours.map(
                          (candidate, candidateIndex) =>
                            candidateIndex === index
                              ? { ...candidate, hours: event.target.value }
                              : candidate,
                        ),
                      })
                    }
                  />
                  <Button
                    size="icon-sm"
                    variant="ghost"
                    aria-label={`Remove hours ${index + 1}`}
                    onClick={() =>
                      setDraft({
                        ...draft,
                        businessHours: draft.businessHours.filter(
                          (_, candidateIndex) => candidateIndex !== index,
                        ),
                      })
                    }
                  >
                    <Trash2 />
                  </Button>
                </div>
              ))}
            </CardContent>
          </Card>

          {draft.catalogSections.map((section, sectionIndex) => (
            <Card key={sectionIndex}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div className="grid flex-1 gap-2">
                  <Input
                    aria-label={`Category ${sectionIndex + 1} name`}
                    value={section.name}
                    onChange={(event) =>
                      updateSection(sectionIndex, (next) => {
                        next.name = event.target.value;
                      })
                    }
                  />
                  <Input
                    aria-label={`Category ${sectionIndex + 1} description`}
                    placeholder="Category description"
                    value={section.description}
                    onChange={(event) =>
                      updateSection(sectionIndex, (next) => {
                        next.description = event.target.value;
                      })
                    }
                  />
                </div>
                <Button
                  size="icon-sm"
                  variant="ghost"
                  aria-label={`Remove category ${sectionIndex + 1}`}
                  disabled={draft.catalogSections.length === 1}
                  onClick={() => removeSection(sectionIndex)}
                >
                  <Trash2 />
                </Button>
              </CardHeader>
              <CardContent className="space-y-4">
                {section.items.map((item, itemIndex) => (
                  <div
                    key={itemIndex}
                    className="space-y-3 rounded-xl border p-4"
                  >
                    <div className="grid gap-3 sm:grid-cols-[1fr_120px_auto]">
                      <Input
                        aria-label={`Product ${itemIndex + 1} name`}
                        placeholder="Product name"
                        value={item.name}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.name = event.target.value;
                          })
                        }
                      />
                      <Input
                        aria-label={`Product ${itemIndex + 1} price`}
                        type="number"
                        min="0"
                        step="0.01"
                        placeholder="No price"
                        value={item.price ?? ""}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.price =
                              event.target.value === ""
                                ? null
                                : Number(event.target.value);
                          })
                        }
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove product ${itemIndex + 1}`}
                        onClick={() => removeItem(sectionIndex, itemIndex)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                    <Textarea
                      aria-label={`Product ${itemIndex + 1} description`}
                      placeholder="Sourced product description"
                      value={item.description}
                      onChange={(event) =>
                        updateItem(sectionIndex, itemIndex, (next) => {
                          next.description = event.target.value;
                        })
                      }
                    />
                    <div className="flex items-center justify-between gap-4 rounded-lg bg-muted/55 px-3 py-2">
                      <div>
                        <Label htmlFor={`visible-${sectionIndex}-${itemIndex}`}>
                          Show product on storefront
                        </Label>
                        <p className="text-xs text-muted-foreground">
                          This controls catalog visibility, not current stock.
                        </p>
                      </div>
                      <Switch
                        id={`visible-${sectionIndex}-${itemIndex}`}
                        checked={item.attributes.visible}
                        onCheckedChange={(checked) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.visible = checked;
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[180px_1fr]">
                      <select
                        aria-label={`Product ${itemIndex + 1} stock status`}
                        className="h-9 rounded-lg border bg-background px-2 text-sm"
                        value={
                          item.available === null
                            ? "unknown"
                            : item.available
                              ? "in-stock"
                              : "out-of-stock"
                        }
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.available =
                              event.target.value === "unknown"
                                ? null
                                : event.target.value === "in-stock";
                            if (next.available === null)
                              next.attributes.stockSourceUrl = null;
                          })
                        }
                      >
                        <option value="unknown">Stock unknown</option>
                        <option value="in-stock">In stock (sourced)</option>
                        <option value="out-of-stock">
                          Out of stock (sourced)
                        </option>
                      </select>
                      <Input
                        aria-label={`Product ${itemIndex + 1} stock source`}
                        type="url"
                        placeholder="Required source URL for a stock claim"
                        value={item.attributes.stockSourceUrl ?? ""}
                        disabled={item.available === null}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.stockSourceUrl =
                              event.target.value || null;
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_150px_1fr]">
                      <Input
                        aria-label={`Product ${itemIndex + 1} seasonal availability`}
                        placeholder="Seasonal availability (only if sourced)"
                        value={item.attributes.seasonalAvailability}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.seasonalAvailability =
                              event.target.value;
                          })
                        }
                      />
                      <select
                        aria-label={`Product ${itemIndex + 1} preorder requirement`}
                        className="h-9 rounded-lg border bg-background px-2 text-sm"
                        value={
                          item.attributes.preorderRequired === null
                            ? "unknown"
                            : item.attributes.preorderRequired
                              ? "required"
                              : "not-required"
                        }
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.preorderRequired =
                              event.target.value === "unknown"
                                ? null
                                : event.target.value === "required";
                          })
                        }
                      >
                        <option value="unknown">Preorder unknown</option>
                        <option value="required">Preorder required</option>
                        <option value="not-required">
                          No preorder required
                        </option>
                      </select>
                      <Input
                        aria-label={`Product ${itemIndex + 1} preorder note`}
                        placeholder="Preorder note (only if sourced)"
                        value={item.attributes.preorderNote}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.preorderNote = event.target.value;
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Input
                        aria-label={`Product ${itemIndex + 1} allergens`}
                        placeholder="Allergens, comma separated"
                        value={item.attributes.allergens.join(", ")}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.allergens = event.target.value
                              .split(",")
                              .map((value) => value.trim())
                              .filter(Boolean);
                          })
                        }
                      />
                      <Input
                        aria-label={`Product ${itemIndex + 1} allergen source`}
                        type="url"
                        placeholder="Required source URL for allergens"
                        value={item.attributes.allergenSourceUrl ?? ""}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.attributes.allergenSourceUrl =
                              event.target.value || null;
                          })
                        }
                      />
                    </div>
                    <div className="grid gap-3 sm:grid-cols-[1fr_180px]">
                      <Input
                        aria-label={`Product ${itemIndex + 1} image`}
                        type="url"
                        placeholder="Approved product image URL"
                        value={item.imageUrl ?? ""}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.imageUrl = event.target.value || null;
                            if (!next.imageUrl) next.imageProvenance = null;
                          })
                        }
                      />
                      <select
                        aria-label={`Product ${itemIndex + 1} image provenance`}
                        className="h-9 rounded-lg border bg-background px-2 text-sm"
                        value={item.imageProvenance ?? ""}
                        onChange={(event) =>
                          updateItem(sectionIndex, itemIndex, (next) => {
                            next.imageProvenance = (event.target.value ||
                              null) as
                              "official" | "owner" | "permissioned-ugc" | null;
                          })
                        }
                      >
                        <option value="">Choose image source</option>
                        <option value="official">Official source</option>
                        <option value="owner">Owner supplied</option>
                        <option value="permissioned-ugc">
                          Permissioned UGC
                        </option>
                      </select>
                    </div>
                  </div>
                ))}
                <Button
                  size="sm"
                  variant="outline"
                  onClick={() => addItem(sectionIndex)}
                >
                  <Plus /> Add sourced product
                </Button>
              </CardContent>
            </Card>
          ))}

          <Button variant="outline" onClick={addSection}>
            <Plus /> Add product category
          </Button>

          <Card>
            <CardHeader className="flex-row items-center justify-between">
              <CardTitle>Preorder and delivery links</CardTitle>
              <Button size="sm" variant="outline" onClick={addIntegration}>
                <Plus /> Add link
              </Button>
            </CardHeader>
            <CardContent className="space-y-3">
              {draft.integrations
                .filter((integration) => integration.type !== "social")
                .map((integration) => {
                  const integrationIndex =
                    draft.integrations.indexOf(integration);
                  return (
                    <div
                      key={integrationIndex}
                      className="grid gap-2 rounded-xl border p-3 sm:grid-cols-[130px_1fr_minmax(0,1.4fr)_auto_auto]"
                    >
                      <select
                        aria-label={`Link ${integrationIndex + 1} type`}
                        className="h-9 rounded-lg border bg-background px-2 text-sm"
                        value={integration.type}
                        onChange={(event) =>
                          setDraft({
                            ...draft,
                            integrations: draft.integrations.map(
                              (candidate, index) =>
                                index === integrationIndex
                                  ? {
                                      ...candidate,
                                      type: event.target.value as
                                        "ordering" | "delivery",
                                    }
                                  : candidate,
                            ),
                          })
                        }
                      >
                        <option value="ordering">Preorder</option>
                        <option value="delivery">Delivery</option>
                      </select>
                      <Input
                        aria-label={`Link ${integrationIndex + 1} label`}
                        placeholder="Order for pickup"
                        value={integration.label}
                        onChange={(event) =>
                          setDraft((current) =>
                            markFoodRetailTranslationsStale({
                              ...current,
                              integrations: current.integrations.map(
                                (candidate, index) =>
                                  index === integrationIndex
                                    ? {
                                        ...candidate,
                                        label: event.target.value,
                                      }
                                    : candidate,
                              ),
                            }),
                          )
                        }
                      />
                      <Field
                        label={`Link ${integrationIndex + 1} URL`}
                        error={ownerIntegrationIssueMessage(
                          integrationIssues,
                          ownerIntegrationFieldPath(integrationIndex, "url"),
                        )}
                      >
                        <Input
                          aria-label={`Link ${integrationIndex + 1} URL`}
                          type="url"
                          placeholder="https://…"
                          value={integration.url}
                          onChange={(event) => {
                            setIntegrationIssues([]);
                            setDraft({
                              ...draft,
                              integrations: draft.integrations.map(
                                (candidate, index) =>
                                  index === integrationIndex
                                    ? withOwnerIntegrationUrl(
                                        candidate,
                                        event.target.value,
                                      )
                                    : candidate,
                              ),
                            });
                          }}
                        />
                      </Field>
                      <Switch
                        aria-label={`Show link ${integrationIndex + 1} publicly`}
                        checked={integration.enabled}
                        disabled={
                          !canEnableOwnerIntegration(integration.url)
                        }
                        onCheckedChange={(enabled) =>
                          setDraft({
                            ...draft,
                            integrations: draft.integrations.map(
                              (candidate, index) =>
                                index === integrationIndex
                                  ? withOwnerIntegrationEnabled(
                                      candidate,
                                      enabled,
                                    )
                                  : candidate,
                            ),
                          })
                        }
                      />
                      <Button
                        size="icon-sm"
                        variant="ghost"
                        aria-label={`Remove link ${integrationIndex + 1}`}
                        onClick={() => removeIntegration(integrationIndex)}
                      >
                        <Trash2 />
                      </Button>
                    </div>
                  );
                })}
            </CardContent>
          </Card>

          {draft.translations.map((translation) => (
            <Card key={translation.locale}>
              <CardHeader className="flex-row items-start justify-between gap-4">
                <div>
                  <div className="flex items-center gap-2">
                    <Languages className="size-4" />
                    <CardTitle>
                      {translation.locale.toUpperCase()} localized copy
                    </CardTitle>
                  </div>
                  <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                    New entries temporarily reuse the canonical source wording
                    so the private draft stays saveable without inventing a
                    translation. Translate the wording below, then review it
                    before any future launch. Prices, stock, links and source
                    evidence stay canonical.
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <span className="rounded-full border px-2 py-1 text-xs capitalize">
                    {translation.status}
                  </span>
                  <Button
                    size="sm"
                    disabled={translation.status === "current"}
                    onClick={() => reviewTranslation(translation.locale)}
                  >
                    <Check /> Mark reviewed
                  </Button>
                </div>
              </CardHeader>
              <CardContent className="space-y-5">
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field label="Eyebrow">
                    <Input
                      value={translation.eyebrow}
                      onChange={(event) =>
                        changeTranslation(translation.locale, (next) => {
                          next.eyebrow = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Pickup details">
                    <Input
                      value={translation.attributes.pickupDetails}
                      onChange={(event) =>
                        changeTranslation(translation.locale, (next) => {
                          next.attributes.pickupDetails = event.target.value;
                        })
                      }
                    />
                  </Field>
                  <Field label="Description" className="sm:col-span-2">
                    <Textarea
                      value={translation.description}
                      onChange={(event) =>
                        changeTranslation(translation.locale, (next) => {
                          next.description = event.target.value;
                        })
                      }
                    />
                  </Field>
                </div>

                {translation.catalogSections.map(
                  (translatedSection, sectionIndex) => (
                    <div
                      key={sectionIndex}
                      className="space-y-3 rounded-xl border p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-[0.12em] text-muted-foreground">
                        Category {sectionIndex + 1}
                      </p>
                      <div className="grid gap-3 sm:grid-cols-2">
                        <Input
                          aria-label={`${translation.locale} category ${sectionIndex + 1} name`}
                          value={translatedSection.name}
                          onChange={(event) =>
                            changeTranslation(translation.locale, (next) => {
                              next.catalogSections[sectionIndex].name =
                                event.target.value;
                            })
                          }
                        />
                        <Input
                          aria-label={`${translation.locale} category ${sectionIndex + 1} description`}
                          placeholder="Localized category description"
                          value={translatedSection.description}
                          onChange={(event) =>
                            changeTranslation(translation.locale, (next) => {
                              next.catalogSections[sectionIndex].description =
                                event.target.value;
                            })
                          }
                        />
                      </div>
                      {translatedSection.items.map(
                        (translatedItem, itemIndex) => (
                          <div
                            key={itemIndex}
                            className="grid gap-3 rounded-lg bg-muted/45 p-3 sm:grid-cols-2"
                          >
                            <Input
                              aria-label={`${translation.locale} product ${itemIndex + 1} name`}
                              value={translatedItem.name}
                              onChange={(event) =>
                                changeTranslation(
                                  translation.locale,
                                  (next) => {
                                    next.catalogSections[sectionIndex].items[
                                      itemIndex
                                    ].name = event.target.value;
                                  },
                                )
                              }
                            />
                            <Input
                              aria-label={`${translation.locale} product ${itemIndex + 1} description`}
                              placeholder="Localized product description"
                              value={translatedItem.description}
                              onChange={(event) =>
                                changeTranslation(
                                  translation.locale,
                                  (next) => {
                                    next.catalogSections[sectionIndex].items[
                                      itemIndex
                                    ].description = event.target.value;
                                  },
                                )
                              }
                            />
                            <Input
                              aria-label={`${translation.locale} product ${itemIndex + 1} seasonal availability`}
                              placeholder="Localized sourced seasonal wording"
                              value={
                                translatedItem.attributes.seasonalAvailability
                              }
                              onChange={(event) =>
                                changeTranslation(
                                  translation.locale,
                                  (next) => {
                                    next.catalogSections[sectionIndex].items[
                                      itemIndex
                                    ].attributes.seasonalAvailability =
                                      event.target.value;
                                  },
                                )
                              }
                            />
                            <Input
                              aria-label={`${translation.locale} product ${itemIndex + 1} preorder note`}
                              placeholder="Localized sourced preorder note"
                              value={translatedItem.attributes.preorderNote}
                              onChange={(event) =>
                                changeTranslation(
                                  translation.locale,
                                  (next) => {
                                    next.catalogSections[sectionIndex].items[
                                      itemIndex
                                    ].attributes.preorderNote =
                                      event.target.value;
                                  },
                                )
                              }
                            />
                            {translatedItem.attributes.allergens.length > 0 ? (
                              <p className="text-xs text-muted-foreground sm:col-span-2">
                                Sourced allergen terms remain unchanged:{" "}
                                {translatedItem.attributes.allergens.join(", ")}
                              </p>
                            ) : null}
                          </div>
                        ),
                      )}
                    </div>
                  ),
                )}

                {translation.integrationLabels.length > 0 ? (
                  <div className="grid gap-3 sm:grid-cols-2">
                    {translation.integrationLabels.map(
                      (label, integrationIndex) => (
                        <Field
                          key={integrationIndex}
                          label={`Link ${integrationIndex + 1} label`}
                        >
                          <Input
                            value={label}
                            onChange={(event) =>
                              changeTranslation(translation.locale, (next) => {
                                next.integrationLabels[integrationIndex] =
                                  event.target.value;
                              })
                            }
                          />
                        </Field>
                      ),
                    )}
                  </div>
                ) : null}
              </CardContent>
            </Card>
          ))}
        </div>

        <div className="xl:sticky xl:top-6 xl:h-[calc(100vh-3rem)]">
          <div className="h-full overflow-auto rounded-[2rem] border-[8px] border-[#171914] bg-white shadow-2xl">
            <SiteRenderer
              draft={draft}
              vertical={Vertical.FOOD_RETAIL}
              embedded
            />
          </div>
        </div>
      </main>
    </div>
  );
}
