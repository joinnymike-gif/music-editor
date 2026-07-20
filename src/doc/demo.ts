import validProject from "./fixtures/valid-project-v1.json";
import { assertValidProjectDocument } from "./schema";
import type { ProjectDocument } from "./types";

// 内置 demo 走和用户工程完全相同的校验路径，禁止在音频层另行硬编码结构。
export const builtInDemo: ProjectDocument =
  assertValidProjectDocument(validProject);

export function getBuiltInDemo(): ProjectDocument {
  return structuredClone(builtInDemo);
}
