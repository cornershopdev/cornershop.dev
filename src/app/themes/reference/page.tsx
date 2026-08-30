import type { CSSProperties } from "react";
import type { Metadata } from "next";

import { Badge } from "@/components/ui/badge";
import { Stagger, motionProps } from "@/components/motion";
import {
  designReferenceVerticalSchema,
  type DesignReference,
  type DesignReferenceVertical,
} from "@/lib/site-themes/reference/contracts";
import {
  listDesignReferences,
  listDesignReferencesForVertical,
} from "@/lib/site-themes/reference/registry";

/**
 * Factory-internal design reference library.
 *
 * Deliberately noindex and unlinked from customer surfaces: these entries are
 * an internal aim point for theme authors, not a product page, and DESIGN.md
 * forbids exposing unlaunched verticals on public factory pages. Every card is
 * rendered from our own manifest data — swatches, specs and prose. No
 * third-party screenshot, markup or asset is served here.
 */
export const metadata: Metadata = {
  title: { absolute: "Design reference library" },
  robots: { index: false, follow: false },
};

const VERTICAL_LABELS: Record<DesignReferenceVertical, string> = {
  restaurant: "Restaurant",
  beauty: "Beauty",
  "food-retail": "Food retail",
  "local-service": "Local service",
};

function swatchStyle(color: string): CSSProperties {
  return { backgroundColor: color };
}

function ReferenceCard({ reference }: { reference: DesignReference }) {
  const swatches = [
    { label: "bg", value: reference.palette.background },
    { label: "fg", value: reference.palette.foreground },
    { label: "surface", value: reference.palette.surface },
    { label: "accent", value: reference.palette.accent },
    { label: "on-accent", value: reference.palette.accentForeground },
  ];

  return (
    <article className="flex min-w-0 flex-col overflow-hidden rounded-3xl border bg-card shadow-sm">
      <div
        className="flex flex-col gap-3 border-b p-6"
        style={{
          backgroundColor: reference.palette.background,
          color: reference.palette.foreground,
        }}
      >
        <p className="font-mono text-[11px] uppercase tracking-[0.18em] opacity-70">
          {reference.marketplace} · {reference.motionSignature.preset}
        </p>
        <p className="font-display text-3xl leading-[0.95] tracking-[-0.03em]">
          {reference.name}
        </p>
        <span
          className="w-fit rounded-full px-3 py-1 text-[11px] font-semibold uppercase tracking-[0.18em]"
          style={{
            backgroundColor: reference.palette.accent,
            color: reference.palette.accentForeground,
          }}
        >
          {reference.typePairing.register}
        </span>
      </div>

      <div className="flex flex-col gap-5 p-6">
        <div className="flex gap-2">
          {swatches.map((swatch) => (
            <div key={swatch.label} className="flex min-w-0 flex-1 flex-col gap-1">
              <div
                className="h-10 rounded-lg border"
                style={swatchStyle(swatch.value)}
              />
              <p className="truncate font-mono text-[10px] text-muted-foreground">
                {swatch.value}
              </p>
            </div>
          ))}
        </div>

        <p className="text-sm leading-relaxed text-muted-foreground">
          {reference.summary}
        </p>

        <dl className="grid gap-3 text-sm">
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Type pairing
            </dt>
            <dd className="mt-1 text-muted-foreground">
              {reference.typePairing.display} · {reference.typePairing.body}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Layout rhythm · {reference.layoutRhythm.density} ·{" "}
              {reference.layoutRhythm.imageTreatment}
            </dt>
            <dd className="mt-1 text-muted-foreground">
              {reference.layoutRhythm.note}
            </dd>
          </div>
          <div>
            <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
              Motion · {reference.motionSignature.durationMs}ms
            </dt>
            <dd className="mt-1 text-muted-foreground">
              {reference.motionSignature.note}
            </dd>
          </div>
        </dl>

        <div className="flex flex-wrap gap-2">
          {reference.fitSignals.verticals.map((vertical) => (
            <Badge key={vertical} variant="secondary" className="rounded-full">
              {VERTICAL_LABELS[vertical]}
            </Badge>
          ))}
        </div>

        <p className="rounded-2xl border border-dashed p-4 text-sm leading-relaxed">
          <span className="font-semibold">Takeaway. </span>
          {reference.takeaway}
        </p>

        <p className="font-mono text-[11px] text-muted-foreground">
          {reference.attribution}
        </p>
      </div>
    </article>
  );
}

export default function DesignReferencePage() {
  const references = listDesignReferences();
  const verticals =
    designReferenceVerticalSchema.options as readonly DesignReferenceVertical[];

  return (
    <main className="mx-auto max-w-7xl px-5 py-16 lg:px-8 lg:py-24">
      <header {...motionProps({ preset: "fade-in", className: "max-w-3xl" })}>
        <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
          Internal · not indexed
        </p>
        <h1 className="font-display mt-3 text-5xl leading-[0.9] tracking-[-0.045em] md:text-6xl">
          Design reference library
        </h1>
        <p className="mt-5 text-base leading-relaxed text-muted-foreground">
          {references.length} commercial storefront themes reduced to the four
          things that transfer: palette, type pairing, layout rhythm and motion
          register. Every palette here clears WCAG AA on all three text pairs.
          Nothing is copied — no markup, no stylesheet, no asset, no copy — and
          none of this is ever shown to a customer or presented as an
          affiliation.
        </p>
        <dl className="mt-8 flex flex-wrap gap-x-10 gap-y-4">
          {verticals.map((vertical) => (
            <div key={vertical}>
              <dt className="text-[11px] font-semibold uppercase tracking-[0.18em] text-primary">
                {VERTICAL_LABELS[vertical]}
              </dt>
              <dd className="font-display text-2xl">
                {listDesignReferencesForVertical(vertical).length}
              </dd>
            </div>
          ))}
        </dl>
      </header>

      <section
        {...motionProps({ preset: "rise-in", className: "mt-16", delayMs: 80 })}
      >
        <h2 className="text-[11px] font-semibold uppercase tracking-[0.18em] text-muted-foreground">
          References
        </h2>
        <Stagger className="mt-6 grid gap-6 md:grid-cols-2 xl:grid-cols-3">
          {references.map((reference) => (
            <div key={reference.id} {...motionProps({ preset: "reveal" })}>
              <ReferenceCard reference={reference} />
            </div>
          ))}
        </Stagger>
      </section>
    </main>
  );
}
