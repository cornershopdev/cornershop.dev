"use client";

import {
  createContext,
  createElement,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type MouseEvent as ReactMouseEvent,
  type ReactNode,
} from "react";

export const OWNER_UNSAVED_EDITS_MESSAGE =
  "You have unsaved changes. Leave this page and discard them?";

export type OwnerDraftDirtyState<T> = {
  draft: T;
  baseline: T;
  revision: number;
  mutationVersion: number;
  dirty: boolean;
};

export type OwnerDraftSaveAcknowledgement<T> = {
  submittedDraft: T;
  persistedDraft: T;
  submittedMutationVersion: number;
  savedRevision: number;
};

export function ownerDraftSnapshotsEqual(
  left: unknown,
  right: unknown,
): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

export function createOwnerDraftDirtyState<T>(
  draft: T,
  revision: number,
): OwnerDraftDirtyState<T> {
  return {
    draft,
    baseline: structuredClone(draft),
    revision,
    mutationVersion: 0,
    dirty: false,
  };
}

export function applyOwnerDraftEdit<T>(
  state: OwnerDraftDirtyState<T>,
  nextDraft: T,
): OwnerDraftDirtyState<T> {
  return {
    ...state,
    draft: nextDraft,
    mutationVersion: state.mutationVersion + 1,
    dirty: !ownerDraftSnapshotsEqual(nextDraft, state.baseline),
  };
}

export function beginOwnerDraftSave<T>(state: OwnerDraftDirtyState<T>): {
  submittedDraft: T;
  submittedMutationVersion: number;
  expectedRevision: number;
} {
  return {
    submittedDraft: state.draft,
    submittedMutationVersion: state.mutationVersion,
    expectedRevision: state.revision,
  };
}

export function acknowledgeOwnerDraftSave<T>(
  state: OwnerDraftDirtyState<T>,
  acknowledgement: OwnerDraftSaveAcknowledgement<T>,
): { state: OwnerDraftDirtyState<T>; hadNewerEdits: boolean } {
  const hadNewerEdits =
    state.mutationVersion !== acknowledgement.submittedMutationVersion;
  if (hadNewerEdits) {
    return {
      state: {
        ...state,
        baseline: acknowledgement.persistedDraft,
        revision: acknowledgement.savedRevision,
        dirty: !ownerDraftSnapshotsEqual(
          state.draft,
          acknowledgement.persistedDraft,
        ),
      },
      hadNewerEdits: true,
    };
  }

  const nextDraft = ownerDraftSnapshotsEqual(
    state.draft,
    acknowledgement.submittedDraft,
  )
    ? acknowledgement.persistedDraft
    : state.draft;
  return {
    state: {
      ...state,
      draft: nextDraft,
      baseline: structuredClone(nextDraft),
      revision: acknowledgement.savedRevision,
      dirty: false,
    },
    hadNewerEdits: false,
  };
}

export function reconcileOwnerDraftAuxiliary<T>(
  state: OwnerDraftDirtyState<T>,
  patch: (draft: T) => T,
  revision: number = state.revision,
): OwnerDraftDirtyState<T> {
  const draft = patch(state.draft);
  const baseline = patch(state.baseline);
  return {
    ...state,
    draft,
    baseline,
    revision,
    dirty: !ownerDraftSnapshotsEqual(draft, baseline),
  };
}

export function acknowledgeOwnerDraftSnapshot<T>(
  state: OwnerDraftDirtyState<T>,
  snapshot: T,
  revision: number,
): OwnerDraftDirtyState<T> {
  return {
    ...state,
    draft: snapshot,
    baseline: structuredClone(snapshot),
    revision,
    dirty: false,
  };
}

export function adoptOwnerDraftServerState<T>(
  state: OwnerDraftDirtyState<T>,
  input: { draft: T; baseline: T; revision: number },
): OwnerDraftDirtyState<T> {
  return {
    ...state,
    draft: input.draft,
    baseline: input.baseline,
    revision: input.revision,
    dirty: !ownerDraftSnapshotsEqual(input.draft, input.baseline),
  };
}

export function setOwnerDraftRevision<T>(
  state: OwnerDraftDirtyState<T>,
  revision: number,
): OwnerDraftDirtyState<T> {
  return { ...state, revision };
}

export function confirmDiscardUnsavedOwnerEdits(dirty: boolean): boolean {
  if (!dirty) return true;
  return window.confirm(OWNER_UNSAVED_EDITS_MESSAGE);
}

export function ownerDraftBeforeUnloadHandler(
  event: BeforeUnloadEvent,
  dirty: boolean,
): string | undefined {
  if (!dirty) return undefined;
  event.preventDefault();
  event.returnValue = OWNER_UNSAVED_EDITS_MESSAGE;
  return OWNER_UNSAVED_EDITS_MESSAGE;
}

type OwnerNavigationClickEvent = {
  target: unknown;
  preventDefault: () => void;
  defaultPrevented: boolean;
  metaKey: boolean;
  ctrlKey: boolean;
  shiftKey: boolean;
  altKey: boolean;
  button: number;
};

function closestAnchor(target: unknown): {
  target: string;
  href: string | null;
  download: boolean;
} | null {
  if (target === null || typeof target !== "object") return null;
  const withClosest =
    typeof (target as { closest?: unknown }).closest === "function"
      ? target
      : (target as { parentElement?: unknown }).parentElement;
  if (withClosest === null || typeof withClosest !== "object") return null;
  const element = withClosest as {
    closest?: (selector: string) => unknown;
  };
  if (typeof element.closest !== "function") return null;
  const anchor = element.closest("a") as {
    target: string;
    getAttribute?: (name: string) => string | null;
    hasAttribute?: (name: string) => boolean;
    href?: string;
  } | null;
  if (!anchor) return null;
  return {
    target: anchor.target ?? "",
    href:
      typeof anchor.getAttribute === "function"
        ? anchor.getAttribute("href")
        : (anchor.href ?? null),
    download:
      typeof anchor.hasAttribute === "function"
        ? anchor.hasAttribute("download")
        : false,
  };
}

export function interceptOwnerNavigationClick(
  event: OwnerNavigationClickEvent,
  dirty: boolean,
): void {
  if (!dirty || event.defaultPrevented) return;
  if (event.button !== 0) return;
  if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
  const anchor = closestAnchor(event.target);
  if (!anchor || anchor.download) return;
  if (anchor.target === "_blank" || anchor.target === "_new") return;
  const href = anchor.href;
  if (!href || href.startsWith("#")) return;
  let destination: URL;
  try {
    destination = new URL(href, window.location.href);
  } catch {
    return;
  }
  if (destination.protocol !== "http:" && destination.protocol !== "https:") {
    return;
  }
  if (destination.origin !== window.location.origin) return;
  if (
    destination.pathname === window.location.pathname &&
    destination.search === window.location.search
  ) {
    return;
  }
  if (!confirmDiscardUnsavedOwnerEdits(true)) {
    event.preventDefault();
  }
}

const OwnerDraftDirtyContext = createContext(false);

export function useOwnerUnsavedEdits(): boolean {
  return useContext(OwnerDraftDirtyContext);
}

export function useOwnerDraftUnloadProtection(dirty: boolean) {
  useEffect(() => {
    if (!dirty) return;
    const previous = window.onbeforeunload;
    const handler = (event: BeforeUnloadEvent) =>
      ownerDraftBeforeUnloadHandler(event, true);
    window.onbeforeunload = handler;
    return () => {
      if (window.onbeforeunload === handler) {
        window.onbeforeunload = previous;
      }
    };
  }, [dirty]);
}

export function ownerDraftNavigationProps(dirty: boolean): {
  onClickCapture: (event: ReactMouseEvent<HTMLElement>) => void;
} {
  return {
    onClickCapture: (event: ReactMouseEvent<HTMLElement>) => {
      interceptOwnerNavigationClick(event, dirty);
    },
  };
}

export function OwnerDraftDirtyGuard({
  dirty,
  children,
}: {
  dirty: boolean;
  children: ReactNode;
}) {
  useOwnerDraftUnloadProtection(dirty);
  return createElement(
    OwnerDraftDirtyContext.Provider,
    { value: dirty },
    children,
  );
}

export function useOwnerDraftDirtyState<T>(
  initialDraft: T,
  initialRevision: number,
) {
  const [state, setState] = useState(() =>
    createOwnerDraftDirtyState(initialDraft, initialRevision),
  );
  const stateRef = useRef(state);
  const draftRef = useRef(state.draft);

  const commit = useCallback((next: OwnerDraftDirtyState<T>) => {
    stateRef.current = next;
    draftRef.current = next.draft;
    setState(next);
  }, []);

  const setDraft = useCallback(
    (next: T | ((current: T) => T)) => {
      const current = stateRef.current;
      const resolved =
        typeof next === "function"
          ? (next as (current: T) => T)(current.draft)
          : next;
      commit(applyOwnerDraftEdit(current, resolved));
    },
    [commit],
  );

  const applyAuxiliary = useCallback(
    (patch: (draft: T) => T, revision?: number) => {
      const current = stateRef.current;
      commit(
        reconcileOwnerDraftAuxiliary(
          current,
          patch,
          revision ?? current.revision,
        ),
      );
    },
    [commit],
  );

  const setRevision = useCallback(
    (revision: number) => {
      commit(setOwnerDraftRevision(stateRef.current, revision));
    },
    [commit],
  );

  const beginSave = useCallback(
    () => beginOwnerDraftSave(stateRef.current),
    [],
  );

  const acknowledgeSave = useCallback(
    (acknowledgement: OwnerDraftSaveAcknowledgement<T>) => {
      const reconciled = acknowledgeOwnerDraftSave(
        stateRef.current,
        acknowledgement,
      );
      commit(reconciled.state);
      return reconciled;
    },
    [commit],
  );

  const acknowledgeSnapshot = useCallback(
    (snapshot: T, revision: number) => {
      commit(
        acknowledgeOwnerDraftSnapshot(stateRef.current, snapshot, revision),
      );
    },
    [commit],
  );

  const adoptServerDraft = useCallback(
    (input: { draft: T; baseline: T; revision: number }) => {
      commit(adoptOwnerDraftServerState(stateRef.current, input));
    },
    [commit],
  );

  return {
    draft: state.draft,
    baseline: state.baseline,
    revision: state.revision,
    dirty: state.dirty,
    mutationVersion: state.mutationVersion,
    draftRef,
    setDraft,
    applyAuxiliary,
    setRevision,
    beginSave,
    acknowledgeSave,
    acknowledgeSnapshot,
    adoptServerDraft,
  };
}
