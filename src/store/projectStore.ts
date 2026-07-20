import { create } from "zustand";
import { getBuiltInDemo } from "../doc/demo";
import { openProjectDocument, type DocumentOpenResult } from "../doc/migrate";
import { createProject, type ProjectTemplate } from "../doc/templates";
import type { ProjectDocument } from "../doc/types";
import { applyOperationBatch, type OperationApplyResult } from "../ops/apply";

const maxHistoryEntries = 50;

interface ProjectState {
  document: ProjectDocument;
  openResult: DocumentOpenResult;
  past: ProjectDocument[];
  future: ProjectDocument[];
  filePath: string | null;
  isDirty: boolean;
  lastSavedAt: string | null;
  createNewProject: (template: ProjectTemplate) => void;
  replaceWithNewProject: (document: ProjectDocument) => void;
  loadDocument: (raw: unknown) => DocumentOpenResult;
  markSaved: (document: ProjectDocument, filePath: string) => void;
  openSavedProject: (document: ProjectDocument, filePath: string) => void;
  restoreRecoveredProject: (
    document: ProjectDocument,
    filePath: string | null,
    lastSavedAt: string | null,
  ) => void;
  applyOperations: (batch: unknown) => OperationApplyResult;
  undo: () => boolean;
  redo: () => boolean;
  resetToBuiltInDemo: () => void;
}

function editableDemoState(): Pick<
  ProjectState,
  | "document"
  | "openResult"
  | "past"
  | "future"
  | "filePath"
  | "isDirty"
  | "lastSavedAt"
> {
  const document = getBuiltInDemo();
  return {
    document,
    openResult: { kind: "editable", document },
    past: [],
    future: [],
    filePath: null,
    isDirty: false,
    lastSavedAt: null,
  };
}

function snapshot(document: ProjectDocument): ProjectDocument {
  return structuredClone(document);
}

function appendHistory(
  history: ProjectDocument[],
  document: ProjectDocument,
): ProjectDocument[] {
  return [...history, snapshot(document)].slice(-maxHistoryEntries);
}

export const useProjectStore = create<ProjectState>((set, get) => ({
  ...editableDemoState(),
  loadDocument: (raw) => {
    const result = openProjectDocument(raw);
    if (result.kind === "editable")
      set({
        document: result.document,
        openResult: result,
        past: [],
        future: [],
        filePath: null,
        isDirty: false,
        lastSavedAt: result.document.updatedAt,
      });
    else set({ openResult: result });
    return result;
  },
  createNewProject: (template) => {
    const document = createProject(template);
    set({
      document,
      openResult: { kind: "editable", document },
      past: [],
      future: [],
      filePath: null,
      isDirty: true,
      lastSavedAt: null,
    });
  },
  replaceWithNewProject: (document) =>
    set({
      document,
      openResult: { kind: "editable", document },
      past: [],
      future: [],
      filePath: null,
      isDirty: true,
      lastSavedAt: null,
    }),
  markSaved: (document, filePath) =>
    set({
      document,
      openResult: { kind: "editable", document },
      filePath,
      isDirty: false,
      lastSavedAt: document.updatedAt,
    }),
  openSavedProject: (document, filePath) =>
    set({
      document,
      openResult: { kind: "editable", document },
      past: [],
      future: [],
      filePath,
      isDirty: false,
      lastSavedAt: document.updatedAt,
    }),
  restoreRecoveredProject: (document, filePath, lastSavedAt) =>
    set({
      document,
      openResult: { kind: "editable", document },
      past: [],
      future: [],
      filePath,
      isDirty: true,
      lastSavedAt,
    }),
  applyOperations: (batch) => {
    const current = get();
    const result = applyOperationBatch(current.document, batch);
    if (result.applied)
      set({
        document: result.document,
        openResult: { kind: "editable", document: result.document },
        past: appendHistory(current.past, current.document),
        future: [],
        isDirty: true,
      });
    return result;
  },
  undo: () => {
    const current = get();
    const previous = current.past.at(-1);
    if (!previous) return false;
    const document = snapshot(previous);
    set({
      document,
      openResult: { kind: "editable", document },
      past: current.past.slice(0, -1),
      future: [snapshot(current.document), ...current.future].slice(
        0,
        maxHistoryEntries,
      ),
      isDirty: true,
    });
    return true;
  },
  redo: () => {
    const current = get();
    const next = current.future[0];
    if (!next) return false;
    const document = snapshot(next);
    set({
      document,
      openResult: { kind: "editable", document },
      past: appendHistory(current.past, current.document),
      future: current.future.slice(1),
      isDirty: true,
    });
    return true;
  },
  resetToBuiltInDemo: () => set(editableDemoState()),
}));
