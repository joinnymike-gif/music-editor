export const schemaVersion = "1.0" as const;

export type ProjectKey =
  "C" | "C#" | "D" | "D#" | "E" | "F" | "F#" | "G" | "G#" | "A" | "A#" | "B";
export type ProjectMode = "major" | "minor";
export type TrackRole = "drums" | "bass" | "harmony" | "lead" | "pad" | "fx";
export type AutomationParam = "volume" | "filterCutoff";

export interface ProjectMeta {
  tempo: number;
  key: ProjectKey;
  mode: ProjectMode;
  timeSig: [4, 4];
  instrumentRegistryVersion: string;
}

export interface Section {
  id: string;
  name: string;
  bars: number;
}

export interface Track {
  id: string;
  name: string;
  role: TrackRole;
  instrument: string;
  vol: number;
  mute: boolean;
  solo: boolean;
}

export interface Note {
  id: string;
  start: number;
  dur: number;
  pitch: number;
  vel: number;
}

export interface Clip {
  id: string;
  trackId: string;
  sectionId: string;
  notes: Note[];
}

export interface AutomationPoint {
  at: number;
  val: number;
}

export interface AutomationLane {
  trackId: string;
  param: AutomationParam;
  points: AutomationPoint[];
}

export interface ProjectDocument {
  schemaVersion: typeof schemaVersion;
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  meta: ProjectMeta;
  sections: Section[];
  tracks: Track[];
  clips: Clip[];
  automation: AutomationLane[];
}

export interface SchemaIssue {
  path: string;
  code: string;
  message: string;
}

export type ProjectValidationResult =
  | { valid: true; document: ProjectDocument }
  | { valid: false; errors: SchemaIssue[] };
