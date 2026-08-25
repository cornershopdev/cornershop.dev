import type { VerticalMarketing } from "@/lib/verticals/types";

/**
 * Built for public preview. Owner acquisition stays disabled until its
 * dedicated dashboard and evidence review are complete. It has no standalone
 * domain — hence no `hostnames` and a null `domain`. Pricing and founding-plan
 * copy are omitted: this is an explicitly non-chargeable pilot, not a sellable
 * niche.
 *
 * `heroVisual: "none"` because the restaurant transformation mock is a menu PDF
 * turning into a menu — dressing it up as a salon would be a lie about what the
 * product has actually produced for this niche.
 */
export const beautyMarketing = {
  publiclyAccessible: true,
  hostnames: [],
  domain: null,
  brand: { name: "Salonfront", initials: "SF" },
  // No domain yet, so no sending domain to verify either. Launching means a DNS
  // record, a verified sender, and these two strings — in that order.
  email: null,
  audience: "salons and barbers",
  tagline: "A service list and a booking button, recovered from the source.",
  heroVisual: "none",
  hero: {
    badge: "Your old site in. A finished preview out.",
    headline: "Every service, priced and bookable.",
    subheadline:
      "Give us the salon. Get back a private mobile-first preview with the full service list, durations and prices already inside—keeping the booking system your clients already use.",
    proofPoints: [
      "No setup call",
      "Private preview first",
      "Non-chargeable pilot",
    ],
  },
  form: {
    placeholder: "Salon website or name",
    label: "Salon website or name",
    submitLabel: "Show my preview",
    pendingLabel: "Opening your salon",
  },
  signIn: {
    title: "Open your salon preview.",
    description:
      "Enter the email used when this private preview was created. No password needed.",
    emailPlaceholder: "owner@salon.com",
    emptyPrompt: "No preview yet?",
    createLabel: "Build a preview",
    createHref: "/create?vertical=beauty",
  },
  steps: [
    {
      number: "01",
      title: "Drop the old website",
      copy: "Paste a URL or salon name. Salonfront recovers the service list, prices, contact details, imagery and current booking links.",
    },
    {
      number: "02",
      title: "Review the finished preview",
      copy: "A private mobile-first site arrives ready to inspect—not another empty template asking for setup work.",
    },
    {
      number: "03",
      title: "Keep it private for now",
      copy: "This is a non-chargeable pilot. The preview stays private while Salonfront is still in preview.",
    },
  ],
  valueProps: {
    eyebrow: "The digital presence custodian",
    headline: "We improve the website. Not your whole chair schedule.",
    copy: "Salonfront sits around the tools a salon already trusts, presenting them beautifully without forcing anyone to relearn a booking system.",
    items: [
      {
        icon: "catalog",
        title: "A service list clients can read",
        copy: "Every treatment with its duration and price, grouped and searchable—not a photo of a price board.",
      },
      {
        icon: "imagery",
        title: "Imagery that shows the room",
        copy: "Recover the best existing photography and fill the gaps with editorial images, never with invented results.",
      },
      {
        icon: "booking",
        title: "Bookings stay untouched",
        copy: "Booksy, Fresha, Treatwell, Planity and custom booking links remain the source of truth.",
      },
      {
        icon: "refresh",
        title: "A recovered snapshot of today",
        copy: "Prices, hours and booking links come from the current source site, ready to inspect in the private preview.",
      },
    ],
  },
  imagery: {
    imageUrl:
      "https://images.unsplash.com/photo-1521590832167-7bcbfaa6381f?auto=format&fit=crop&w=1400&q=85",
    imageAlt: "Salon interior photographed in natural light",
    eyebrow: "Credible imagery, not fantasy results",
    headline: "Fill the visual gaps without faking the work.",
    copy: "Salonfront prioritises real source photography, then creates complementary editorial images for missing categories. Skin, hair and nail results are never regenerated.",
    assurances: [
      {
        icon: "shield",
        copy: "No invented prices, durations or appointment availability",
      },
      {
        icon: "cursor",
        copy: "Every recovered image stays inspectable in the private preview",
      },
    ],
  },
  closing: {
    headline: "See the salon before asking it to change.",
    copy: "Paste one website. Salonfront will do the first draft. Nothing is billed.",
  },
  footerTagline: "Every service, priced and bookable.",
} satisfies VerticalMarketing;
