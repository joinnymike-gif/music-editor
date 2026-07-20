import type {
  TutorialDefinition,
  TutorialProgress,
  TutorialProgressEntry,
  TutorialStatus,
} from "./types";

export const tutorialProgressStorageKey = "ai-music-ide:tutorial-progress:v1";

export const emptyTutorialProgress = (): TutorialProgress => ({
  version: 1,
  entries: {},
});

export function loadTutorialProgress(
  storage: Storage | undefined = globalThis.localStorage,
): TutorialProgress {
  if (!storage) return emptyTutorialProgress();

  try {
    const raw = storage.getItem(tutorialProgressStorageKey);
    if (!raw) return emptyTutorialProgress();
    const parsed: unknown = JSON.parse(raw);
    if (!isTutorialProgress(parsed)) return emptyTutorialProgress();
    return parsed;
  } catch {
    return emptyTutorialProgress();
  }
}

export function entryForTutorial(
  progress: TutorialProgress,
  tutorial: TutorialDefinition,
): TutorialProgressEntry {
  const entry = progress.entries[tutorial.id];
  if (!entry || entry.contentVersion !== tutorial.contentVersion) {
    return {
      contentVersion: tutorial.contentVersion,
      status: "not_started",
      stepIndex: 0,
      updatedAt: new Date(0).toISOString(),
    };
  }
  return {
    ...entry,
    stepIndex: Math.min(
      Math.max(0, entry.stepIndex),
      tutorial.steps.length - 1,
    ),
  };
}

export function updateTutorialProgress(
  progress: TutorialProgress,
  tutorial: TutorialDefinition,
  status: TutorialStatus,
  stepIndex: number,
  now = new Date(),
): TutorialProgress {
  return {
    version: 1,
    entries: {
      ...progress.entries,
      [tutorial.id]: {
        contentVersion: tutorial.contentVersion,
        status,
        stepIndex: Math.min(Math.max(0, stepIndex), tutorial.steps.length - 1),
        updatedAt: now.toISOString(),
      },
    },
  };
}

export function saveTutorialProgress(
  progress: TutorialProgress,
  storage: Storage | undefined = globalThis.localStorage,
): void {
  if (!storage) return;
  storage.setItem(tutorialProgressStorageKey, JSON.stringify(progress));
}

function isTutorialStatus(value: unknown): value is TutorialStatus {
  return (
    value === "not_started" ||
    value === "in_progress" ||
    value === "completed" ||
    value === "skipped"
  );
}

function isTutorialProgress(value: unknown): value is TutorialProgress {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<TutorialProgress>;
  if (
    candidate.version !== 1 ||
    !candidate.entries ||
    typeof candidate.entries !== "object"
  )
    return false;
  return Object.values(candidate.entries).every((entry) => {
    if (!entry || typeof entry !== "object") return false;
    const item = entry as Partial<TutorialProgressEntry>;
    return (
      typeof item.contentVersion === "number" &&
      isTutorialStatus(item.status) &&
      typeof item.stepIndex === "number" &&
      typeof item.updatedAt === "string"
    );
  });
}
