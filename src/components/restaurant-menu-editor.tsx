"use client";

import { useState } from "react";
import {
  AlertTriangle,
  ArrowDown,
  ArrowUp,
  Check,
  Languages,
  LoaderCircle,
  Plus,
  RotateCcw,
  Save,
  Trash2,
  Undo2,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader } from "@/components/ui/card";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Textarea } from "@/components/ui/textarea";
import type { RestaurantDraft } from "@/lib/restaurant";
import {
  restaurantAvailabilityLabel,
  SUPPORTED_MENU_CURRENCIES,
  type MenuValidationIssue,
  type RestaurantMenuMutation,
} from "@/lib/restaurant-menu-editor";

export function RestaurantMenuEditor({
  draft,
  dirty,
  saving,
  saveError,
  validationIssues,
  canUndo,
  regeneratingLocale,
  onMutation,
  onTranslationChange,
  onReviewTranslation,
  onRegenerateTranslation,
  onUndo,
  onSave,
}: {
  draft: RestaurantDraft;
  dirty: boolean;
  saving: boolean;
  saveError: string | null;
  validationIssues: MenuValidationIssue[];
  canUndo: boolean;
  regeneratingLocale: string | null;
  onMutation: (mutation: RestaurantMenuMutation, destructive?: boolean) => void;
  onTranslationChange: (
    locale: string,
    updater: (
      translation: RestaurantDraft["translations"][number],
    ) => void,
  ) => void;
  onReviewTranslation: (locale: string) => void;
  onRegenerateTranslation: (locale: string) => void;
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
            Menu editor
          </p>
          <h1 className="font-display mt-2 text-5xl leading-none tracking-[-0.045em]">
            The menu, structured.
          </h1>
          <p className="mt-3 max-w-2xl text-sm leading-6 text-muted-foreground">
            Maintain the canonical menu, then regenerate and review each
            translated draft before publishing.
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Button
            variant="outline"
            size="sm"
            onClick={onUndo}
            disabled={!canUndo}
          >
            <Undo2 /> Undo deletion
          </Button>
          {canonical ? (
            <Button
              size="sm"
              onClick={() => onMutation({ type: "add-section" })}
            >
              <Plus /> Add section
            </Button>
          ) : null}
          <Button size="sm" onClick={onSave} disabled={saving || !dirty}>
            {saving ? <LoaderCircle className="animate-spin" /> : <Save />}
            {dirty ? "Save menu" : "Saved"}
          </Button>
        </div>
      </div>

      <Card className="mt-8">
        <CardContent className="flex flex-col gap-4 pt-6 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex flex-wrap gap-2" aria-label="Menu locale">
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
                  activeLocale === candidate.locale ? "default" : "outline"
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
          {dirty ? (
            <Badge variant="outline">Unsaved changes</Badge>
          ) : (
            <Badge className="bg-emerald-600 text-white">Saved</Badge>
          )}
        </CardContent>
      </Card>

      {saveError ? (
        <div className="mt-4 flex items-center justify-between gap-4 rounded-xl border border-red-200 bg-red-50 p-4 text-sm text-red-900">
          <span className="flex items-center gap-2">
            <AlertTriangle className="size-4" />
            {saveError}
          </span>
          <Button variant="outline" size="sm" onClick={onSave}>
            Retry
          </Button>
        </div>
      ) : null}
      {validationIssues.length > 0 ? (
        <div className="mt-4 rounded-xl border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
          <p className="font-semibold">Fix these fields before saving:</p>
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
              <div className="flex items-center gap-2">
                <Languages className="size-4" />
                <p className="font-semibold">
                  {translation.locale.toUpperCase()} translation
                </p>
                <Badge
                  variant={
                    translation.status === "current"
                      ? "secondary"
                      : "outline"
                  }
                >
                  {translation.status}
                </Badge>
              </div>
              <p className="mt-2 max-w-2xl text-xs leading-5 text-muted-foreground">
                Canonical changes mark this copy stale. Regeneration can change
                text only; structure, prices, currency, availability and images
                remain canonical.
              </p>
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                size="sm"
                onClick={() =>
                  onRegenerateTranslation(translation.locale)
                }
                disabled={dirty || regeneratingLocale !== null}
              >
                {regeneratingLocale === translation.locale ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <RotateCcw />
                )}
                Regenerate
              </Button>
              <Button
                size="sm"
                onClick={() => onReviewTranslation(translation.locale)}
                disabled={translation.status === "current"}
              >
                <Check /> Mark reviewed
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="mt-5 space-y-5">
        {(canonical ? draft.menuSections : translation?.menuSections ?? []).map(
          (section, sectionIndex) => (
            <Card key={`${activeLocale}-${sectionIndex}`}>
              <CardHeader className="gap-4">
                <div className="grid flex-1 gap-3 md:grid-cols-[1fr_1.5fr]">
                  <div>
                    <Label htmlFor={`section-${activeLocale}-${sectionIndex}`}>
                      Section name
                    </Label>
                    <Input
                      id={`section-${activeLocale}-${sectionIndex}`}
                      className="mt-2"
                      value={section.name}
                      onChange={(event) =>
                        canonical
                          ? onMutation({
                              type: "update-section",
                              sectionIndex,
                              name: event.target.value,
                            })
                          : onTranslationChange(activeLocale, (current) => {
                              current.menuSections[sectionIndex].name =
                                event.target.value;
                            })
                      }
                    />
                  </div>
                  <div>
                    <Label
                      htmlFor={`section-description-${activeLocale}-${sectionIndex}`}
                    >
                      Section description
                    </Label>
                    <Input
                      id={`section-description-${activeLocale}-${sectionIndex}`}
                      className="mt-2"
                      value={section.description}
                      onChange={(event) =>
                        canonical
                          ? onMutation({
                              type: "update-section",
                              sectionIndex,
                              description: event.target.value,
                            })
                          : onTranslationChange(activeLocale, (current) => {
                              current.menuSections[
                                sectionIndex
                              ].description = event.target.value;
                            })
                      }
                    />
                  </div>
                </div>
                {canonical ? (
                  <div className="flex flex-wrap gap-2">
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Move ${section.name} up`}
                      disabled={sectionIndex === 0}
                      onClick={() =>
                        onMutation({
                          type: "move-section",
                          sectionIndex,
                          direction: -1,
                        })
                      }
                    >
                      <ArrowUp />
                    </Button>
                    <Button
                      variant="outline"
                      size="icon-sm"
                      aria-label={`Move ${section.name} down`}
                      disabled={sectionIndex === draft.menuSections.length - 1}
                      onClick={() =>
                        onMutation({
                          type: "move-section",
                          sectionIndex,
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
                        onMutation({ type: "add-item", sectionIndex })
                      }
                    >
                      <Plus /> Add item
                    </Button>
                    <Button
                      variant="outline"
                      size="sm"
                      disabled={draft.menuSections.length === 1}
                      onClick={() =>
                        onMutation(
                          { type: "delete-section", sectionIndex },
                          true,
                        )
                      }
                    >
                      <Trash2 /> Delete section
                    </Button>
                  </div>
                ) : null}
              </CardHeader>
              <CardContent className="space-y-4">
                {section.items.map((item, itemIndex) => {
                  const canonicalItem =
                    draft.menuSections[sectionIndex].items[itemIndex];
                  return (
                    <div
                      key={`${activeLocale}-${sectionIndex}-${itemIndex}`}
                      className="rounded-xl border bg-muted/20 p-4"
                    >
                      <div className="grid gap-4 lg:grid-cols-2">
                        <Field label="Item name">
                          <Input
                            value={item.name}
                            onChange={(event) =>
                              canonical
                                ? onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: { name: event.target.value },
                                  })
                                : onTranslationChange(
                                    activeLocale,
                                    (current) => {
                                      current.menuSections[
                                        sectionIndex
                                      ].items[itemIndex].name =
                                        event.target.value;
                                    },
                                  )
                            }
                          />
                        </Field>
                        <Field label="Description">
                          <Textarea
                            value={item.description}
                            onChange={(event) =>
                              canonical
                                ? onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: {
                                      description: event.target.value,
                                    },
                                  })
                                : onTranslationChange(
                                    activeLocale,
                                    (current) => {
                                      current.menuSections[
                                        sectionIndex
                                      ].items[itemIndex].description =
                                        event.target.value;
                                    },
                                  )
                            }
                          />
                        </Field>
                      </div>
                      {canonical ? (
                        <>
                          <div className="mt-4 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
                            <Field label="Price">
                              <Input
                                type="number"
                                min="0"
                                step="0.01"
                                value={canonicalItem.price ?? ""}
                                onChange={(event) =>
                                  onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: {
                                      price:
                                        event.target.value === ""
                                          ? null
                                          : Number(event.target.value),
                                    },
                                  })
                                }
                              />
                            </Field>
                            <Field label="Currency">
                              <select
                                className="border-input bg-background h-9 w-full rounded-md border px-3 text-sm"
                                value={canonicalItem.currency}
                                onChange={(event) =>
                                  onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: {
                                      currency: event.target
                                        .value as typeof canonicalItem.currency,
                                    },
                                  })
                                }
                              >
                                {SUPPORTED_MENU_CURRENCIES.map((currency) => (
                                  <option key={currency}>{currency}</option>
                                ))}
                              </select>
                            </Field>
                            <Field label="Dietary labels">
                              <Input
                                value={canonicalItem.dietaryLabels.join(", ")}
                                placeholder="vegan, gluten-free"
                                onChange={(event) =>
                                  onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: {
                                      dietaryLabels: event.target.value
                                        .split(",")
                                        .map((label) => label.trim())
                                        .filter(Boolean)
                                        .slice(0, 6),
                                    },
                                  })
                                }
                              />
                            </Field>
                            <div className="flex items-end">
                              <div className="flex h-9 w-full items-center justify-between rounded-md border bg-background px-3">
                                <Label
                                  htmlFor={`available-${sectionIndex}-${itemIndex}`}
                                >
                                  {restaurantAvailabilityLabel(
                                    canonicalItem.available,
                                  )}
                                </Label>
                                <Switch
                                  id={`available-${sectionIndex}-${itemIndex}`}
                                  checked={canonicalItem.available === true}
                                  onCheckedChange={(available) =>
                                    onMutation({
                                      type: "update-item",
                                      sectionIndex,
                                      itemIndex,
                                      changes: { available },
                                    })
                                  }
                                />
                              </div>
                            </div>
                          </div>
                          <div className="mt-4 grid gap-4 lg:grid-cols-[1fr_auto]">
                            <Field label="Approved image URL">
                              <Input
                                value={canonicalItem.imageUrl ?? ""}
                                placeholder="https://… or /approved/image.webp"
                                onChange={(event) =>
                                  onMutation({
                                    type: "update-item",
                                    sectionIndex,
                                    itemIndex,
                                    changes: {
                                      imageUrl: event.target.value || null,
                                      imageProvenance: event.target.value
                                        ? "owner"
                                        : null,
                                    },
                                  })
                                }
                              />
                            </Field>
                            <div className="flex items-end gap-2">
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`Move ${canonicalItem.name} up`}
                                disabled={itemIndex === 0}
                                onClick={() =>
                                  onMutation({
                                    type: "move-item",
                                    sectionIndex,
                                    itemIndex,
                                    direction: -1,
                                  })
                                }
                              >
                                <ArrowUp />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`Move ${canonicalItem.name} down`}
                                disabled={
                                  itemIndex ===
                                  draft.menuSections[sectionIndex].items
                                    .length -
                                    1
                                }
                                onClick={() =>
                                  onMutation({
                                    type: "move-item",
                                    sectionIndex,
                                    itemIndex,
                                    direction: 1,
                                  })
                                }
                              >
                                <ArrowDown />
                              </Button>
                              <Button
                                variant="outline"
                                size="icon-sm"
                                aria-label={`Delete ${canonicalItem.name}`}
                                onClick={() =>
                                  onMutation(
                                    {
                                      type: "delete-item",
                                      sectionIndex,
                                      itemIndex,
                                    },
                                    true,
                                  )
                                }
                              >
                                <Trash2 />
                              </Button>
                            </div>
                          </div>
                        </>
                      ) : (
                        <p className="mt-3 text-xs text-muted-foreground">
                          {canonicalItem.price === null
                            ? "No price"
                            : `${canonicalItem.price} ${canonicalItem.currency}`}
                          {" · "}
                          {canonicalItem.available === null
                            ? "availability unknown"
                            : canonicalItem.available
                              ? "available"
                              : "unavailable"}
                        </p>
                      )}
                    </div>
                  );
                })}
              </CardContent>
            </Card>
          ),
        )}
      </div>
    </div>
  );
}
