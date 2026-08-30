import { listFeaturedRestaurantThemeManifests } from "@/lib/site-themes/restaurant/registry";
import type { VerticalMarketing } from "@/lib/verticals/types";

/**
 * Restofrontapp is the restaurant niche's public brand. The platform rename to
 * Cornershopdev covers the factory, not the storefronts it ships. A visitor on
 * restofront.com should never see the factory's name, the same way a visitor to
 * a generated site never sees either.
 */
const restaurantThemePreviews = listFeaturedRestaurantThemeManifests().map(
  (theme) => ({
    id: theme.id,
    name: theme.name,
    blurb: theme.bestFor[0] ?? theme.description,
    href: `/themes/restaurant/${theme.id}`,
  }),
);

export const restaurantMarketing = {
  publiclyAccessible: true,
  hostnames: ["restofront.com", "www.restofront.com"],
  domain: "restofront.com",
  brand: {
    name: "Restofrontapp",
    initials: "RA",
    mark: {
      src: "/brand/restofrontapp/mark.png",
      faviconSrc: "/brand/restofrontapp/favicon-32.png",
      appleTouchIconSrc: "/brand/restofrontapp/apple-touch-icon.png",
    },
  },
  // send.restofront.com is the verified sending subdomain; replies land on the
  // niche root domain, which is the Resend receiving domain for this vertical.
  email: {
    from: "Vincent from Restofrontapp <vincent@send.restofront.com>",
    replyTo: "vincent@restofront.com",
  },
  audience: "restaurants",
  tagline: "Menus, bookings and hours that stay current on their own.",
  heroVisual: "transformation",
  hero: {
    badge: "Your old site in. A finished one out.",
    headline: "Your front door, always current.",
    subheadline:
      "Give us the restaurant. Get back a polished mobile-first website with the menu already inside—and keep the booking and ordering tools that already work.",
    proofPoints: ["No setup call", "Private preview first", "€49/month"],
  },
  form: {
    placeholder: "Restaurant website or name",
    label: "Restaurant website or name",
    submitLabel: "Show my preview",
    pendingLabel: "Opening your restaurant",
  },
  signIn: {
    title: "Open your restaurant.",
    description:
      "Enter the owner email used when the website was claimed. No password needed.",
    emailPlaceholder: "owner@restaurant.com",
    emptyPrompt: "No site yet?",
    createLabel: "Build a preview",
    createHref: "/create?vertical=restaurant",
  },
  themeGallery: {
    href: "/themes",
    label: "Themes",
    section: {
      eyebrow: "Theme library",
      headline: "Three starting points. A full gallery next.",
      copy: "The homepage shows the strongest general fits. Open the gallery for every registered restaurant system—shaped by patterns diners already recognize from the best hospitality storefronts.",
      ctaLabel: "Open the full gallery",
    },
    previews: restaurantThemePreviews,
  },
  steps: [
    {
      number: "01",
      title: "Drop the old website",
      copy: "Paste a URL or restaurant name. Restofrontapp recovers the menu, contact details, imagery and current integrations.",
    },
    {
      number: "02",
      title: "Review the finished preview",
      copy: "A private mobile-first site arrives ready to inspect—not another empty template asking for setup work.",
    },
    {
      number: "03",
      title: "Claim it and go live",
      copy: "Claim the founding plan, connect the domain, and keep every booking and ordering system already in place.",
    },
  ],
  valueProps: {
    eyebrow: "The digital presence custodian",
    headline: "We improve the website. Not your whole operation.",
    copy: "Restofrontapp sits around the systems a restaurant already trusts, presenting them beautifully without forcing a painful migration.",
    items: [
      {
        icon: "catalog",
        title: "A menu people can actually use",
        copy: "Structured, searchable and designed for thumbs—not a tiny PDF trapped behind three taps.",
      },
      {
        icon: "imagery",
        title: "The restaurant's own photography",
        copy: "Live pages use source photos or images the owner has approved—not invented dishes sold as a paid extra.",
      },
      {
        icon: "booking",
        title: "Bookings stay untouched",
        copy: "OpenTable, SevenRooms, Resy, TheFork and custom booking links remain the source of truth.",
      },
      {
        icon: "refresh",
        title: "Always-current presence",
        copy: "Menu, hours and integration checks become an ongoing service, not another redesign project.",
      },
    ],
  },
  imagery: {
    imageUrl:
      "https://images.unsplash.com/photo-1515003197210-e0cd71810b5f?auto=format&fit=crop&w=1400&q=85",
    imageAlt: "Restaurant dish photographed in natural light",
    eyebrow: "Real photography, not fantasy food",
    headline: "Show the restaurant as it is.",
    copy: "Restofrontapp recovers the restaurant's existing photography. Anything that was not on the source site stays off the live page until the owner approves it.",
    assurances: [
      {
        icon: "shield",
        copy: "No invented prices, allergens or booking availability",
      },
      {
        icon: "cursor",
        copy: "Owner review before any image goes live",
      },
    ],
  },
  pricing: {
    eyebrow: "The founding offer",
    headline: "Less than one empty table.",
    copy: "Preview first. Pay only when the restaurant wants to claim and publish it. One plan, no setup fee. Local currency is shown at checkout; VAT is added when applicable.",
    plans: [
      {
        name: "Founding",
        price: "€49",
        cadence: "/month",
        copy: "One maintained, mobile-first restaurant website on the restaurant's own domain.",
        features: [
          "Mobile-first website and menu",
          "Existing booking and ordering links",
          "Custom domain and SSL",
          "Owner workspace and menu edits",
          "Hosting, booking-request inbox, and first-party reporting",
        ],
        featured: true,
        badge: "Founding offer",
      },
    ],
  },
  closing: {
    headline: "See the restaurant before asking it to change.",
    copy: "Paste one website. Restofrontapp will do the first draft.",
  },
  footerTagline: "Your restaurant's front door, always current.",
} satisfies VerticalMarketing;
