import type { Metadata } from "next";
import Image from "next/image";
import Link from "next/link";
import {
  ArrowRight,
  ArrowUpRight,
  Blocks,
  Check,
  Database,
  GitBranch,
  Globe2,
  Layers3,
  ScanLine,
  Sparkles,
  Terminal,
  Workflow,
} from "lucide-react";
import { FactoryAnalytics } from "@/components/factory-analytics";
import { SiteHeader } from "@/components/site-header";
import { factoryFontVariables } from "@/components/fonts/factory-font-scope";
import { FACTORY_BRAND } from "@/lib/brand";
import { factoryProductCatalog } from "@/lib/factory-products";
import { listRestaurantThemeManifests } from "@/lib/site-themes/restaurant/registry";
import styles from "./factory-home.module.css";

const REPO_URL = "https://github.com/cornershopdev/cornershop.dev";

export const metadata: Metadata = {
  title: "Cornershopdev — one factory for every local business",
  description:
    "An open-source website factory that scans an existing business, structures what it finds, and publishes a focused storefront for its trade.",
};

const pipeline = [
  {
    number: "01",
    command: "scan(source)",
    title: "Recover the business",
    copy: "Read the existing site, menu or service list, imagery, hours, contact details, and the tools customers already use.",
  },
  {
    number: "02",
    command: "structure(vertical)",
    title: "Apply the niche schema",
    copy: "Restaurant data becomes a menu. Salon data becomes services and durations. The shared engine never flattens every trade into generic blocks.",
  },
  {
    number: "03",
    command: "render(theme)",
    title: "Match a registered system",
    copy: "AI selects from bounded layouts and tokens built for the business model. It does not improvise fragile production CSS.",
  },
  {
    number: "04",
    command: "publish(domain)",
    title: "Claim, connect, keep current",
    copy: "The owner reviews a private preview, chooses a plan, connects the domain, and keeps the website maintained from one workspace.",
  },
];

const platform = [
  {
    icon: Layers3,
    label: "Vertical registry",
    title: "A trade is configuration, not a fork.",
    copy: "Schema, providers, prompts, templates, vocabulary, and positioning live together. Register a vertical once and the factory knows how to sell and build it.",
  },
  {
    icon: Database,
    label: "Shared operations",
    title: "One data model behind every brand.",
    copy: "Sites, leads, claims, subscriptions, analytics, and domains share the same operational layer without leaking the factory brand into customer-facing sites.",
  },
  {
    icon: Workflow,
    label: "Durable pipeline",
    title: "Import first. Ask questions second.",
    copy: "A business sees a populated preview instead of an empty wizard. Missing details become a small review task, not a multi-hour setup project.",
  },
  {
    icon: GitBranch,
    label: "Open source",
    title: "Inspect it, extend it, run it.",
    copy: "Next.js, Postgres, durable workflows, and a typed registry. The product is usable as a service and legible as infrastructure.",
  },
];

export default function Home() {
  const products = factoryProductCatalog();
  const themes = listRestaurantThemeManifests();
  const primaryNiche = products.launched[0] ?? products.next;

  return (
    <div
      className={`${factoryFontVariables} ${styles.factoryShell} min-h-screen font-sans`}
    >
      <FactoryAnalytics />
      <SiteHeader
        brand={FACTORY_BRAND}
        inverse
        links={[
          { href: "#products", label: "Products" },
          { href: "#system", label: "System" },
          { href: "/themes/restaurant", label: "Themes" },
          { href: REPO_URL, label: "GitHub" },
        ]}
        createHref="/create"
        ctaLabel="Build a site"
        fontVariables={factoryFontVariables}
      />

      <main>
        <section className={`${styles.factoryGrid} overflow-hidden border-b border-white/10`}>
          <div className="mx-auto grid min-h-[calc(100svh-4rem)] max-w-7xl lg:grid-cols-[1.08fr_0.92fr]">
            <div className="flex flex-col justify-center border-white/10 px-5 py-20 lg:border-r lg:px-8 lg:py-28">
              <div className="mb-8 inline-flex w-fit items-center gap-2 rounded-full border border-white/12 bg-white/[0.035] px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-white/66">
                <span className={styles.statusDot} />
                Website factory · system online
              </div>
              <h1 className="max-w-4xl text-balance text-[clamp(3.65rem,7.5vw,7.25rem)] font-semibold leading-[0.88] tracking-[-0.065em] text-white">
                The system behind your next local website.
              </h1>
              <p className="mt-7 max-w-2xl text-balance text-base leading-7 text-white/58 md:text-lg md:leading-8">
                One workspace to scan an existing business, recover what
                matters, and publish a focused website built for its trade—not
                another blank template wearing different colours.
              </p>

              <div className="mt-9 flex flex-col gap-3 sm:flex-row">
                <Link
                  href="/create"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/82 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                >
                  Build a local site
                  <ArrowRight className="size-4" />
                </Link>
                {primaryNiche?.marketing.domain ? (
                  <a
                    href={`https://${primaryNiche.marketing.domain}`}
                    target="_blank"
                    rel="noreferrer noopener"
                    className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/16 bg-white/[0.035] px-5 text-sm font-medium text-white transition-colors hover:border-white/28 hover:bg-white/[0.07] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white focus-visible:ring-offset-2 focus-visible:ring-offset-black"
                  >
                    Explore {primaryNiche.marketing.brand.name}
                    <ArrowUpRight className="size-4" />
                  </a>
                ) : null}
              </div>

              <div className="mt-8 flex flex-wrap gap-x-6 gap-y-2 font-mono text-[11px] uppercase tracking-[0.08em] text-white/58">
                <span className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#74d7a4]" />
                  Preview before payment
                </span>
                <span className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#74d7a4]" />
                  Existing tools stay
                </span>
                <span className="flex items-center gap-2">
                  <Check className="size-3.5 text-[#74d7a4]" />
                  Self-hostable
                </span>
              </div>
            </div>

            <div className="relative flex items-center px-5 py-14 lg:px-10 lg:py-20">
              <div className={`${styles.systemPanel} relative w-full overflow-hidden rounded-2xl border border-white/12 bg-[#090909]`}>
                <div className="flex h-11 items-center justify-between border-b border-white/10 px-4">
                  <div className="flex items-center gap-2">
                    <span className="size-2 rounded-full bg-[#ff775f]" />
                    <span className="size-2 rounded-full bg-white/22" />
                    <span className="size-2 rounded-full bg-white/12" />
                  </div>
                  <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
                    factory/run
                  </span>
                </div>

                <div className="p-5 sm:p-6">
                  <div className="flex items-center gap-2 font-mono text-xs">
                    <Terminal className="size-3.5 text-[#ff775f]" />
                    <span className="text-white/55">$</span>
                    <span className="text-white/76">cornershop build</span>
                    <span className={styles.cursor} />
                  </div>

                  <div className="mt-7 space-y-3 font-mono text-[11px] leading-5 sm:text-xs">
                    <DataRow label="source" value="restaurant.example" />
                    <DataRow label="vertical" value="restaurant" signal />
                    <DataRow label="content" value="menu · hours · bookings" />
                    <DataRow
                      label="theme"
                      value={themes[0]?.id ?? "registered-system"}
                      signal
                    />
                  </div>

                  <div className="my-7 h-px bg-white/10" />

                  <div className="grid grid-cols-[1fr_auto_1fr] items-center gap-2 sm:gap-3">
                    <SystemNode icon={ScanLine} label="scan" detail="source" />
                    <ArrowRight className="size-3.5 text-white/50" />
                    <SystemNode icon={Blocks} label="shape" detail="schema" />
                    <div className="col-span-3 mx-auto h-5 w-px bg-white/12" />
                    <SystemNode icon={Sparkles} label="match" detail="theme" />
                    <ArrowRight className="size-3.5 text-white/50" />
                    <SystemNode icon={Globe2} label="ship" detail="domain" />
                  </div>

                  <div className="mt-7 flex items-center justify-between border-t border-white/10 pt-4 font-mono text-[10px] uppercase tracking-[0.1em]">
                    <span className="text-white/52">private preview</span>
                    <span className="flex items-center gap-2 text-[#74d7a4]">
                      <span className={styles.statusDot} />
                      ready to claim
                    </span>
                  </div>
                </div>
              </div>
            </div>
          </div>

          <div className="border-t border-white/10 bg-black/30">
            <div className="mx-auto grid max-w-7xl divide-y divide-white/10 sm:grid-cols-3 sm:divide-x sm:divide-y-0">
              <Metric value={products.launched.length} label="live niche product" />
              <Metric value={themes.length} label="restaurant theme systems" />
              <Metric
                value={products.registeredCount}
                label="verticals in the registry"
              />
            </div>
          </div>
        </section>

        <section id="products" className="border-b border-white/10">
          <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
            <SectionIntro
              eyebrow="Products, not presets"
              title="One engine. Brands that speak the trade."
              copy="Cornershopdev stays behind the curtain. Each niche gets the language, workflows, themes, and domain its customers already understand."
            />

            <div className="mt-12 grid gap-4">
              {products.launched.map(({ slug, marketing }) => (
                <article
                  key={slug}
                  className="group flex min-h-[360px] flex-col border border-white/10 bg-white/[0.025] p-6 transition-colors hover:border-white/20 hover:bg-white/[0.04] sm:p-8"
                >
                  <div className="flex items-start justify-between gap-4">
                    <div className="flex items-center gap-3">
                      {marketing.brand.mark ? (
                        <Image
                          src={marketing.brand.mark.src}
                          alt=""
                          width={40}
                          height={40}
                          className="size-10 rounded-xl"
                        />
                      ) : (
                        <span className="grid size-10 place-items-center rounded-xl border border-white/12 bg-white/6 font-mono text-[11px] font-semibold text-white">
                          {marketing.brand.initials}
                        </span>
                      )}
                      <div>
                        <h3 className="font-semibold tracking-[-0.02em] text-white">
                          {marketing.brand.name}
                        </h3>
                        <p className="mt-1 font-mono text-[10px] text-white/55">
                          {marketing.domain ?? `/niche/${slug}`}
                        </p>
                      </div>
                    </div>
                    <span className="inline-flex items-center gap-2 border border-white/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/55">
                      <span className={styles.statusDot} />
                      live
                    </span>
                  </div>

                  <p className="mt-12 font-mono text-[10px] uppercase tracking-[0.14em] text-[#ff775f]">
                    Built for {marketing.audience}
                  </p>
                  <p className="mt-3 max-w-lg text-2xl font-medium leading-tight tracking-[-0.035em] text-white sm:text-3xl">
                    {marketing.tagline}
                  </p>

                  <div className="mt-auto flex flex-wrap items-center gap-4 pt-10 text-sm">
                    {marketing.domain ? (
                      <a
                        href={`https://${marketing.domain}`}
                        target="_blank"
                        rel="noreferrer noopener"
                        className="inline-flex items-center gap-2 font-medium text-white transition-colors hover:text-white/72"
                      >
                        Visit product
                        <ArrowUpRight className="size-3.5" />
                      </a>
                    ) : null}
                    {marketing.themeGallery ? (
                      <Link
                        href={marketing.themeGallery.href}
                        className="inline-flex items-center gap-2 text-white/55 transition-colors hover:text-white"
                      >
                        {marketing.themeGallery.label}
                        <ArrowRight className="size-3.5" />
                      </Link>
                    ) : null}
                  </div>
                </article>
              ))}
            </div>

            {products.next ? (
              <aside className="mt-4 grid gap-6 border border-dashed border-white/12 bg-white/[0.015] px-6 py-6 sm:grid-cols-[auto_1fr_auto] sm:items-center sm:px-8">
                <span className="grid size-11 place-items-center rounded-xl border border-white/12 bg-white/[0.035] font-mono text-[11px] font-semibold text-white/72">
                  {products.next.marketing.brand.initials}
                </span>
                <div>
                  <p className="font-mono text-[9px] uppercase tracking-[0.14em] text-[#ff775f]">
                    Next niche · in development
                  </p>
                  <div className="mt-2 flex flex-wrap items-baseline gap-x-3 gap-y-1">
                    <h3 className="text-lg font-semibold tracking-[-0.025em] text-white">
                      {products.next.marketing.brand.name}
                    </h3>
                    <span className="text-sm text-white/52">
                      Built for {products.next.marketing.audience}
                    </span>
                  </div>
                  <p className="mt-2 max-w-2xl text-sm leading-6 text-white/58">
                    {products.next.marketing.tagline}
                  </p>
                </div>
                <span className="w-fit border border-white/10 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.12em] text-white/52">
                  No public preview yet
                </span>
              </aside>
            ) : null}
          </div>
        </section>

        <section className={`${styles.moduleGrid} border-b border-white/10`}>
          <div className="mx-auto grid max-w-7xl gap-12 px-5 py-24 lg:grid-cols-[0.8fr_1.2fr] lg:px-8 lg:py-32">
            <div>
              <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#ff775f]">
                Restaurant theme library
              </p>
              <h2 className="mt-5 max-w-lg text-balance text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-white md:text-6xl">
                Familiar commerce patterns. Hospitality-specific decisions.
              </h2>
              <p className="mt-6 max-w-lg text-base leading-7 text-white/52">
                The library borrows interaction conventions diners already know
                from ordering and booking products, then adapts them to an
                independent restaurant’s own brand. AI matches the system; it
                does not invent one on every scan.
              </p>
              <Link
                href="/themes/restaurant"
                className="mt-8 inline-flex items-center gap-2 text-sm font-semibold text-white"
              >
                Inspect the theme library
                <ArrowRight className="size-4" />
              </Link>
            </div>

            <div className="border border-white/10 bg-[#080808]">
              <div className="flex items-center justify-between border-b border-white/10 px-5 py-4 font-mono text-[10px] uppercase tracking-[0.12em] text-white/55">
                <span>packages/themes/restaurant</span>
                <span>{themes.length} registered</span>
              </div>
              <div className="divide-y divide-white/10">
                {themes.map((theme, index) => (
                  <Link
                    key={theme.id}
                    href={`/themes/restaurant/${theme.id}`}
                    className="group grid gap-3 px-5 py-5 transition-colors hover:bg-white/[0.035] sm:grid-cols-[52px_1fr_auto] sm:items-center"
                  >
                    <span className="font-mono text-xs text-white/52">
                      0{index + 1}
                    </span>
                    <span>
                      <span className="block text-sm font-medium text-white">
                        {theme.name}
                      </span>
                      <span className="mt-1 block text-xs leading-5 text-white/55">
                        {theme.bestFor.slice(0, 2).join(" · ")}
                      </span>
                    </span>
                    <ArrowUpRight className="size-4 text-white/52 transition-colors group-hover:text-[#ff775f]" />
                  </Link>
                ))}
              </div>
            </div>
          </div>
        </section>

        <section id="system" className="border-b border-white/10">
          <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
            <SectionIntro
              eyebrow="From source to storefront"
              title="A pipeline built around the finished thing."
              copy="The factory begins with evidence from the business, not a blank canvas. Every stage narrows ambiguity before the owner is asked to review anything."
            />

            <div className="mt-12 divide-y divide-white/10 border-y border-white/10">
              {pipeline.map((step) => (
                <article
                  key={step.number}
                  className="grid gap-4 py-7 sm:grid-cols-[64px_0.7fr_1fr_1.2fr] sm:items-start lg:py-9"
                >
                  <span className="font-mono text-[11px] text-white/52">
                    {step.number}
                  </span>
                  <code className="font-mono text-xs text-[#ff775f]">
                    {step.command}
                  </code>
                  <h3 className="font-medium tracking-[-0.02em] text-white">
                    {step.title}
                  </h3>
                  <p className="max-w-xl text-sm leading-6 text-white/58">
                    {step.copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className="border-b border-white/10 bg-[#080808]">
          <div className="mx-auto max-w-7xl px-5 py-24 lg:px-8 lg:py-32">
            <SectionIntro
              eyebrow="The shared core"
              title="Small-business software without the generic shell."
              copy="Each customer sees a product for their trade. The expensive operational machinery stays shared, typed, and inspectable."
            />
            <div className="mt-12 grid border-l border-t border-white/10 md:grid-cols-2">
              {platform.map((item) => (
                <article
                  key={item.title}
                  className="min-h-72 border-b border-r border-white/10 p-7 sm:p-9"
                >
                  <div className="flex items-center justify-between">
                    <item.icon className="size-5 text-[#ff775f]" />
                    <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-white/52">
                      {item.label}
                    </span>
                  </div>
                  <h3 className="mt-14 max-w-md text-xl font-medium tracking-[-0.03em] text-white">
                    {item.title}
                  </h3>
                  <p className="mt-3 max-w-md text-sm leading-6 text-white/58">
                    {item.copy}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section className={`${styles.factoryGrid} overflow-hidden`}>
          <div className="mx-auto flex max-w-5xl flex-col items-center px-5 py-24 text-center lg:py-36">
            <span className="grid size-11 place-items-center rounded-xl border border-white/12 bg-white/[0.035]">
              <Globe2 className="size-5 text-[#ff775f]" />
            </span>
            <p className="mt-8 font-mono text-[11px] uppercase tracking-[0.14em] text-white/55">
              Pick the vertical. See the result.
            </p>
            <h2 className="mt-5 max-w-4xl text-balance text-5xl font-semibold leading-[0.92] tracking-[-0.06em] text-white md:text-7xl">
              Start with the business, not the builder.
            </h2>
            <p className="mt-7 max-w-2xl text-balance text-base leading-7 text-white/52">
              Explore the live restaurant product, inspect the registered theme
              systems, or open the source and build the next trade.
            </p>
            <div className="mt-9 flex flex-col gap-3 sm:flex-row">
              {primaryNiche?.marketing.domain ? (
                <a
                  href={`https://${primaryNiche.marketing.domain}`}
                  target="_blank"
                  rel="noreferrer noopener"
                  className="inline-flex h-11 items-center justify-center gap-2 rounded-lg bg-white px-5 text-sm font-semibold text-black transition-colors hover:bg-white/82"
                >
                  Visit {primaryNiche.marketing.brand.name}
                  <ArrowUpRight className="size-4" />
                </a>
              ) : null}
              <Link
                href="/themes/restaurant"
                className="inline-flex h-11 items-center justify-center gap-2 rounded-lg border border-white/16 bg-white/[0.035] px-5 text-sm font-medium text-white transition-colors hover:bg-white/[0.07]"
              >
                Browse restaurant themes
                <ArrowRight className="size-4" />
              </Link>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t border-white/10 bg-black">
        <div className="mx-auto grid max-w-7xl gap-8 px-5 py-10 text-sm sm:grid-cols-[1fr_auto_auto] sm:items-center lg:px-8">
          <span className="font-semibold text-white">Cornershopdev</span>
          <span className="font-mono text-[10px] uppercase tracking-[0.12em] text-white/52">
            One factory · every corner shop
          </span>
          <a
            href={REPO_URL}
            target="_blank"
            rel="noreferrer noopener"
            className="inline-flex items-center gap-1.5 text-white/66 transition-colors hover:text-white"
          >
            GitHub
            <ArrowUpRight className="size-3.5" />
          </a>
        </div>
      </footer>
    </div>
  );
}

function DataRow({
  label,
  value,
  signal = false,
}: {
  label: string;
  value: string;
  signal?: boolean;
}) {
  return (
    <div className="grid grid-cols-[72px_1fr] gap-3">
      <span className="text-white/55">{label}</span>
      <span className={signal ? "text-[#74d7a4]" : "text-white/66"}>
        {value}
      </span>
    </div>
  );
}

function SystemNode({
  icon: Icon,
  label,
  detail,
}: {
  icon: typeof ScanLine;
  label: string;
  detail: string;
}) {
  return (
    <div className="border border-white/10 bg-white/[0.025] px-3 py-4 text-center">
      <Icon className="mx-auto size-4 text-white/66" />
      <p className="mt-2 font-mono text-[10px] uppercase tracking-[0.12em] text-white/62">
        {label}
      </p>
      <p className="mt-1 font-mono text-[9px] text-white/52">{detail}</p>
    </div>
  );
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-baseline gap-3 px-5 py-5 lg:px-8">
      <span className="font-mono text-lg text-white">{String(value).padStart(2, "0")}</span>
      <span className="font-mono text-[9px] uppercase tracking-[0.12em] text-white/52">
        {label}
      </span>
    </div>
  );
}

function SectionIntro({
  eyebrow,
  title,
  copy,
}: {
  eyebrow: string;
  title: string;
  copy: string;
}) {
  return (
    <div className="grid gap-8 lg:grid-cols-[1.1fr_0.9fr] lg:items-end">
      <div>
        <p className="font-mono text-[11px] uppercase tracking-[0.14em] text-[#ff775f]">
          {eyebrow}
        </p>
        <h2 className="mt-5 max-w-3xl text-balance text-4xl font-semibold leading-[0.98] tracking-[-0.055em] text-white md:text-6xl">
          {title}
        </h2>
      </div>
      <p className="max-w-xl text-sm leading-7 text-white/58 lg:justify-self-end">
        {copy}
      </p>
    </div>
  );
}
