import { afterEach, describe, expect, it, mock } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", () => ({
  useRouter: () => ({
    push: () => {},
    replace: () => {},
    refresh: () => {},
    back: () => {},
    prefetch: () => {},
  }),
  usePathname: () => "/dashboard",
  useSearchParams: () => new URLSearchParams(),
}));

import { ImportStudio } from "@/app/create/import-studio";
import {
  LocalServiceDashboard,
  reconcileLocalServiceDraftAfterSave,
} from "@/app/dashboard/local-service-dashboard";
import { SiteRenderer } from "@/components/site-renderer";
import {
  deterministicDraft,
  generateSiteDraft,
  type SiteDraftGenerationDependencies,
} from "@/lib/ai/site-generation";
import { FACTORY_BRAND } from "@/lib/brand";
import { extractSourceLinks, type ExtractedSite } from "@/lib/importer";
import { reconstructSource } from "@/lib/source-reconstruction";
import { Vertical } from "@/generated/prisma/enums";
import { localServiceConfig } from "@/lib/verticals/local-service/config";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

const originalKey = process.env.OPENROUTER_API_KEY;

afterEach(() => {
  if (originalKey === undefined) delete process.env.OPENROUTER_API_KEY;
  else process.env.OPENROUTER_API_KEY = originalKey;
});

describe("local-service surfaces", () => {
  it("renders trade facts and contact conversion without a restaurant request form", () => {
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={sampleLocalServiceSiteDraft}
        vertical={Vertical.LOCAL_SERVICE}
      />,
    );

    expect(html).toContain("Request a written quote");
    expect(html).toContain("Message on WhatsApp");
    expect(html).toContain("Service areas");
    expect(html).toContain("Credentials and cover");
    expect(html).toContain("Townhouse rewire");
    expect(html).not.toContain("Number of people");
    expect(html).not.toContain("Request a table");
  });

  it("keeps the create action as a real form submit button", () => {
    const html = renderToStaticMarkup(
      <ImportStudio
        initialSource=""
        initialVertical={Vertical.LOCAL_SERVICE}
        initialBrand={{
          ...FACTORY_BRAND,
          vertical: null,
          homeUrl: "https://cornershop.dev",
        }}
      />,
    );

    expect(html).toContain("Local trade");
    expect(html).toContain('type="submit"');
    expect(html).toContain("trade website or business name");
  });

  it("ships a revision-safe owner editor with reviewed publication controls", () => {
    const html = renderToStaticMarkup(
      <LocalServiceDashboard
        initialDraft={sampleLocalServiceSiteDraft}
        initialRevision={7}
        email="owner@harbourelectrical.example"
        brand={FACTORY_BRAND}
        canSwitchWorkspace={false}
        initiallyPublished={false}
        platformUrl="https://harbour-electrical.cornershop.dev"
      />,
    );

    expect(html).toContain("Draft revision 7");
    expect(html).toContain("Private draft");
    expect(html).toContain("Services, proof and contact.");
    expect(html).toContain("Show project gallery");
    expect(html).toContain(">Publish<");
  });

  it("preserves post-dispatch edits and advances the revision after a deferred save", async () => {
    const submittedDraft = structuredClone(sampleLocalServiceSiteDraft);
    let currentDraft = submittedDraft;
    let currentMutationVersion = 0;
    let releaseResponse: (() => void) | undefined;
    const deferredResponse = new Promise<void>((resolve) => {
      releaseResponse = resolve;
    });
    const completeComponentSave = async () => {
      await deferredResponse;
      return reconcileLocalServiceDraftAfterSave({
        submittedDraft,
        persistedDraft: localServiceConfig.draftSchema.parse(submittedDraft),
        currentDraft,
        submittedMutationVersion: 0,
        currentMutationVersion,
        savedRevision: 8,
      });
    };

    const saving = completeComponentSave();
    currentDraft = {
      ...submittedDraft,
      description:
        "Typing after the request was dispatched must remain in the local-service editor.",
    };
    currentMutationVersion += 1;
    releaseResponse?.();
    const reconciled = await saving;

    expect(reconciled.draft.description).toContain(
      "must remain in the local-service editor",
    );
    expect(reconciled.revision).toBe(8);
    expect(reconciled.dirty).toBe(true);
    expect(reconciled.hadNewerEdits).toBe(true);
  });

  it("reconstructs a sourced French plumber preview without invoking the configured model", async () => {
    process.env.OPENROUTER_API_KEY = "configured-but-unused";
    const modelGenerate = mock(async () => {
      throw new Error("LOCAL_SERVICE must not invoke text generation");
    });
    const sourceUrl = new URL("https://atelier-riviere.example/");
    const fixture = await Bun.file(
      new URL(
        "../../__fixtures__/importer/french-plumber.html",
        import.meta.url,
      ),
    ).text();
    const reconstructed = reconstructSource({
      homepage: { html: fixture, url: sourceUrl },
      fallbackName: sourceUrl.hostname,
      links: [],
      fallbackPalette: {
        ...localServiceConfig.presentation.fallbackPalette,
        accentForeground: "#ffffff",
      },
    });
    const links = extractSourceLinks(
      fixture,
      sourceUrl,
      localServiceConfig.providers,
      localServiceConfig.crawl.linkKeywordHints,
    );
    const extracted: ExtractedSite = {
      source: sourceUrl.toString(),
      sourceUrl: sourceUrl.toString(),
      pageText: fixture,
      links,
      ...reconstructed,
    };

    const draft = await generateSiteDraft(extracted, localServiceConfig, {
      generateText:
        modelGenerate as SiteDraftGenerationDependencies["generateText"],
    });
    expect(modelGenerate).not.toHaveBeenCalled();
    expect(draft).toEqual(deterministicDraft(extracted, localServiceConfig));
    const html = renderToStaticMarkup(
      <SiteRenderer draft={draft} vertical={Vertical.LOCAL_SERVICE} />,
    );

    expect(reconstructed.businessTypes).toContain("plumber");
    expect(draft).toMatchObject({
      defaultLocale: "fr",
      name: "Atelier Rivière Plomberie",
      phone: "+33 4 72 10 20 30",
      email: "bonjour@atelier-riviere.example",
      logoUrl: "https://atelier-riviere.example/assets/logo-riviere.svg",
      faviconUrl: "https://atelier-riviere.example/assets/favicon.png",
      palette: {
        background: "#f5f1e8",
        foreground: "#17313a",
        accent: "#176b87",
      },
      attributes: {
        tradeType: "plumber",
        availabilityPosture: "not-stated",
        credentials: [],
        insuranceStatus: "not-stated",
        trustSignals: [],
        projects: [],
        showProjectGallery: false,
        designProfile: {
          engagementModel: "callout",
          primaryIntent: "quote",
          catalogExperience: "service-list",
          brandTraits: ["technical", "trusted"],
          locationCount: 1,
          photographyQuality: "none",
        },
        themeSelection: {
          themeId: "direct-response",
          source: "deterministic",
        },
      },
      catalogSections: [
        {
          name: "Interventions de plomberie",
          items: [
            {
              name: "Recherche de fuite",
              price: null,
              available: null,
              attributes: {
                pricingModel: "not-stated",
                emergencyEligible: false,
              },
            },
            {
              name: "Remplacement de robinetterie",
              price: 95,
              currency: "EUR",
              available: null,
              attributes: {
                pricingModel: "fixed",
                emergencyEligible: false,
              },
            },
          ],
        },
      ],
      integrations: [
        {
          type: "quote",
          label: "Demander un devis",
          provider: null,
          url: "https://atelier-riviere.example/devis",
          enabled: true,
          venueId: null,
        },
        {
          type: "contact",
          label: "WhatsApp",
          provider: "WhatsApp",
          url: "https://wa.me/33472102030",
          enabled: true,
          venueId: null,
        },
      ],
    });
    expect(draft.businessHours).toEqual([
      {
        days: "Monday, Tuesday, Wednesday, Thursday, Friday",
        hours: "08:00–18:00",
      },
    ]);
    expect(draft.sourceData.navigation).toEqual([
      {
        label: "Nos services",
        url: "/services",
        destinationUrl: "https://atelier-riviere.example/services",
      },
      {
        label: "Réalisations",
        url: "/realisations",
        destinationUrl: "https://atelier-riviere.example/realisations",
      },
      {
        label: "Contact",
        url: "/contact",
        destinationUrl: "https://atelier-riviere.example/contact",
      },
    ]);
    expect(draft.sourceData.evidence).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ field: "business.type", value: "plumber" }),
        expect.objectContaining({
          field: "catalog.item",
          value: "Recherche de fuite",
        }),
      ]),
    );
    expect(html).toContain('lang="fr"');
    expect(html).toContain("data-source-brand-mark");
    expect(html).toContain("Nos services");
    expect(html).toContain("Recherche de fuite");
    expect(html).toContain("Remplacement de robinetterie");
    expect(html).toContain("bonjour@atelier-riviere.example");
    expect(html).toContain("Demander un devis");
    expect(html).toContain("Services indiqués par l’entreprise.");
    expect(html).not.toContain("Emergency callout");
    expect(html).not.toContain("Number of people");
  });

  it("localizes evidence-backed availability labels in French", () => {
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={{
          ...sampleLocalServiceSiteDraft,
          defaultLocale: "fr",
          attributes: {
            ...sampleLocalServiceSiteDraft.attributes,
            availabilityPosture: "scheduled",
          },
        }}
        vertical={Vertical.LOCAL_SERVICE}
        locale="fr"
      />,
    );

    expect(html).toContain("Interventions planifiées");
    expect(html).not.toContain("Scheduled work");
  });

  it("renders French pricing and emergency badges after owner edits", () => {
    const baseItem = sampleLocalServiceSiteDraft.catalogSections[0]!.items[0]!;
    const draft = localServiceConfig.draftSchema.parse({
      ...sampleLocalServiceSiteDraft,
      defaultLocale: "fr",
      catalogSections: [
        {
          name: "Services",
          description: "Services modifiés par la propriétaire.",
          items: [
            {
              ...baseItem,
              name: "Service sur devis",
              attributes: {
                pricingModel: "quote",
                priceUnit: "",
                emergencyEligible: false,
              },
            },
            {
              ...baseItem,
              name: "Service à partir de",
              attributes: {
                pricingModel: "from",
                priceUnit: "",
                emergencyEligible: false,
              },
            },
            {
              ...baseItem,
              name: "Service horaire",
              attributes: {
                pricingModel: "hourly",
                priceUnit: "",
                emergencyEligible: false,
              },
            },
            {
              ...baseItem,
              name: "Service d’urgence",
              attributes: {
                pricingModel: "not-stated",
                priceUnit: "",
                emergencyEligible: true,
              },
            },
          ],
        },
      ],
    });
    const html = renderToStaticMarkup(
      <SiteRenderer
        draft={draft}
        vertical={Vertical.LOCAL_SERVICE}
        locale="fr"
      />,
    );

    for (const label of [
      "Devis requis",
      "À partir de",
      "Tarif horaire",
      "Intervention d’urgence",
    ]) {
      expect(html).toContain(label);
    }
    for (const englishLabel of [
      "Quote required",
      "From",
      "Hourly",
      "Emergency callout",
    ]) {
      expect(html).not.toContain(englishLabel);
    }
  });

  it.each([
    ["Plumber", "plumber"],
    ["Electrician", "electrician"],
    ["GeneralContractor", "builder"],
    ["Locksmith", "repair"],
    ["HousePainter", "artisan"],
    ["LocalBusiness", "general-trades"],
  ] as const)(
    "keeps sparse %s template copy subtype-only",
    (businessType, tradeType) => {
      const draft = deterministicDraft(
        {
          source: "Sparse trade",
          sourceUrl: "https://sparse-trade.example/",
          businessTypes: [businessType],
          sourceLocale: "en",
          name: "Sparse trade",
          description: "",
          address: "",
          phone: "",
          email: "",
          businessHours: [],
          heroImageUrl: null,
          pageText: "Sparse trade",
          links: [],
        },
        localServiceConfig,
      );
      const html = renderToStaticMarkup(
        <SiteRenderer draft={draft} vertical={Vertical.LOCAL_SERVICE} />,
      ).toLowerCase();

      expect(draft.attributes.tradeType).toBe(tradeType);
      for (const unsupportedClaim of [
        "safe, qualified",
        "leaks, heating",
        "installations and repairs",
        "finished with care",
        "completed plumbing",
        "finished work",
        "real commissioned work",
        "recent work",
      ]) {
        expect(html).not.toContain(unsupportedClaim);
      }
    },
  );
});
