import { beforeEach, describe, expect, it, mock } from "bun:test";
import { Vertical } from "@/generated/prisma/enums";
import { saveAuthorizedSiteDraft } from "@/lib/owner-site-save";
import { sampleRestaurant } from "@/lib/restaurant";
import { DraftRevisionConflictError } from "@/lib/site-persistence";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";

let currentRevision = 7;
const updateSiteDraft = mock(
  async (
    _slug: string,
    _draft: unknown,
    _vertical: Vertical,
    options?: { expectedRevision?: number },
  ) => {
    if (options?.expectedRevision !== currentRevision) {
      throw new DraftRevisionConflictError(currentRevision);
    }
    currentRevision += 1;
    return { revision: currentRevision };
  },
);

const access = {
  site: { vertical: Vertical.RESTAURANT },
  user: { id: "owner_1", email: "owner@example.test" },
};

describe("owner site save revision contract", () => {
  beforeEach(() => {
    currentRevision = 7;
    updateSiteDraft.mockClear();
  });

  it("requires a non-negative integer expectedRevision", async () => {
    const response = await saveRequest(sampleRestaurant);

    expect(response.status).toBe(400);
    expect(await response.json()).toEqual({
      error: "A valid expectedRevision is required to save this draft",
      code: "EXPECTED_REVISION_REQUIRED",
    });
    expect(updateSiteDraft).not.toHaveBeenCalled();
  });

  it("returns 409 when a second independently loaded tab makes its first save", async () => {
    const firstTabRevision = currentRevision;
    const secondTabRevision = currentRevision;

    const first = await saveRequest({
      ...sampleRestaurant,
      description: "The first independently loaded owner tab wins this save.",
      expectedRevision: firstTabRevision,
    });
    const firstPayload = await first.json();
    expect(firstPayload).toMatchObject({ revision: 8 });
    expect(first.status).toBe(200);

    const second = await saveRequest({
      ...sampleRestaurant,
      description: "The stale second owner tab must not overwrite that save.",
      expectedRevision: secondTabRevision,
    });
    expect(second.status).toBe(409);
    expect(await second.json()).toEqual({
      error: "This draft was updated elsewhere. Reload before saving again.",
      code: "DRAFT_REVISION_CONFLICT",
      currentRevision: 8,
    });
  });

  it("persists a reviewed, schema-valid bilingual food-retail draft with its loaded revision", async () => {
    const foodAccess = {
      ...access,
      site: { vertical: Vertical.FOOD_RETAIL },
    };
    const response = await saveAuthorizedSiteDraft(
      sampleFoodRetailDraft.slug,
      foodAccess,
      { ...sampleFoodRetailDraft, expectedRevision: currentRevision },
      updateSiteDraft,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 8 });
    expect(updateSiteDraft).toHaveBeenCalledWith(
      sampleFoodRetailDraft.slug,
      expect.objectContaining({
        translations: expect.arrayContaining([
          expect.objectContaining({ status: "current" }),
        ]),
      }),
      Vertical.FOOD_RETAIL,
      expect.objectContaining({ expectedRevision: 7 }),
    );
  });

  it("rejects an owner-saved food-retail navigation destination off the source origin", async () => {
    const malicious = structuredClone(sampleFoodRetailDraft);
    malicious.sourceData.navigation = [
      {
        label: "Order",
        url: "/order",
        destinationUrl: "https://attacker.example/phish",
      },
    ];
    const response = await saveAuthorizedSiteDraft(
      malicious.slug,
      { ...access, site: { vertical: Vertical.FOOD_RETAIL } },
      { ...malicious, expectedRevision: currentRevision },
      updateSiteDraft,
    );

    expect(response.status).toBe(400);
    expect(await response.text()).toContain(
      "Source navigation destinations must match the authenticated source origin and intent",
    );
    expect(updateSiteDraft).not.toHaveBeenCalled();
  });

  it("rejects beauty owner saves without promising claim or checkout", async () => {
    const response = await saveAuthorizedSiteDraft(
      "atelier-coupe",
      { ...access, site: { vertical: Vertical.BEAUTY } },
      { expectedRevision: currentRevision },
      updateSiteDraft,
    );

    expect(response.status).toBe(409);
    expect(await response.json()).toEqual({
      error:
        "Owner editing for this vertical is not available yet. Use the private preview until the vertical editor ships.",
    });
    expect(updateSiteDraft).not.toHaveBeenCalled();
  });

  it("persists a schema-valid local-service draft with optimistic concurrency", async () => {
    const response = await saveAuthorizedSiteDraft(
      sampleLocalServiceSiteDraft.slug,
      { ...access, site: { vertical: Vertical.LOCAL_SERVICE } },
      {
        ...sampleLocalServiceSiteDraft,
        expectedRevision: currentRevision,
      },
      updateSiteDraft,
    );

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ revision: 8 });
    expect(updateSiteDraft).toHaveBeenCalledWith(
      sampleLocalServiceSiteDraft.slug,
      expect.objectContaining({
        attributes: expect.objectContaining({ tradeType: "electrician" }),
      }),
      Vertical.LOCAL_SERVICE,
      expect.objectContaining({ expectedRevision: 7 }),
    );
  });
});

function saveRequest(body: Record<string, unknown> | typeof sampleRestaurant) {
  return saveAuthorizedSiteDraft(
    sampleRestaurant.slug,
    access,
    body,
    updateSiteDraft,
  );
}
