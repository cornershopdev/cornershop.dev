import { describe, expect, it } from "bun:test";

const dashboard = await Bun.file(
  new URL("../app/dashboard/dashboard.tsx", import.meta.url),
).text();
const dashboardPage = await Bun.file(
  new URL("../app/dashboard/page.tsx", import.meta.url),
).text();
const foodRetailDashboard = await Bun.file(
  new URL("../app/dashboard/food-retail-dashboard.tsx", import.meta.url),
).text();
const localServiceDashboard = await Bun.file(
  new URL("../app/dashboard/local-service-dashboard.tsx", import.meta.url),
).text();
const restaurantSaveRoute = await Bun.file(
  new URL("../app/api/sites/[slug]/route.ts", import.meta.url),
).text();
const ownerSiteSave = await Bun.file(
  new URL("./owner-site-save.ts", import.meta.url),
).text();
const restaurantPublishRoute = await Bun.file(
  new URL("../app/api/sites/[slug]/publish/route.ts", import.meta.url),
).text();
const rollbackRoute = await Bun.file(
  new URL("../app/api/sites/[slug]/rollback/route.ts", import.meta.url),
).text();
const sitePublication = await Bun.file(
  new URL("./site-publication.ts", import.meta.url),
).text();
const sites = await Bun.file(new URL("./sites.ts", import.meta.url)).text();
const publicationCapability = await Bun.file(
  new URL("./site-publication-capability.ts", import.meta.url),
).text();
const translationRegenerationRoute = await Bun.file(
  new URL(
    "../app/api/sites/[slug]/translations/[locale]/regenerate/route.ts",
    import.meta.url,
  ),
).text();
const sourceMonitoringReviewRoute = await Bun.file(
  new URL(
    "../app/api/sites/[slug]/source-monitoring/suggestions/[suggestionId]/route.ts",
    import.meta.url,
  ),
).text();
const sourceMonitoringPanel = await Bun.file(
  new URL("../components/source-monitoring-panel.tsx", import.meta.url),
).text();

describe("dashboard tab and settings surface", () => {
  it("uses one Base UI tab list containing the settings tab", () => {
    expect(dashboard.match(/<TabsList/g)).toHaveLength(1);
    expect(dashboard).toContain('["settings", Settings, "Settings"]');
    expect(dashboard).toContain('<TabsContent value="settings"');
  });

  it("associates the restaurant name label with its editor control", () => {
    expect(dashboard).toContain(
      '<Label htmlFor="restaurant-name">Restaurant name</Label>',
    );
    expect(dashboard).toContain('id="restaurant-name"');
  });

  it("requires the persisted owner revision on the first and later saves", () => {
    expect(dashboardPage).toContain(
      "initialDraftRevision={ownerDraft?.revision ?? 0}",
    );
    expect(dashboardPage).toContain("initialRevision={loaded.revision}");
    expect(dashboard).toContain("useState(initialDraftRevision)");
    expect(dashboard).toContain("expectedRevision: savedRevision");
    expect(restaurantSaveRoute).toContain("saveAuthorizedSiteDraft");
    expect(ownerSiteSave).toContain('code: "EXPECTED_REVISION_REQUIRED"');
    expect(dashboard).toContain("expectedRevision: revisionToPublish");
    expect(foodRetailDashboard).toContain("expectedRevision: revision");
    expect(restaurantPublishRoute).toContain('code: "DRAFT_REVISION_CONFLICT"');
  });

  it("publishes reviewed food-retail and local-service drafts through the guarded route", () => {
    expect(dashboardPage).toContain("loadOwnerPaidWorkspace(access)");
    expect(foodRetailDashboard).toContain("OwnerPaidOperationsSection");
    expect(localServiceDashboard).toContain("OwnerPaidOperationsSection");
    expect(foodRetailDashboard).toContain("publishDraft");
    expect(foodRetailDashboard).toContain("/publish");
    expect(foodRetailDashboard).toContain(
      "hasUnreviewedFoodRetailTranslations",
    );
    expect(localServiceDashboard).toContain("async function publish()");
    expect(localServiceDashboard).toContain("/publish");
    expect(restaurantPublishRoute).toContain(
      "publicationCapabilityFailureResponse",
    );
    expect(rollbackRoute).toContain("publicationCapabilityFailureResponse");
    expect(
      sitePublication.match(
        /assertVerticalPublicationEnabled\(input\.vertical\)/g,
      ),
    ).toHaveLength(2);
    expect(sites).toContain("!isVerticalPublicationEnabled(version.vertical)");
    expect(sites).not.toContain("isVerticalPublicationMutationEnabled");
    expect(publicationCapability).toContain(
      "isVerticalPublicationMutationEnabled",
    );
    expect(publicationCapability).not.toContain(
      "isVerticalPublicationEnabled(vertical)",
    );
  });

  it("carries the universal draft revision through auxiliary owner mutations", () => {
    expect(dashboard).toContain(
      "body: JSON.stringify({ expectedRevision: requestedRevision })",
    );
    expect(dashboard).toContain("setSavedRevision(result.revision)");
    expect(translationRegenerationRoute).toContain(
      "expectedRevision: requestBody.data.expectedRevision",
    );
    expect(translationRegenerationRoute).toContain(
      'code: "DRAFT_REVISION_CONFLICT"',
    );
    expect(sourceMonitoringReviewRoute).toContain(
      "expectedRevision: z.number().int().min(0)",
    );
    expect(sourceMonitoringPanel).toContain("expectedRevision: draftRevision");
    expect(dashboard).toContain(
      "onAcceptedDraft={applyAcceptedSourceMonitoringDraft}",
    );
    expect(foodRetailDashboard).toContain(
      "onAcceptedDraft={applyAcceptedSourceMonitoringDraft}",
    );
    expect(localServiceDashboard).toContain(
      "onAcceptedDraft={applyAcceptedSourceMonitoringDraft}",
    );
    expect(foodRetailDashboard).toContain("<PhotoLibraryPanel");
    expect(localServiceDashboard).toContain("<PhotoLibraryPanel");
    expect(foodRetailDashboard).toContain("onCatalogChange={handlePhotoCatalogChange}");
    expect(localServiceDashboard).toContain(
      "onCatalogChange={handlePhotoCatalogChange}",
    );
    expect(foodRetailDashboard).not.toContain("Approved product image URL");
    expect(localServiceDashboard).not.toContain("Project image URL");
    expect(sourceMonitoringPanel).toContain(
      "onAcceptedDraft({ revision: acceptedRevision, draft: result.draft })",
    );
    expect(sourceMonitoringPanel).toContain(
      "The operator surface has no local draft editor to reconcile.",
    );
  });
});
