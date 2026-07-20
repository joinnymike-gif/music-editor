import type { ProjectKey, ProjectMode } from "../doc/types";

const rootSemitones: Record<ProjectKey, number> = {
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

const intervals: Record<ProjectMode, readonly number[]> = {
  major: [0, 2, 4, 5, 7, 9, 11],
  minor: [0, 2, 3, 5, 7, 8, 10],
};

export const qwertScaleKeys = ["q", "w", "e", "r", "t", "y", "u"] as const;

export function scaleDegreeToMidi(
  key: ProjectKey,
  mode: ProjectMode,
  degree: number,
  octave = 4,
): number {
  const interval = intervals[mode][degree];
  if (interval === undefined) throw new Error(`不支持的音阶级数 ${degree}。`);
  return (octave + 1) * 12 + rootSemitones[key] + interval;
}

export function qwertKeyToMidi(
  key: string,
  projectKey: ProjectKey,
  mode: ProjectMode,
  octave = 4,
): number | undefined {
  const degree = qwertScaleKeys.indexOf(
    key.toLowerCase() as (typeof qwertScaleKeys)[number],
  );
  return degree < 0
    ? undefined
    : scaleDegreeToMidi(projectKey, mode, degree, octave);
}
