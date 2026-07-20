import type { GatewayModelProvider } from "../agent/gatewayClient";

export type JourneyStage =
  | "rhythm"
  | "workshop"
  | "audio-seeds"
  | "brief"
  | "plan"
  | "extend"
  | "manual-edit"
  | "export"
  | "completed";

export type SeedPurpose = "mood" | "rhythm" | "timbre" | "structure";
export type JourneyMood = "relaxed" | "bright" | "powerful";
export type JourneyStyle = "lofi" | "pop" | "electronic" | "game";
export type JourneyEnergy = "steady" | "build" | "contrast";
export type JourneyLength = "30s" | "60s" | "120s";

export interface AudioSeedAnalysis {
  durationSeconds: number;
  estimatedTempo?: number;
  energy: "gentle" | "balanced" | "strong";
  brightness: "warm" | "balanced" | "bright";
  energyArc: "steady" | "rising" | "varied";
  summary: string;
}

export interface AudioSeed {
  id: string;
  fileName: string;
  localPath: string;
  byteLength: number;
  contentHash: string;
  purpose: SeedPurpose;
  weight: number;
  selectedRangeLabel: string;
  analysis: AudioSeedAnalysis;
}

export interface CreativeBrief {
  mood: JourneyMood;
  style: JourneyStyle;
  energy: JourneyEnergy;
  length: JourneyLength;
  motifPolicy: "featured" | "occasional" | "intro-only";
  userCorrection: string;
  audioSeeds: AudioSeed[];
  sendAudioToProvider: false;
}

export interface SongPlanStep {
  id: string;
  sectionName: string;
  description: string;
  energyLevel: 1 | 2 | 3 | 4 | 5;
}

export interface CreativeJourney {
  version: 1;
  projectId: string | null;
  stage: JourneyStage;
  seedSectionId: string | null;
  completedSectionIds: string[];
  brief: CreativeBrief;
  selectedProvider: GatewayModelProvider;
}
