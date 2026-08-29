"use client";

import { useEffect, useRef, useState, type ComponentProps } from "react";
import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Check,
  CircleAlert,
  ExternalLink,
  Globe2,
  LoaderCircle,
  Monitor,
  RotateCcw,
  Smartphone,
} from "lucide-react";
import { Vertical } from "@/generated/prisma/enums";
import { Brand } from "@/components/brand";
import { InstantSitePreview } from "@/components/instant-restaurant-preview";
import { SiteRenderer } from "@/components/site-renderer";
import { Button } from "@/components/ui/button";
import { Field } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Progress } from "@/components/ui/progress";
import type { BrandContext } from "@/lib/brand-context";
import { sampleSiteDraft } from "@/lib/restaurant";
import type { ImportUrls } from "@/lib/import-identity";
import type { SiteDraftView } from "@/lib/site-draft";
import {
  isVerticalClaimEnabled,
  listVerticalIds,
} from "@/lib/verticals/registry";
import type { VerticalId } from "@/lib/verticals/types";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

type Stage = {
  label: string;
  threshold: number;
};

/**
 * Everything on this screen that has to name the kind of business, kept out of
 * the JSX and keyed by vertical. `satisfies Record<VerticalId, VerticalCopy>`
 * makes registering a vertical without writing its copy a build error here, so
 * the picker can never silently offer an option with restaurant wording.
 */
type VerticalCopy = {
  label: string;
  eyebrow: string;
  sourceLabel: string;
  placeholder: string;
  opening: string;
  idlePrompt: string;
  recovering: string;
  emptyStatePrompt: string;
  claimHint: string;
  catalogStage: string;
  integrationsStage: string;
  previewCatalogLabel: string;
  previewCards: Array<{ title: string; copy: string }>;
};

const verticalCopy = {
  [Vertical.RESTAURANT]: {
    label: "Restaurant",
    eyebrow: "New restaurant",
    sourceLabel: "Restaurant website or name",
    placeholder: "restaurant.com or restaurant name",
    opening: "Opening the restaurant",
    idlePrompt:
      "Paste a website or restaurant name. The preview stays private until it is claimed and paid.",
    recovering:
      "The shape is already here. We are recovering the real menu, imagery and existing links now.",
    emptyStatePrompt:
      "Start with a website or restaurant name. No account is needed to see the result.",
    claimHint:
      "Review the menu and existing links, then claim the founding plan to keep this site current.",
    catalogStage: "Recover menu and details",
    integrationsStage: "Preserve booking and ordering",
    previewCatalogLabel: "Menu",
    previewCards: [
      { title: "Menu & prices", copy: "Reading the source" },
      { title: "Bookings", copy: "Checking existing links" },
      { title: "Ordering", copy: "Keeping what works" },
    ],
  },
  [Vertical.BEAUTY]: {
    label: "Salon & barber",
    eyebrow: "New salon",
    sourceLabel: "Salon website or name",
    placeholder: "salon.com or salon name",
    opening: "Opening the salon",
    idlePrompt:
      "Paste a website or salon name. The preview stays private and is not chargeable.",
    recovering:
      "The shape is already here. We are recovering the real service list, imagery and existing links now.",
    emptyStatePrompt:
      "Start with a website or salon name. No account is needed to see the result.",
    claimHint:
      "Review the recovered services and booking links in this private preview.",
    catalogStage: "Recover services and prices",
    // No ordering or delivery: a salon has nothing to deliver, which is the same
    // reason `beauty/providers.ts` ships no hints for those integration types.
    integrationsStage: "Preserve existing booking links",
    previewCatalogLabel: "Services",
    previewCards: [
      { title: "Services & prices", copy: "Reading the source" },
      { title: "Hours", copy: "Checking business details" },
      { title: "Appointments", copy: "Keeping booking links" },
    ],
  },
  [Vertical.LOCAL_SERVICE]: {
    label: "Local trade",
    eyebrow: "New local trade",
    sourceLabel: "Trade website or business name",
    placeholder: "trade website or business name",
    opening: "Opening the trade business",
    idlePrompt:
      "Paste a plumber, electrician, builder, repair trade or artisan website. The first draft is deterministic and stays private until the owner claims it.",
    recovering:
      "The shape is already here. We are recovering sourced services, branding, hours, service evidence and existing contact links now.",
    emptyStatePrompt:
      "Start with a trade website or business name. No account is needed to see the result.",
    claimHint:
      "Review every service, availability statement, credential, project and contact link, then claim the €49 founding plan.",
    catalogStage: "Recover services and evidence",
    integrationsStage: "Preserve phone, WhatsApp and quote links",
    previewCatalogLabel: "Services",
    previewCards: [
      { title: "Services", copy: "Reading the source" },
      { title: "Hours & coverage", copy: "Checking business details" },
      { title: "Contact", copy: "Keeping existing links" },
    ],
  },
  [Vertical.FOOD_RETAIL]: {
    label: "Local food shop",
    eyebrow: "New food shop",
    sourceLabel: "Shop website or name",
    placeholder: "bakery.com or shop name",
    opening: "Opening the shop",
    idlePrompt:
      "Paste a bakery, pâtisserie, butcher, deli or local food shop website. The first storefront stays private until the owner claims it.",
    recovering:
      "The shape is already here. We are recovering real product ranges, seasonal notes, hours, pickup details and existing order links now.",
    emptyStatePrompt:
      "Start with a food shop website or name. No account is needed to see the result.",
    claimHint:
      "Review every product, price, availability note, allergen source and ordering link, then claim the €49 founding plan.",
    catalogStage: "Recover product ranges and prices",
    integrationsStage: "Preserve preorder, pickup and delivery links",
    previewCatalogLabel: "Product ranges",
    previewCards: [
      { title: "Products & prices", copy: "Reading the source" },
      { title: "Hours & pickup", copy: "Checking shop details" },
      { title: "Preorders", copy: "Keeping existing links" },
    ],
  },
} satisfies Record<VerticalId, VerticalCopy>;

/**
 * Read from the registry rather than written out here, so a newly registered
 * vertical appears in the picker without touching this list.
 */
const verticalOptions = listVerticalIds();

function buildStages(copy: VerticalCopy): Stage[] {
  return [
    { label: "Read existing website", threshold: 12 },
    { label: copy.catalogStage, threshold: 42 },
    { label: copy.integrationsStage, threshold: 58 },
    { label: "Compose mobile-first design", threshold: 65 },
    { label: "Check and save private preview", threshold: 95 },
  ];
}

/**
 * The import API speaks the shared site shape and names the vertical it produced,
 * which is everything the renderer needs — this component never learns what a
 * restaurant is beyond the demo fixture below.
 */
type ImportedSite = {
  draft: SiteDraftView;
  vertical: VerticalId;
};

type ImportResponse =
  | ({
      mode: "inline";
      importJobId: string;
      urls: ImportUrls;
    } & ImportedSite)
  | { mode: "workflow"; runId: string; importJobId: string }
  | { error: string };

/**
 * `initialVertical` is the niche the lead arrived through — the storefront that
 * sent them, not a guess. It only seeds the picker: the visitor can still change
 * it here, and whatever is selected at submit is what the lead is attached to.
 *
 * `initialBrand` is the Host header's brand, resolved server-side, and stays
 * the rendered brand for the whole session: the page's `generateMetadata`
 * already committed to it, so the header can't drift from the metadata just
 * because the visitor toggles the vertical picker. `initialVertical` is a
 * separate, changeable seed for the picker — it can never itself say "no
 * niche" the way a hostname can, which is why the two are split.
 */
export function ImportStudio({
  initialSource,
  initialVertical,
  initialBrand,
}: {
  initialSource: string;
  initialVertical: VerticalId;
  initialBrand: BrandContext;
}) {
  const hasInitialSource = Boolean(initialSource.trim());
  const [source, setSource] = useState(initialSource);
  const [previewSource, setPreviewSource] = useState(initialSource);
  const [vertical, setVertical] = useState<VerticalId>(initialVertical);
  const [progress, setProgress] = useState(hasInitialSource ? 6 : 0);
  const [message, setMessage] = useState(
    hasInitialSource
      ? verticalCopy[initialVertical].opening
      : "Ready when you are",
  );
  const [site, setSite] = useState<ImportedSite | null>(null);
  const [urls, setUrls] = useState<ImportUrls | null>(null);
  const [externalPreviewAvailable, setExternalPreviewAvailable] =
    useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(hasInitialSource);
  const [device, setDevice] = useState<"mobile" | "desktop">("mobile");
  const startedSource = useRef<string | null>(null);

  const copy = verticalCopy[vertical];
  const stages = buildStages(copy);
  // The header always wears the request-host brand, not the vertical the
  // picker currently has selected: `src/app/create/page.tsx` already
  // resolved `initialBrand` from the Host header for this page's metadata,
  // and toggling the picker must not make the chrome disagree with it. The
  // picker still drives the copy and import behavior below via `vertical`.
  // The back link stays "/" because host-based routing already resolves it
  // to whichever site they came from.
  const brand = initialBrand;

  async function runImport(value = source) {
    const cleanSource = value.trim();
    if (!cleanSource) return;

    startedSource.current = cleanSource;
    setPreviewSource(cleanSource);
    setLoading(true);
    setSite(null);
    setUrls(null);
    setError(null);
    setProgress(6);
    setMessage(copy.opening);

    try {
      const response = await fetch("/api/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ source: cleanSource, vertical }),
      });
      const result = (await response.json()) as ImportResponse;
      if (!response.ok || "error" in result) {
        throw new Error(
          "error" in result ? result.error : "The preview could not be created",
        );
      }

      if (result.mode === "inline") {
        complete(
          { draft: result.draft, vertical: result.vertical },
          result.urls,
        );
        return;
      }

      const events = new EventSource(
        `/api/workflows/${encodeURIComponent(result.runId)}/events?importJobId=${encodeURIComponent(result.importJobId)}`,
      );
      events.onmessage = (event) => {
        let update:
          | {
              type: "progress";
              progress: number;
              message: string;
            }
          | ({
              type: "complete";
              importJobId: string;
              urls: ImportUrls;
            } & ImportedSite)
          | { type: "failed"; message: string };
        try {
          update = JSON.parse(event.data) as typeof update;
        } catch {
          events.close();
          setError("The workflow returned an unreadable update");
          setLoading(false);
          return;
        }
        if (update.type === "progress") {
          setProgress(update.progress);
          setMessage(update.message);
        }
        if (update.type === "complete") {
          events.close();
          complete(
            { draft: update.draft, vertical: update.vertical },
            update.urls,
          );
        }
        if (update.type === "failed") {
          events.close();
          setError(update.message);
          setLoading(false);
        }
      };
      events.onerror = () => {
        events.close();
        setError("The generation connection was interrupted. Try again.");
        setLoading(false);
      };
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "The preview could not be created",
      );
      setLoading(false);
    }
  }

  function complete(
    nextSite: ImportedSite,
    nextUrls: ImportUrls,
    previewAvailable = true,
  ) {
    setProgress(100);
    setMessage("Private preview ready");
    setSite(nextSite);
    setUrls(nextUrls);
    setExternalPreviewAvailable(previewAvailable);
    setLoading(false);
  }

  useEffect(() => {
    if (initialSource && startedSource.current !== initialSource) {
      void runImport(initialSource);
    }
    // runImport is intentionally called once per initial URL.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialSource]);

  function useDemo() {
    if (vertical === Vertical.LOCAL_SERVICE) {
      setSource(sampleLocalServiceSiteDraft.name);
      setPreviewSource(sampleLocalServiceSiteDraft.name);
      setError(null);
      complete(
        {
          draft: sampleLocalServiceSiteDraft,
          vertical: Vertical.LOCAL_SERVICE,
        },
        {
          preview: `/preview/${sampleLocalServiceSiteDraft.slug}`,
          claim: `/claim/${sampleLocalServiceSiteDraft.slug}`,
        },
        false,
      );
      return;
    }
    if (vertical === Vertical.FOOD_RETAIL) {
      setSource(sampleFoodRetailDraft.name);
      setError(null);
      complete(
        { draft: sampleFoodRetailDraft, vertical: Vertical.FOOD_RETAIL },
        {
          preview: `/preview/${sampleFoodRetailDraft.slug}`,
          claim: `/claim/${sampleFoodRetailDraft.slug}`,
        },
        false,
      );
      return;
    }
    setSource("Osteria Luna");
    setVertical(Vertical.RESTAURANT);
    setError(null);
    complete(
      { draft: sampleSiteDraft, vertical: Vertical.RESTAURANT },
      {
        preview: `/preview/${sampleSiteDraft.slug}`,
        claim: `/claim/${sampleSiteDraft.slug}`,
      },
    );
  }

  return (
    <main className="min-h-screen bg-[#ece8de]">
      <header className="flex h-16 items-center justify-between border-b bg-background px-4 md:px-6">
        <div className="flex items-center gap-4">
          <Button
            render={<Link href="/" aria-label={`Back to ${brand.name}`} />}
            nativeButton={false}
            variant="ghost"
            size="icon-sm"
          >
            <ArrowLeft />
          </Button>
          <Brand {...brand} />
        </div>
        <div className="hidden items-center gap-2 sm:flex">
          <span className="mr-2 text-xs text-muted-foreground">
            Private preview · not published
          </span>
          <Button
            variant={device === "mobile" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDevice("mobile")}
            aria-label="Mobile preview"
          >
            <Smartphone />
          </Button>
          <Button
            variant={device === "desktop" ? "secondary" : "ghost"}
            size="icon-sm"
            onClick={() => setDevice("desktop")}
            aria-label="Desktop preview"
          >
            <Monitor />
          </Button>
        </div>
      </header>

      <div className="grid min-h-[calc(100vh-4rem)] lg:grid-cols-[390px_1fr]">
        <aside className="border-b bg-background p-5 lg:border-b-0 lg:border-r lg:p-7">
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-primary">
            {copy.eyebrow}
          </p>
          <h1 className="font-display mt-3 text-4xl leading-none tracking-[-0.04em]">
            {previewSource
              ? "Your first look is ready."
              : "Build the first version."}
          </h1>
          <p className="mt-4 text-sm leading-6 text-muted-foreground">
            {previewSource ? copy.recovering : copy.idlePrompt}
          </p>

          <form
            className="mt-7 space-y-3"
            aria-busy={loading}
            onSubmit={(event) => {
              event.preventDefault();
              void runImport();
            }}
          >
            <div
              className="flex flex-wrap gap-2"
              role="group"
              aria-label="Kind of business"
            >
              {verticalOptions.map((option) => (
                <Button
                  key={option}
                  type="button"
                  size="sm"
                  variant={option === vertical ? "secondary" : "outline"}
                  aria-pressed={option === vertical}
                  disabled={loading}
                  onClick={() => setVertical(option)}
                >
                  {verticalCopy[option].label}
                </Button>
              ))}
            </div>
            <Field
              label={copy.sourceLabel}
              controlId="import-source"
            >
              <ImportSourceControl
                value={source}
                onChange={(event) => setSource(event.target.value)}
                placeholder={copy.placeholder}
                disabled={loading}
                autoComplete="url"
                name="source"
                aria-invalid={error ? true : undefined}
                aria-describedby={error ? "import-source-error" : undefined}
              />
            </Field>
            <Button
              type="submit"
              className="w-full"
              disabled={!source.trim() || loading}
              aria-busy={loading}
            >
              {loading ? (
                <>
                  <LoaderCircle className="animate-spin" aria-hidden="true" />
                  Finishing the details
                </>
              ) : (
                <>
                  Build preview
                  <ArrowRight />
                </>
              )}
            </Button>
          </form>

          {loading || site ? (
            <div
              className="mt-8"
              role="status"
              aria-live="polite"
              aria-atomic="true"
            >
              <div className="flex items-center justify-between text-xs">
                <span className="font-medium">{message}</span>
                <span className="font-mono text-muted-foreground">
                  {progress}%
                </span>
              </div>
              <Progress value={progress} className="mt-3 h-1.5" />
              <div className="mt-6 space-y-4">
                {stages.map((stage) => {
                  const completeStage = progress >= stage.threshold;
                  return (
                    <div
                      key={stage.label}
                      className="flex items-center gap-3 text-sm"
                    >
                      <span
                        className={`grid size-5 place-items-center rounded-full border ${
                          completeStage
                            ? "border-primary bg-primary text-primary-foreground"
                            : "text-muted-foreground"
                        }`}
                      >
                        {completeStage ? (
                          <Check className="size-3" />
                        ) : (
                          <span className="size-1 rounded-full bg-current" />
                        )}
                      </span>
                      <span
                        className={
                          completeStage
                            ? "text-foreground"
                            : "text-muted-foreground"
                        }
                      >
                        {stage.label}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          ) : null}

          {error ? (
            <div className="mt-6 rounded-xl border border-destructive/25 bg-destructive/5 p-4">
              <div
                id="import-source-error"
                className="flex gap-2 text-sm text-destructive"
                role="alert"
              >
                <CircleAlert
                  className="mt-0.5 size-4 shrink-0"
                  aria-hidden="true"
                />
                <span>{error}</span>
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => void runImport()}
                >
                  <RotateCcw /> Retry
                </Button>
                <Button variant="ghost" size="sm" onClick={useDemo}>
                  Open demo instead
                </Button>
              </div>
            </div>
          ) : null}

          {site && urls ? (
            <div className="mt-8 rounded-2xl border border-primary/20 bg-primary/5 p-4">
              <div className="flex items-center gap-2 text-sm font-semibold">
                <span className="grid size-5 place-items-center rounded-full bg-primary text-primary-foreground">
                  <Check className="size-3" />
                </span>
                {isVerticalClaimEnabled(site.vertical)
                  ? "Ready to claim"
                  : "Private pilot preview"}
              </div>
              <p className="mt-2 text-xs leading-5 text-muted-foreground">
                {isVerticalClaimEnabled(site.vertical)
                  ? copy.claimHint
                  : "This vertical is a non-chargeable private preview. Owner tools are not available yet."}
              </p>
              {externalPreviewAvailable ? (
                <div className="mt-4 grid gap-2">
                  <Button
                    render={<Link href={urls.preview} target="_blank" />}
                    nativeButton={false}
                    variant="outline"
                  >
                    Preview
                    <ExternalLink />
                  </Button>
                  {isVerticalClaimEnabled(site.vertical) ? (
                    <Button
                      render={<Link href={urls.claim} />}
                      nativeButton={false}
                    >
                      Claim
                      <ArrowRight />
                    </Button>
                  ) : null}
                </div>
              ) : (
                <p className="mt-4 text-xs text-muted-foreground">
                  This demo remains in the preview above and has not created a
                  persisted or chargeable site.
                </p>
              )}
            </div>
          ) : null}
        </aside>

        <section className="relative overflow-hidden p-4 sm:p-7 lg:p-10">
          {!site && !previewSource ? (
            <div className="grid min-h-[720px] place-items-center rounded-[2rem] border border-dashed border-foreground/15 bg-background/40">
              <div className="max-w-sm px-6 text-center">
                <span className="mx-auto grid size-12 place-items-center rounded-full border bg-background">
                  <Smartphone className="size-5 text-muted-foreground" />
                </span>
                <h2 className="font-display mt-5 text-3xl tracking-[-0.03em]">
                  Preview appears here
                </h2>
                <p className="mt-3 text-sm leading-6 text-muted-foreground">
                  {copy.emptyStatePrompt}
                </p>
              </div>
            </div>
          ) : (
            <div
              className={`mx-auto transition-all duration-500 ${
                device === "mobile"
                  ? "max-w-[430px] rounded-[2.4rem] border-[9px] border-[#171914] p-1 shadow-2xl"
                  : "max-w-6xl rounded-[1.9rem] border-[8px] border-[#171914] p-1 shadow-2xl"
              }`}
            >
              <div
                className={`overflow-hidden bg-white ${
                  device === "mobile"
                    ? "max-h-[790px] rounded-[1.65rem]"
                    : "max-h-[790px] rounded-[1.15rem]"
                }`}
              >
                {site ? (
                  <SiteRenderer
                    draft={site.draft}
                    vertical={site.vertical}
                    embedded
                  />
                ) : (
                  <InstantSitePreview
                    source={previewSource}
                    message={message}
                    progress={progress}
                    status={error ? "error" : "loading"}
                    catalogLabel={copy.previewCatalogLabel}
                    detailCards={copy.previewCards}
                  />
                )}
              </div>
            </div>
          )}
        </section>
      </div>
    </main>
  );
}

function ImportSourceControl(props: ComponentProps<typeof Input>) {
  return (
    <div className="relative">
      <Globe2
        aria-hidden="true"
        className="pointer-events-none absolute left-3 top-3 size-4 text-muted-foreground"
      />
      <Input {...props} className="h-10 pl-9" />
    </div>
  );
}
