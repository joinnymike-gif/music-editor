export type TutorialRoute =
  "welcome" | "journey" | "demo" | "arrangement" | "piano-roll" | "chat";

export type TutorialStatus =
  "not_started" | "in_progress" | "completed" | "skipped";

export interface TutorialContext {
  route: TutorialRoute;
  activePanel?: string;
  editorMode?: "select" | "record";
  hasSelection?: boolean;
}

export interface TutorialStep {
  id: string;
  title: string;
  anchor?: string;
  instruction: string;
  expectedResult: string;
  accessibilityText: string;
}

export interface TutorialDefinition {
  id: string;
  contentVersion: number;
  route: TutorialRoute;
  title: string;
  goal: string;
  prerequisites: string;
  commonMistake: string;
  recovery: string;
  steps: TutorialStep[];
}

export interface TutorialProgressEntry {
  contentVersion: number;
  status: TutorialStatus;
  stepIndex: number;
  updatedAt: string;
}

export interface TutorialProgress {
  version: 1;
  entries: Record<string, TutorialProgressEntry>;
}
