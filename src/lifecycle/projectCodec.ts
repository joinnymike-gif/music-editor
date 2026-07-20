import { assertValidProjectDocument } from "../doc/schema";
import type { ProjectDocument } from "../doc/types";

export function prepareProjectForSave(
  document: ProjectDocument,
  now = new Date(),
): ProjectDocument {
  return assertValidProjectDocument({
    ...structuredClone(document),
    updatedAt: now.toISOString(),
  });
}

export function serializeProjectDocument(document: ProjectDocument): string {
  return `${JSON.stringify(document, null, 2)}\n`;
}

export function parseProjectDocument(text: string): ProjectDocument {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error("工程文件不是有效 JSON。");
  }
  return assertValidProjectDocument(raw);
}
