import type {
  AudioSeed,
  CreativeBrief,
  CreativeJourney,
  JourneyStage,
} from "./types";

const storageKey = "ai-music-ide:creative-journey:v1";
type JourneyStorage = Pick<Storage, "getItem" | "setItem">;

export function createCreativeJourney(): CreativeJourney {
  return {
    version: 1,
    projectId: null,
    stage: "rhythm",
    seedSectionId: null,
    completedSectionIds: [],
    selectedProvider: "gemini",
    brief: {
      mood: "relaxed",
      style: "lofi",
      energy: "build",
      length: "60s",
      motifPolicy: "featured",
      userCorrection: "",
      audioSeeds: [],
      // First release never uploads source audio. Only its local summary is used.
      sendAudioToProvider: false,
    },
  };
}

export function loadCreativeJourney(
  storage: JourneyStorage = window.localStorage,
): CreativeJourney {
  try {
    const raw = storage.getItem(storageKey);
    if (!raw) return createCreativeJourney();
    const value = JSON.parse(raw) as Partial<CreativeJourney>;
    if (value.version !== 1 || !value.brief || !value.stage)
      return createCreativeJourney();
    const defaults = createCreativeJourney();
    return {
      ...defaults,
      ...value,
      projectId:
        typeof value.projectId === "string" || value.projectId === null
          ? value.projectId
          : null,
      stage: isStage(value.stage) ? value.stage : defaults.stage,
      completedSectionIds: Array.isArray(value.completedSectionIds)
        ? value.completedSectionIds.filter(
            (item): item is string => typeof item === "string",
          )
        : [],
      selectedProvider:
        value.selectedProvider === "openai" ||
        value.selectedProvider === "gemini"
          ? value.selectedProvider
          : defaults.selectedProvider,
      brief: normalizeBrief(value.brief, defaults.brief),
    };
  } catch {
    return createCreativeJourney();
  }
}

export function saveCreativeJourney(
  journey: CreativeJourney,
  storage: JourneyStorage = window.localStorage,
): void {
  storage.setItem(storageKey, JSON.stringify(journey));
}

/**
 * Journey progress belongs to the workshop project that created it. The
 * project store and localStorage recover independently after an app restart,
 * so stale progress must never be applied to a different project or the
 * built-in demo.
 */
export function reconcileCreativeJourneyProject(
  journey: CreativeJourney,
  currentProjectId: string,
): CreativeJourney {
  const isFreshJourney =
    journey.projectId === null && journey.stage === "rhythm";
  return isFreshJourney || journey.projectId === currentProjectId
    ? journey
    : createCreativeJourney();
}

function normalizeBrief(
  value: Partial<CreativeBrief>,
  defaults: CreativeBrief,
): CreativeBrief {
  return {
    ...defaults,
    ...value,
    mood: oneOf(value.mood, ["relaxed", "bright", "powerful"], defaults.mood),
    style: oneOf(
      value.style,
      ["lofi", "pop", "electronic", "game"],
      defaults.style,
    ),
    energy: oneOf(
      value.energy,
      ["steady", "build", "contrast"],
      defaults.energy,
    ),
    length: oneOf(value.length, ["30s", "60s", "120s"], defaults.length),
    motifPolicy: oneOf(
      value.motifPolicy,
      ["featured", "occasional", "intro-only"],
      defaults.motifPolicy,
    ),
    userCorrection:
      typeof value.userCorrection === "string"
        ? value.userCorrection.slice(0, 280)
        : defaults.userCorrection,
    audioSeeds: Array.isArray(value.audioSeeds)
      ? value.audioSeeds.filter(isAudioSeed).slice(0, 3)
      : [],
    sendAudioToProvider: false,
  };
}

function isStage(value: unknown): value is JourneyStage {
  return [
    "rhythm",
    "workshop",
    "audio-seeds",
    "brief",
    "plan",
    "extend",
    "manual-edit",
    "export",
    "completed",
  ].includes(value as JourneyStage);
}

function oneOf<T extends string>(
  value: unknown,
  options: readonly T[],
  fallback: T,
): T {
  return typeof value === "string" && options.includes(value as T)
    ? (value as T)
    : fallback;
}

function isAudioSeed(value: unknown): value is AudioSeed {
  if (!value || typeof value !== "object") return false;
  const seed = value as Partial<AudioSeed>;
  return (
    typeof seed.id === "string" &&
    typeof seed.fileName === "string" &&
    typeof seed.localPath === "string" &&
    typeof seed.byteLength === "number" &&
    typeof seed.contentHash === "string" &&
    ["mood", "rhythm", "timbre", "structure"].includes(seed.purpose ?? "") &&
    typeof seed.weight === "number" &&
    typeof seed.selectedRangeLabel === "string" &&
    Boolean(seed.analysis) &&
    typeof seed.analysis?.summary === "string" &&
    typeof seed.analysis?.durationSeconds === "number" &&
    ["gentle", "balanced", "strong"].includes(seed.analysis?.energy ?? "") &&
    ["warm", "balanced", "bright"].includes(seed.analysis?.brightness ?? "") &&
    ["steady", "rising", "varied"].includes(seed.analysis?.energyArc ?? "")
  );
}
