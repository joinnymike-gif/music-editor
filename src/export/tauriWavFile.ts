import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ProjectDocument } from "../doc/types";
import { assertDesktopRuntime } from "../lifecycle/tauriRuntime";
import { createWavFile } from "./wav";

const wavFileFilter = [{ name: "WAV Audio", extensions: ["wav"] }];

export async function exportWavWithDialog(
  document: ProjectDocument,
): Promise<string | null> {
  assertDesktopRuntime();
  const bytes = await createWavFile(document);
  const path = await save({
    defaultPath: `${safeFileName(document.name)}.wav`,
    filters: wavFileFilter,
  });
  if (!path) return null;
  await writeFile(path, bytes);
  return path;
}

function safeFileName(name: string): string {
  const sanitized = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return sanitized.length > 0 ? sanitized : "untitled-project";
}
