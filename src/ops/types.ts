export type OperationSource =
  "manual" | "keyboard" | "agent" | "macro" | "import";

export type Scope =
  | { kind: "whole" }
  | { kind: "section"; sectionId: string }
  | { kind: "track"; trackId: string }
  | { kind: "clip"; trackId: string; sectionId: string };

export type OperationType =
  | "addSection"
  | "removeSection"
  | "extendSection"
  | "shrinkSection"
  | "reorderSections"
  | "addTrack"
  | "removeTrack"
  | "setInstrument"
  | "upsertClip"
  | "removeClip"
  | "replaceClipNotes"
  | "insertNotes"
  | "updateNotes"
  | "removeNotes"
  | "removeNotesInRange"
  | "transpose"
  | "quantize"
  | "setVelocity"
  | "halfTime"
  | "doubleTime"
  | "humanize"
  | "setTempo"
  | "setKey"
  | "changeKey"
  | "setVolume"
  | "mute"
  | "solo"
  | "upsertAutomationPoints"
  | "removeAutomationPoints";

export interface Operation {
  id: string;
  type: OperationType;
  scope: Scope;
  args: Record<string, unknown>;
}

export interface OperationBatch {
  id: string;
  source: OperationSource;
  label: string;
  operations: Operation[];
}

export interface OperationIssue {
  path: string;
  code: string;
  message: string;
  operationId?: string;
}

export type OperationValidationResult =
  | { valid: true; batch: OperationBatch }
  | { valid: false; errors: OperationIssue[] };
