import type {
  ModelClient,
  ModelGenerationRequest,
  NoteProposal,
} from "./types.js";

const keyPitchClasses: Record<string, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};

/**
 * Deterministic local-only stand-in for a model provider. It never sends a
 * request outside the machine and exists solely to exercise the product flow.
 */
export class LocalDemoModelClient implements ModelClient {
  async generate(request: ModelGenerationRequest): Promise<NoteProposal> {
    const root = keyPitchClasses[request.request.scope.key] ?? 0;
    const scale =
      request.request.scope.mode === "major"
        ? [0, 2, 4, 5, 7, 9, 11]
        : [0, 2, 3, 5, 7, 8, 10];
    const sectionBeats = request.request.scope.sectionBeats;
    const count = Math.min(8, Math.max(2, Math.floor(sectionBeats / 2)));
    const step = Math.max(0.25, Math.floor((sectionBeats / count) * 4) / 4);
    const notes = Array.from({ length: count }, (_, index) => {
      const start = Math.min(
        sectionBeats - 0.25,
        Math.round(index * step * 4) / 4,
      );
      return createNote(
        request.request.scope.role,
        root,
        scale,
        index,
        start,
        step,
        sectionBeats,
      );
    });
    return {
      summary: `本地演示候选：${request.request.scope.role} · ${request.request.strategy === "replace" ? "替换" : "叠加"}`,
      notes,
    };
  }
}

function createNote(
  role: ModelGenerationRequest["request"]["scope"]["role"],
  root: number,
  scale: number[],
  index: number,
  start: number,
  step: number,
  sectionBeats: number,
): { start: number; dur: number; pitch: number; vel: number } {
  const dur = Math.max(0.25, Math.min(step, sectionBeats - start));
  if (role === "drums") {
    return {
      start,
      dur: Math.min(0.5, dur),
      pitch: index % 2 === 0 ? 36 : 42,
      vel: index % 2 === 0 ? 108 : 76,
    };
  }
  if (role === "bass") {
    return {
      start,
      dur,
      pitch: 36 + root + (index % 4 === 3 ? 7 : 0),
      vel: 92,
    };
  }
  if (role === "harmony" || role === "pad") {
    return {
      start,
      dur,
      pitch: 48 + root + scale[(index * 2) % scale.length],
      vel: 72,
    };
  }
  return {
    start,
    dur,
    pitch: 60 + root + scale[index % scale.length],
    vel: 88,
  };
}
