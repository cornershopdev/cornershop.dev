import { describe, expect, it, mock } from "bun:test";
import { sampleRestaurant } from "@/lib/restaurant";
import { sampleFoodRetailDraft } from "@/lib/verticals/food-retail/fixtures";
import { sampleLocalServiceSiteDraft } from "@/lib/verticals/local-service/fixtures";
import {
  OWNER_UNSAVED_EDITS_MESSAGE,
  acknowledgeOwnerDraftSave,
  acknowledgeOwnerDraftSnapshot,
  applyOwnerDraftEdit,
  beginOwnerDraftSave,
  confirmDiscardUnsavedOwnerEdits,
  createOwnerDraftDirtyState,
  interceptOwnerNavigationClick,
  ownerDraftBeforeUnloadHandler,
  reconcileOwnerDraftAuxiliary,
} from "@/lib/owner-draft-dirty-state";

type Snapshot = {
  name: string;
  hero: string;
};

const verticalSamples = [
  ["restaurant", sampleRestaurant],
  ["food-retail", sampleFoodRetailDraft],
  ["local-service", sampleLocalServiceSiteDraft],
] as const;

function snapshot(name = "Chez Léa", hero = "hero-1"): Snapshot {
  return { name, hero };
}

function installWindow(confirmImpl: () => boolean = () => false) {
  const confirm = mock(confirmImpl);
  const previous = (globalThis as { window?: unknown }).window;
  (globalThis as { window: unknown }).window = {
    confirm,
    location: {
      href: "https://cornershop.dev/dashboard",
      origin: "https://cornershop.dev",
      pathname: "/dashboard",
      search: "",
    },
  };
  return {
    confirm,
    restore() {
      if (previous === undefined) {
        delete (globalThis as { window?: unknown }).window;
      } else {
        (globalThis as { window: unknown }).window = previous;
      }
    },
  };
}

describe("owner draft dirty-state machine", () => {
  it("starts clean and does not prompt", () => {
    const api = installWindow(() => false);
    const state = createOwnerDraftDirtyState(snapshot(), 4);

    expect(state.dirty).toBe(false);
    expect(state.revision).toBe(4);
    expect(confirmDiscardUnsavedOwnerEdits(state.dirty)).toBe(true);
    expect(api.confirm).not.toHaveBeenCalled();
    api.restore();
  });

  it("marks every edit path dirty until the exact submitted snapshot is acknowledged", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 4);
    state = applyOwnerDraftEdit(state, snapshot("Chez Léa edited"));
    expect(state.dirty).toBe(true);
    expect(state.mutationVersion).toBe(1);

    const submitted = beginOwnerDraftSave(state);
    const persisted = snapshot("Chez Léa edited");
    const acknowledged = acknowledgeOwnerDraftSave(state, {
      submittedDraft: submitted.submittedDraft,
      persistedDraft: persisted,
      submittedMutationVersion: submitted.submittedMutationVersion,
      savedRevision: 5,
    });

    expect(acknowledged.hadNewerEdits).toBe(false);
    expect(acknowledged.state.dirty).toBe(false);
    expect(acknowledged.state.revision).toBe(5);
    expect(acknowledged.state.draft).toEqual(persisted);
  });

  it("keeps in-flight edits and does not overwrite them when the save returns", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 4);
    state = applyOwnerDraftEdit(state, snapshot("Submitted name"));
    const submitted = beginOwnerDraftSave(state);
    state = applyOwnerDraftEdit(state, snapshot("Typed while saving"));

    const acknowledged = acknowledgeOwnerDraftSave(state, {
      submittedDraft: submitted.submittedDraft,
      persistedDraft: snapshot("Submitted name"),
      submittedMutationVersion: submitted.submittedMutationVersion,
      savedRevision: 5,
    });

    expect(acknowledged.hadNewerEdits).toBe(true);
    expect(acknowledged.state.dirty).toBe(true);
    expect(acknowledged.state.draft.name).toBe("Typed while saving");
    expect(acknowledged.state.revision).toBe(5);
    expect(acknowledged.state.baseline.name).toBe("Submitted name");
  });

  it("reconciles directly persisted photo-library patches without false dirty", () => {
    for (const [vertical, sample] of verticalSamples) {
      const state = createOwnerDraftDirtyState(sample, 7);
      const patched = reconcileOwnerDraftAuxiliary(
        state,
        (draft) => ({
          ...draft,
          heroImageUrl: "https://photos.example/hero.webp",
        }),
        8,
      );

      expect(typeof vertical).toBe("string");
      expect(patched.dirty).toBe(false);
      expect(patched.revision).toBe(8);
      expect(patched.draft.heroImageUrl).toBe(
        "https://photos.example/hero.webp",
      );
      expect(patched.baseline.heroImageUrl).toBe(
        "https://photos.example/hero.webp",
      );
      expect(confirmDiscardUnsavedOwnerEdits(patched.dirty)).toBe(true);
    }
  });

  it("keeps owner edits dirty when a photo-library patch lands on the same snapshot", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 1);
    state = applyOwnerDraftEdit(state, snapshot("Unsaved name"));
    const patched = reconcileOwnerDraftAuxiliary(
      state,
      (draft) => ({ ...draft, hero: "hero-reviewed" }),
      2,
    );

    expect(patched.dirty).toBe(true);
    expect(patched.draft).toEqual({
      name: "Unsaved name",
      hero: "hero-reviewed",
    });
    expect(patched.baseline).toEqual({
      name: "Chez Léa",
      hero: "hero-reviewed",
    });
  });

  it("does not let an exact save acknowledgement clobber a photo-library patch", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 1);
    state = applyOwnerDraftEdit(state, snapshot("Saved name"));
    const submitted = beginOwnerDraftSave(state);
    state = reconcileOwnerDraftAuxiliary(
      state,
      (draft) => ({ ...draft, hero: "hero-reviewed" }),
      3,
    );

    const acknowledged = acknowledgeOwnerDraftSave(state, {
      submittedDraft: submitted.submittedDraft,
      persistedDraft: snapshot("Saved name"),
      submittedMutationVersion: submitted.submittedMutationVersion,
      savedRevision: 4,
    });

    expect(acknowledged.hadNewerEdits).toBe(false);
    expect(acknowledged.state.dirty).toBe(false);
    expect(acknowledged.state.draft).toEqual({
      name: "Saved name",
      hero: "hero-reviewed",
    });
    expect(acknowledged.state.revision).toBe(4);
  });

  it("treats a source-monitoring accept as an acknowledged snapshot", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 2);
    state = applyOwnerDraftEdit(state, snapshot("Should be replaced"));
    const accepted = snapshot("Monitored name", "hero-2");
    state = acknowledgeOwnerDraftSnapshot(state, accepted, 9);

    expect(state.dirty).toBe(false);
    expect(state.draft).toEqual(accepted);
    expect(state.baseline).toEqual(accepted);
    expect(state.revision).toBe(9);
  });

  it("clears dirty only for the submitted snapshot, not a later one", () => {
    let state = createOwnerDraftDirtyState(snapshot(), 1);
    state = applyOwnerDraftEdit(state, snapshot("First"));
    const first = beginOwnerDraftSave(state);
    state = applyOwnerDraftEdit(state, snapshot("Second"));
    const second = beginOwnerDraftSave(state);

    const firstAck = acknowledgeOwnerDraftSave(state, {
      submittedDraft: first.submittedDraft,
      persistedDraft: snapshot("First"),
      submittedMutationVersion: first.submittedMutationVersion,
      savedRevision: 2,
    });
    expect(firstAck.hadNewerEdits).toBe(true);
    expect(firstAck.state.dirty).toBe(true);
    expect(firstAck.state.draft.name).toBe("Second");

    const secondAck = acknowledgeOwnerDraftSave(firstAck.state, {
      submittedDraft: second.submittedDraft,
      persistedDraft: snapshot("Second"),
      submittedMutationVersion: second.submittedMutationVersion,
      savedRevision: 3,
    });
    expect(secondAck.hadNewerEdits).toBe(false);
    expect(secondAck.state.dirty).toBe(false);
    expect(secondAck.state.draft.name).toBe("Second");
  });
});

describe("owner draft navigation and unload guards", () => {
  it("does not prompt on beforeunload or in-app navigation when clean", () => {
    const api = installWindow(() => false);
    let prevented = false;
    const unload = {
      preventDefault() {
        prevented = true;
      },
      returnValue: "",
    } as BeforeUnloadEvent;

    expect(ownerDraftBeforeUnloadHandler(unload, false)).toBeUndefined();
    expect(prevented).toBe(false);

    interceptOwnerNavigationClick(
      {
        target: fakeAnchor("/workspace/select"),
        preventDefault() {
          prevented = true;
        },
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        button: 0,
      },
      false,
    );

    expect(prevented).toBe(false);
    expect(api.confirm).not.toHaveBeenCalled();
    api.restore();
  });

  it("warns on browser unload, in-app navigation, workspace switch, and sign-out when dirty", () => {
    const api = installWindow(() => false);
    let unloadPrevented = false;
    const unload = {
      preventDefault() {
        unloadPrevented = true;
      },
      returnValue: "",
    } as BeforeUnloadEvent;

    expect(ownerDraftBeforeUnloadHandler(unload, true)).toBe(
      OWNER_UNSAVED_EDITS_MESSAGE,
    );
    expect(unloadPrevented).toBe(true);
    expect(unload.returnValue).toBe(OWNER_UNSAVED_EDITS_MESSAGE);

    for (const href of ["/workspace/select", "/sign-in", "/create"]) {
      api.confirm.mockClear();
      let navigationPrevented = false;
      interceptOwnerNavigationClick(
        {
          target: fakeAnchor(href),
          preventDefault() {
            navigationPrevented = true;
          },
          defaultPrevented: false,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          button: 0,
        },
        true,
      );
      expect(api.confirm).toHaveBeenCalledWith(OWNER_UNSAVED_EDITS_MESSAGE);
      expect(navigationPrevented).toBe(true);
    }

    api.confirm.mockClear();
    expect(confirmDiscardUnsavedOwnerEdits(true)).toBe(false);
    expect(api.confirm).toHaveBeenCalledWith(OWNER_UNSAVED_EDITS_MESSAGE);
    api.restore();
  });

  it("does not intercept new-tab preview links", () => {
    const api = installWindow(() => false);
    let prevented = false;
    interceptOwnerNavigationClick(
      {
        target: fakeAnchor("/preview/osteria-luna", "_blank"),
        preventDefault() {
          prevented = true;
        },
        defaultPrevented: false,
        metaKey: false,
        ctrlKey: false,
        shiftKey: false,
        altKey: false,
        button: 0,
      },
      true,
    );
    expect(prevented).toBe(false);
    expect(api.confirm).not.toHaveBeenCalled();
    api.restore();
  });

  it("does not intercept javascript, data, or vbscript hrefs", () => {
    const api = installWindow(() => false);
    for (const href of [
      "javascript:void(0)",
      "data:text/html,hi",
      "vbscript:msgbox(1)",
    ]) {
      api.confirm.mockClear();
      let prevented = false;
      interceptOwnerNavigationClick(
        {
          target: fakeAnchor(href),
          preventDefault() {
            prevented = true;
          },
          defaultPrevented: false,
          metaKey: false,
          ctrlKey: false,
          shiftKey: false,
          altKey: false,
          button: 0,
        },
        true,
      );
      expect(prevented).toBe(false);
      expect(api.confirm).not.toHaveBeenCalled();
    }
    api.restore();
  });
});

function fakeAnchor(href: string, target = "") {
  return {
    closest: (selector: string) =>
      selector === "a"
        ? {
            target,
            getAttribute: (name: string) => (name === "href" ? href : null),
            hasAttribute: () => false,
          }
        : null,
  };
}
