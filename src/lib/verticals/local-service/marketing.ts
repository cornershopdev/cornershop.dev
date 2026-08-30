import type { VerticalMarketing } from "@/lib/verticals/types";

/**
 * Tradefront has no standalone niche domain yet. Approved previews claim through
 * Cornershopdev's verified factory sender and publish on the shared platform
 * subdomain; the null niche identity prevents accidental standalone marketing.
 */
export const localServiceMarketing = {
  publiclyAccessible: false,
  hostnames: [],
  domain: null,
  brand: { name: "Tradefront", initials: "TF" },
  email: null,
  audience: "local trades and artisans",
  tagline: "Services, proof and a fast way to request the work.",
  heroVisual: "none",
  hero: {
    badge: "Built for real local work",
    headline: "A trade website that earns the call.",
    subheadline:
      "Turn an existing website or business profile into a clear mobile-first site with services, service areas, credentials, projects and the contact tools customers already use.",
    proofPoints: [
      "Private preview first",
      "Existing tools preserved",
      "No invented claims",
    ],
  },
  form: {
    placeholder: "Trade website or business name",
    label: "Trade website or business name",
    submitLabel: "Show my preview",
    pendingLabel: "Building the first look",
  },
  signIn: {
    title: "Open your trade website.",
    description:
      "Enter the owner email used when the website was claimed. No password needed.",
    emailPlaceholder: "owner@business.com",
    emptyPrompt: "No site yet?",
    createLabel: "Build a preview",
    createHref: "/create?vertical=local_service",
  },
  steps: [
    {
      number: "01",
      title: "Share the current source",
      copy: "Paste the existing website or business name. Tradefront recovers the services, areas, trust evidence, projects and contact links it can verify.",
    },
    {
      number: "02",
      title: "Review the private preview",
      copy: "Check every service, credential and availability claim before anything can be published.",
    },
    {
      number: "03",
      title: "Claim and keep it current",
      copy: "Connect a domain when ready, while the phone, WhatsApp and quote tools already used by the business stay in place.",
    },
  ],
  valueProps: {
    eyebrow: "Built around the job",
    headline: "Not every local business takes reservations.",
    copy: "Tradefront presents the evidence customers need before they call, then routes them into the business's real contact and quoting workflow.",
    items: [
      {
        icon: "catalog",
        title: "Services in plain language",
        copy: "Structured services, pricing posture and callout eligibility instead of a vague paragraph about quality.",
      },
      {
        icon: "shield",
        title: "Trust without invention",
        copy: "Credentials, insurance and guarantees appear only when the source supports them.",
      },
      {
        icon: "imagery",
        title: "Real project evidence",
        copy: "Completed projects and workshop imagery stay tied to the work they actually show.",
      },
      {
        icon: "booking",
        title: "The shortest path to contact",
        copy: "Phone, WhatsApp, quote forms and existing job-management portals remain one tap away.",
      },
    ],
  },
  imagery: {
    imageUrl:
      "https://images.unsplash.com/photo-1504307651254-35680f356dfd?auto=format&fit=crop&w=1400&q=85",
    imageAlt: "Tradesperson reviewing plans on an active building project",
    eyebrow: "Evidence over stock claims",
    headline: "Show the work without changing what happened.",
    copy: "Source photography is preserved as evidence. Enhancement can correct light and crop, but it cannot add completed work, remove defects or manufacture a before-and-after result.",
    assurances: [
      {
        icon: "shield",
        copy: "No invented licences, insurance, guarantees or availability",
      },
      {
        icon: "cursor",
        copy: "Every service, project and link remains owner-reviewable",
      },
    ],
  },
  pricing: {
    eyebrow: "Simple ongoing care",
    headline: "A current front door for the business.",
    copy: "Preview first. Publish only after the facts, owner and billing state are verified. Local currency is shown at checkout.",
    plans: [
      {
        name: "Founding",
        price: "€49",
        cadence: "/month",
        copy: "The complete local-service website for one independent business.",
        features: [
          "Mobile-first services and project gallery",
          "Phone, WhatsApp and quote actions",
          "Custom domain and SSL",
          "Owner editing and source monitoring",
        ],
        featured: true,
        badge: "Founding offer",
      },
    ],
  },
  closing: {
    headline: "Show the work before asking for the call.",
    copy: "Paste one source. Tradefront will build the private first draft.",
  },
  footerTagline: "Services, proof and a fast way to request the work.",
} satisfies VerticalMarketing;
