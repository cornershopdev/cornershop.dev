import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowRight,
  CalendarCheck2,
  Check,
  Globe2,
  Images,
  MenuSquare,
  MousePointerClick,
  RefreshCcw,
  ShieldCheck,
  ShoppingBasket,
  Sparkles,
  type LucideIcon,
} from "lucide-react";
import { HomepageTransformation } from "@/components/homepage-transformation";
import { ImportForm } from "@/components/import-form";
import { SiteHeader } from "@/components/site-header";
import { nicheFontVariables } from "@/components/fonts/niche-font-scope";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  isVerticalClaimEnabled,
  isVerticalPubliclyAccessible,
  listPublicVerticals,
  resolveVerticalBySlug,
  resolveVerticalConfig,
  verticalSlug,
} from "@/lib/verticals/registry";
import type { MarketingIconName } from "@/lib/verticals/types";

/**
 * Every niche storefront — restofront.com today, a nails or barber domain next —
 * is this one page rendered from that vertical's `marketing` block. `proxy.ts`
 * rewrites a registered hostname's `/` here, so launching a niche is a config
 * entry plus a DNS record, and nothing in this file knows what a restaurant is.
 */

/**
 * The `MarketingIconName` union resolved to components. Exhaustive by type, so
 * adding a name to the union without a glyph here fails the build rather than
 * rendering an empty square on a live storefront.
 */
const icons: Record<MarketingIconName, LucideIcon> = {
  catalog: MenuSquare,
  imagery: Images,
  booking: CalendarCheck2,
  ordering: ShoppingBasket,
  refresh: RefreshCcw,
  shield: ShieldCheck,
  cursor: MousePointerClick,
};

// The niche set is fixed at build time — it is the vertical registry — so every
// storefront prerenders and `dynamicParams` keeps an unregistered slug a 404
// instead of an on-demand render of nothing.
export function generateStaticParams() {
  return listPublicVerticals().map((id) => ({ vertical: verticalSlug(id) }));
}

export const dynamicParams = false;

export async function generateMetadata({
  params,
}: {
  params: Promise<{ vertical: string }>;
}): Promise<Metadata> {
  const { vertical } = await params;
  const id = resolveVerticalBySlug(vertical);
  if (!id || !isVerticalPubliclyAccessible(id)) return {};
  const { marketing } = resolveVerticalConfig(id);
  const { mark } = marketing.brand;
  const title = `${marketing.brand.name} — ${marketing.hero.headline}`;
  const description = marketing.hero.subheadline;
  const canonical = marketing.domain
    ? `https://${marketing.domain}`
    : undefined;
  return {
    // Absolute so the root layout's "| Cornershopdev" template stays off a niche
    // storefront: a visitor on restofront.com should never see the factory's name
    // in their tab, and this page is the only public, indexed one that inherits it.
    title: { absolute: title },
    description,
    // Metadata objects merge shallowly, so a niche that leaves `openGraph` or
    // `twitter` unset inherits the factory's card wholesale — restofront.com
    // used to unfurl as "Cornershopdev" on X and Slack for exactly that reason.
    // Both are restated in full here, and the sibling `opengraph-image.tsx`
    // supplies the picture, so the card names the niche and nothing else.
    openGraph: {
      title,
      description,
      siteName: marketing.brand.name,
      type: "website",
      ...(canonical ? { url: canonical } : {}),
    },
    twitter: { card: "summary_large_image", title, description },
    // Relative image URLs (the sibling opengraph-image) resolve against this,
    // so a launched niche's card is fetched from its own domain rather than the
    // factory's. The proxy passes non-root paths on a niche hostname straight
    // through, which is what makes that URL reachable there.
    ...(canonical ? { metadataBase: new URL(canonical) } : {}),
    // A launched niche is served at both its own domain and this internal path.
    // The domain is the one that should rank, so it is declared canonical from
    // whichever of the two a crawler happens to reach.
    alternates: canonical ? { canonical } : undefined,
    // A niche with its own identity also owns its browser chrome. The factory
    // favicon remains the fallback for verticals that have not selected a mark.
    icons: mark
      ? {
          icon: [
            {
              url: mark.faviconSrc,
              type: "image/png",
              sizes: "32x32",
            },
          ],
          apple: [
            {
              url: mark.appleTouchIconSrc,
              type: "image/png",
              sizes: "180x180",
            },
          ],
        }
      : undefined,
  };
}

export default async function NichePage({
  params,
}: {
  params: Promise<{ vertical: string }>;
}) {
  const { vertical } = await params;
  const id = resolveVerticalBySlug(vertical);
  if (!id || !isVerticalPubliclyAccessible(id)) notFound();

  const { marketing } = resolveVerticalConfig(id);
  const slug = verticalSlug(id);
  const fontVariables = nicheFontVariables(id);
  const acquisitionPricing = isVerticalClaimEnabled(id)
    ? marketing.pricing
    : undefined;
  // Every route out of this page carries the niche, so a lead is attached to the
  // vertical that produced it before the studio ever opens.
  const createHref = `/create?vertical=${slug}`;
  const headerLinks = [
    { href: "#how-it-works", label: "How it works" },
    ...(marketing.themeGallery
      ? [{ href: "#themes", label: marketing.themeGallery.label }]
      : []),
    { href: "#features", label: "What stays yours" },
    ...(acquisitionPricing ? [{ href: "#pricing", label: "Pricing" }] : []),
  ];
  const formCopy = {
    vertical: slug,
    placeholder: marketing.form.placeholder,
    label: marketing.form.label,
    submitLabel: marketing.form.submitLabel,
    pendingLabel: marketing.form.pendingLabel,
  };

  return (
    <>
      <SiteHeader
        brand={{ ...marketing.brand }}
        links={headerLinks}
        createHref={createHref}
        fontVariables={fontVariables}
      />
      <main>
        <section className="paper-grid overflow-hidden border-b">
          <div
            className={`mx-auto grid max-w-7xl gap-10 px-5 pb-16 pt-16 lg:items-center lg:px-8 lg:pb-24 lg:pt-20 ${
              marketing.heroVisual === "transformation"
                ? "lg:grid-cols-[0.92fr_1.08fr]"
                : "max-w-4xl text-center"
            }`}
          >
            <div
              className={`relative z-10 self-center ${
                marketing.heroVisual === "transformation"
                  ? ""
                  : "mx-auto flex flex-col items-center"
              }`}
            >
              <Badge
                variant="secondary"
                className="mb-6 rounded-full border border-primary/15 bg-primary/8 px-3 py-1 text-primary"
              >
                <Sparkles className="size-3" />
                {marketing.hero.badge}
              </Badge>
              <h1 className="font-display text-balance max-w-2xl text-[clamp(4.2rem,8vw,7.6rem)] leading-[0.83] tracking-[-0.055em]">
                {marketing.hero.headline}
              </h1>
              <p className="mt-7 max-w-xl text-balance text-lg leading-8 text-muted-foreground">
                {marketing.hero.subheadline}
              </p>
              <ImportForm className="mt-9" {...formCopy} />
              {marketing.themeGallery ? (
                <Link
                  href="#themes"
                  className="mt-4 inline-flex items-center gap-2 text-sm font-semibold text-primary"
                >
                  {marketing.themeGallery.label}
                  <ArrowRight className="size-4" />
                </Link>
              ) : null}
              <div className="mt-5 flex flex-wrap gap-x-5 gap-y-2 text-xs text-muted-foreground">
                {marketing.hero.proofPoints.map((point) => (
                  <span key={point} className="flex items-center gap-1.5">
                    <Check className="size-3.5 text-primary" /> {point}
                  </span>
                ))}
              </div>
            </div>

            {marketing.heroVisual === "transformation" ? (
              <HomepageTransformation brandName={marketing.brand.name} />
            ) : null}
          </div>
        </section>

        <section
          id="how-it-works"
          className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32"
        >
          <div className="grid gap-12 lg:grid-cols-[0.8fr_1.2fr]">
            <div>
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                Less onboarding. More done.
              </p>
              <h2 className="font-display mt-4 max-w-md text-6xl leading-[0.92] tracking-[-0.045em]">
                Start with the finished thing.
              </h2>
            </div>
            <div className="divide-y border-y">
              {marketing.steps.map((step) => (
                <div
                  key={step.number}
                  className="grid gap-3 py-7 sm:grid-cols-[64px_1fr_1.4fr] sm:items-start"
                >
                  <span className="font-mono text-xs text-primary">
                    {step.number}
                  </span>
                  <h3 className="font-medium">{step.title}</h3>
                  <p className="text-sm leading-6 text-muted-foreground">
                    {step.copy}
                  </p>
                </div>
              ))}
            </div>
          </div>
        </section>

        {marketing.themeGallery ? (
          <section
            id="themes"
            className="border-y bg-card/40"
          >
            <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
              <div className="grid gap-10 lg:grid-cols-[0.85fr_1.15fr] lg:items-end">
                <div>
                  <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                    {marketing.themeGallery.section.eyebrow}
                  </p>
                  <h2 className="font-display mt-4 max-w-lg text-6xl leading-[0.92] tracking-[-0.045em]">
                    {marketing.themeGallery.section.headline}
                  </h2>
                </div>
                <div className="max-w-xl lg:justify-self-end">
                  <p className="text-sm leading-6 text-muted-foreground">
                    {marketing.themeGallery.section.copy}
                  </p>
                  <Link
                    href={marketing.themeGallery.href}
                    prefetch={false}
                    className="mt-5 inline-flex items-center gap-2 text-sm font-semibold text-primary"
                  >
                    {marketing.themeGallery.section.ctaLabel}
                    <ArrowRight className="size-4" />
                  </Link>
                </div>
              </div>

              <div className="mt-12 grid gap-4 md:grid-cols-3">
                {marketing.themeGallery.previews.map((theme, index) => (
                  <Link
                    key={theme.id}
                    href={theme.href}
                    prefetch={false}
                    className="group flex min-h-48 flex-col border bg-background p-6 transition-colors hover:border-primary/40"
                  >
                    <span className="font-mono text-[11px] text-primary">
                      0{index + 1} · {theme.id}
                    </span>
                    <h3 className="font-display mt-6 text-3xl leading-[0.95] tracking-[-0.04em]">
                      {theme.name}
                    </h3>
                    <p className="mt-3 flex-1 text-sm leading-6 text-muted-foreground">
                      {theme.blurb}
                    </p>
                    <span className="mt-6 inline-flex items-center gap-2 text-sm font-medium text-foreground transition-colors group-hover:text-primary">
                      View theme
                      <ArrowRight className="size-3.5" />
                    </span>
                  </Link>
                ))}
              </div>
            </div>
          </section>
        ) : null}

        <section id="features" className="bg-[#1d241f] text-white">
          <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
            <div className="flex flex-col gap-8 border-b border-white/15 pb-12 md:flex-row md:items-end md:justify-between">
              <div>
                <p className="text-xs font-semibold uppercase tracking-[0.18em] text-[#dc8d6d]">
                  {marketing.valueProps.eyebrow}
                </p>
                <h2 className="font-display mt-4 max-w-3xl text-6xl leading-[0.9] tracking-[-0.045em] md:text-7xl">
                  {marketing.valueProps.headline}
                </h2>
              </div>
              <p className="max-w-sm text-sm leading-6 text-white/58">
                {marketing.valueProps.copy}
              </p>
            </div>

            <div className="grid md:grid-cols-2">
              {marketing.valueProps.items.map((item, index) => {
                const Icon = icons[item.icon];
                return (
                  <article
                    key={item.title}
                    className={`min-h-64 border-white/15 p-7 md:p-10 ${
                      index % 2 === 0 ? "md:border-r" : ""
                    } ${index < 2 ? "border-b" : ""}`}
                  >
                    <Icon className="size-5 text-[#dc8d6d]" />
                    <h3 className="mt-12 text-xl font-medium">{item.title}</h3>
                    <p className="mt-3 max-w-md text-sm leading-6 text-white/55">
                      {item.copy}
                    </p>
                  </article>
                );
              })}
            </div>
          </div>
        </section>

        <section className="overflow-hidden border-b">
          <div className="mx-auto grid max-w-7xl lg:grid-cols-2">
            <div className="relative min-h-[500px]">
              <Image
                src={marketing.imagery.imageUrl}
                alt={marketing.imagery.imageAlt}
                fill
                className="object-cover"
                sizes="(max-width: 1024px) 100vw, 50vw"
              />
            </div>
            <div className="flex flex-col justify-center px-6 py-20 md:px-16 lg:py-24">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {marketing.imagery.eyebrow}
              </p>
              <h2 className="font-display mt-4 text-6xl leading-[0.92] tracking-[-0.045em]">
                {marketing.imagery.headline}
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-muted-foreground">
                {marketing.imagery.copy}
              </p>
              <div className="mt-8 grid gap-4 sm:grid-cols-2">
                {marketing.imagery.assurances.map((assurance) => {
                  const Icon = icons[assurance.icon];
                  return (
                    <div
                      key={assurance.copy}
                      className="rounded-xl border bg-card p-4 text-sm"
                    >
                      <Icon className="mb-3 size-4 text-primary" />
                      {assurance.copy}
                    </div>
                  );
                })}
              </div>
            </div>
          </div>
        </section>

        {acquisitionPricing ? (
          <section
            id="pricing"
            className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32"
          >
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-xs font-semibold uppercase tracking-[0.18em] text-primary">
                {acquisitionPricing.eyebrow}
              </p>
              <h2 className="font-display mt-4 text-6xl leading-[0.92] tracking-[-0.045em]">
                {acquisitionPricing.headline}
              </h2>
              <p className="mt-5 text-muted-foreground">
                {acquisitionPricing.copy}
              </p>
            </div>
            <div
              className={`mx-auto mt-12 grid gap-5 ${
                acquisitionPricing.plans.length > 1
                  ? "max-w-4xl md:grid-cols-2"
                  : "max-w-xl"
              }`}
            >
              {acquisitionPricing.plans.map((plan) => (
                <div
                  key={plan.name}
                  className={
                    plan.featured
                      ? "rounded-3xl border border-primary/40 bg-primary p-7 text-primary-foreground shadow-xl"
                      : "rounded-3xl border bg-card p-7"
                  }
                >
                  <div className="flex items-center justify-between">
                    <p className="text-sm font-semibold">{plan.name}</p>
                    {plan.badge ? (
                      <Badge className="bg-white/15 text-white">
                        {plan.badge}
                      </Badge>
                    ) : null}
                  </div>
                  <p className="mt-5 font-display text-6xl tracking-[-0.05em]">
                    {plan.price}
                    <span
                      className={`font-sans text-sm tracking-normal ${
                        plan.featured ? "text-white/70" : "text-muted-foreground"
                      }`}
                    >
                      {plan.cadence}
                    </span>
                  </p>
                  <p
                    className={`mt-3 text-sm ${
                      plan.featured ? "text-white/70" : "text-muted-foreground"
                    }`}
                  >
                    {plan.copy}
                  </p>
                  <ul className="mt-7 space-y-3 text-sm">
                    {plan.features.map((feature) => (
                      <li key={feature} className="flex items-center gap-2">
                        <Check
                          className={`size-4 ${
                            plan.featured ? "" : "text-primary"
                          }`}
                        />{" "}
                        {feature}
                      </li>
                    ))}
                  </ul>
                  <Button
                    render={<Link href={createHref} />}
                    nativeButton={false}
                    variant={plan.featured ? "secondary" : "outline"}
                    className={`mt-8 w-full ${
                      plan.featured
                        ? "bg-white text-primary hover:bg-white/90"
                        : ""
                    }`}
                  >
                    Build a free preview
                  </Button>
                </div>
              ))}
            </div>
          </section>
        ) : null}

        <section className="paper-grid border-t">
          <div className="mx-auto flex max-w-5xl flex-col items-center px-5 py-24 text-center lg:py-32">
            <Globe2 className="size-6 text-primary" />
            <h2 className="font-display text-balance mt-6 text-6xl leading-[0.9] tracking-[-0.05em] md:text-7xl">
              {marketing.closing.headline}
            </h2>
            <p className="mt-6 max-w-xl text-muted-foreground">
              {marketing.closing.copy}
            </p>
            <ImportForm compact className="mt-9" {...formCopy} />
          </div>
        </section>
      </main>

      <footer className="border-t bg-[#1d241f] text-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-8 px-5 py-10 text-sm text-white/55 sm:flex-row sm:items-center sm:justify-between lg:px-8">
          <span className="font-semibold text-white">
            {marketing.brand.name}
          </span>
          <span>{marketing.footerTagline}</span>
          <Link
            href={createHref}
            className="flex items-center gap-1.5 text-white"
          >
            Build a preview <ArrowRight className="size-3.5" />
          </Link>
        </div>
      </footer>
    </>
  );
}
