import { save } from "@tauri-apps/plugin-dialog";
import { writeFile } from "@tauri-apps/plugin-fs";
import type { ProjectDocument } from "../doc/types";
import { assertDesktopRuntime } from "../lifecycle/tauriRuntime";
import { createMidiFile } from "./midi";

const midiFileFilter = [{ name: "Standard MIDI File", extensions: ["mid"] }];

export async function exportMidiWithDialog(
  document: ProjectDocument,
): Promise<string | null> {
  assertDesktopRuntime();
  const path = await save({
    defaultPath: `${safeFileName(document.name)}.mid`,
    filters: midiFileFilter,
  });
  if (!path) return null;
  await writeFile(path, createMidiFile(document));
  return path;
}

function safeFileName(name: string): string {
  const sanitized = name.trim().replace(/[\\/:*?"<>|]+/g, "-");
  return sanitized.length > 0 ? sanitized : "untitled-project";
}
