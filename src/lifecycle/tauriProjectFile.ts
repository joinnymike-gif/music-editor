import { open, save } from "@tauri-apps/plugin-dialog";
import { readTextFile, writeTextFile } from "@tauri-apps/plugin-fs";
import type { ProjectDocument } from "../doc/types";
import {
  parseProjectDocument,
  prepareProjectForSave,
  serializeProjectDocument,
} from "./projectCodec";
import { assertDesktopRuntime } from "./tauriRuntime";

const projectFileFilter = [
  { name: "AI Music IDE Project", extensions: ["json"] },
];

export interface OpenedProjectFile {
  path: string;
  document: ProjectDocument;
}

export async function saveProject(
  document: ProjectDocument,
  currentPath: string | null,
): Promise<{ path: string; document: ProjectDocument } | null> {
  assertDesktopRuntime();
  if (!currentPath) return saveProjectAsWithDialog(document, null);
  return writeProjectFile(document, currentPath);
}

export async function saveProjectAsWithDialog(
  document: ProjectDocument,
  currentPath: string | null,
): Promise<{ path: string; document: ProjectDocument } | null> {
  assertDesktopRuntime();
  const path = await save({
    defaultPath: currentPath ?? `${safeFileName(document.name)}.json`,
    filters: projectFileFilter,
  });
  if (!path) return null;
  return writeProjectFile(document, path);
}

async function writeProjectFile(
  document: ProjectDocument,
  path: string,
): Promise<{ path: string; document: ProjectDocument }> {
  const savedDocument = prepareProjectForSave(document);
  await writeTextFile(path, serializeProjectDocument(savedDocument));
  return { path, document: savedDocument };
}

export async function openProjectWithDialog(): Promise<OpenedProjectFile | null> {
  assertDesktopRuntime();
  const path = await open({ multiple: false, filters: projectFileFilter });
  if (!path || Array.isArray(path)) return null;
  return { path, document: parseProjectDocument(await readTextFile(path)) };
}

function safeFileName(name: string): string {
  const sanitized = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return sanitized.length > 0 ? sanitized : "untitled-project";
}
