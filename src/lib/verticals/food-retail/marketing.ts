import type { VerticalMarketing } from "@/lib/verticals/types";

/**
 * Discovery stays operator-only, while approved previews can be claimed through
 * Cornershopdev's factory identity and published on the platform subdomain.
 * A future niche domain can replace that factory surface without changing the
 * vertical's evidence and review rules.
 */
export const foodRetailMarketing = {
  publiclyAccessible: false,
  hostnames: [],
  domain: null,
  brand: { name: "Shopfront Food", initials: "SF" },
  email: null,
  audience: "bakeries, pâtisseries, butchers, delis and local food shops",
  tagline: "Products, pickup and hours—clear before the customer sets out.",
  heroVisual: "none",
  hero: {
    badge: "The counter, online before opening time.",
    headline: "Turn today’s range into tomorrow’s orders.",
    subheadline:
      "Recover real products, seasonal notes, pickup details and existing preorder links in a mobile storefront built for local food retail—not restaurant reservations.",
    proofPoints: [
      "Private preview first",
      "Existing ordering stays",
      "No invented stock or prices",
    ],
  },
  form: {
    placeholder: "Shop website or business name",
    label: "Food shop website or business name",
    submitLabel: "Show my preview",
    pendingLabel: "Opening the shop",
  },
  signIn: {
    title: "Open your shop.",
    description:
      "Enter the owner email used when the website was claimed. No password needed.",
    emailPlaceholder: "owner@shop.com",
    emptyPrompt: "No site yet?",
    createLabel: "Build a preview",
    createHref: "/create?vertical=food_retail",
  },
  steps: [
    {
      number: "01",
      title: "Share the current website",
      copy: "The factory recovers product ranges, prices, hours, pickup details, photography and existing order links.",
    },
    {
      number: "02",
      title: "Check every sourced fact",
      copy: "Products stay empty when the source is empty. Allergens appear only with their source page attached.",
    },
    {
      number: "03",
      title: "Claim and keep it current",
      copy: "Publish only after review, then retain the ordering and delivery systems customers already know.",
    },
  ],
  valueProps: {
    eyebrow: "A storefront for the trade",
    headline: "Retail conversion without restaurant theatre.",
    copy: "The site helps a customer choose, check availability, find the shop and follow a real preorder link. It never invents a table to reserve.",
    items: [
      {
        icon: "catalog",
        title: "Structured product ranges",
        copy: "Bread, pastries, cuts, cheeses and prepared foods stay in the categories the shop actually publishes.",
      },
      {
        icon: "imagery",
        title: "Real shop photography",
        copy: "Source and owner-approved images show the counter and products without generating a different item.",
      },
      {
        icon: "ordering",
        title: "Preorders stay connected",
        copy: "Existing order, click-and-collect and delivery links remain the source of truth.",
      },
      {
        icon: "refresh",
        title: "Seasonal facts stay reviewable",
        copy: "Hours, ranges and seasonal notes can change without rebuilding the storefront.",
      },
    ],
  },
  imagery: {
    imageUrl:
      "https://images.unsplash.com/photo-1509440159596-0249088772ff?auto=format&fit=crop&w=1400&q=85",
    imageAlt: "Fresh bread displayed in a local bakery",
    eyebrow: "Photography with provenance",
    headline: "Show what is genuinely on the counter.",
    copy: "Live pages use source or owner-approved photography. Product identity, finish, portion and packaging are never regenerated into something the shop does not sell.",
    assurances: [
      {
        icon: "shield",
        copy: "No invented products, prices, stock, allergens or pickup promises",
      },
      {
        icon: "cursor",
        copy: "Owner review before any product image goes live",
      },
    ],
  },
  pricing: {
    eyebrow: "One founding offer",
    headline: "A maintained local storefront.",
    copy: "Claim the reviewed preview for €49/month through Cornershopdev. Local currency is shown at checkout.",
    plans: [
      {
        name: "Founding",
        price: "€49",
        cadence: "/month",
        copy: "One maintained, mobile-first food-retail website on the business's own domain.",
        features: [
          "Mobile-first product ranges",
          "Existing preorder and delivery links",
          "Store hours, location and pickup details",
          "Sourced allergen labels only",
        ],
        featured: true,
        badge: "Founding offer",
      },
    ],
  },
  closing: {
    headline: "Put the real counter online.",
    copy: "Start with the shop’s current public information and review every fact before launch.",
  },
  footerTagline: "Products, pickup and hours—without invented facts.",
} satisfies VerticalMarketing;
