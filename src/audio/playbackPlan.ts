import { validateProjectDocument } from "../doc/schema";
import type { ProjectDocument, SchemaIssue } from "../doc/types";
import {
  isInstrumentCompatible,
  resolveInstrument,
  type InstrumentEntry,
} from "../instruments/registry";

export interface ScheduledNote {
  trackId: string;
  instrument: InstrumentEntry;
  volume: number;
  beat: number;
  dur: number;
  pitch: number;
  vel: number;
}

export interface M0PlaybackPlan {
  documentId: string;
  tempo: number;
  totalBeats: number;
  events: ScheduledNote[];
}

/**
 * A valid project can still be intentionally silent (all tracks muted, all
 * volumes at zero, or no clips). Treat that as a recoverable user-facing
 * condition instead of creating a valid-looking but silent playback/export.
 */
export function playbackPlanAudibilityIssue(
  plan: M0PlaybackPlan,
): string | null {
  if (plan.events.length === 0) {
    return "当前工程没有可播放的音符。请先在 Piano Roll 添加音符，或用本机引导扩展一个段落。";
  }
  if (!plan.events.some((event) => event.volume > 0 && event.vel > 0)) {
    return "当前所有可播放轨道的音量均为 0。请在 Demo 或编排页提高至少一条轨道的音量后再试听或导出。";
  }
  return null;
}

export type PlaybackPlanResult =
  { ok: true; plan: M0PlaybackPlan } | { ok: false; errors: SchemaIssue[] };

export function compileM0PlaybackPlan(raw: unknown): PlaybackPlanResult {
  const validation = validateProjectDocument(raw);
  if (!validation.valid) return { ok: false, errors: validation.errors };

  const document = validation.document;
  const errors: SchemaIssue[] = [];
  const playableTracks = determinePlayableTracks(document);
  const offsets = sectionOffsets(document);
  const events: ScheduledNote[] = [];

  for (const track of document.tracks) {
    if (!playableTracks.has(track.id)) continue;
    const instrument = resolveInstrument(
      document.meta.instrumentRegistryVersion,
      track.instrument,
    );
    if (!instrument) {
      errors.push({
        path: `$.tracks[${track.id}].instrument`,
        code: "instrument_missing",
        message: `未找到注册表 ${document.meta.instrumentRegistryVersion} 中的乐器 ${track.instrument}。`,
      });
      continue;
    }
    if (!isInstrumentCompatible(track.role, instrument)) {
      errors.push({
        path: `$.tracks[${track.id}].instrument`,
        code: "instrument_role",
        message: `乐器 ${track.instrument} 不支持 ${track.role} 轨道。`,
      });
      continue;
    }
    for (const clip of document.clips.filter(
      (item) => item.trackId === track.id,
    )) {
      const offset = offsets.get(clip.sectionId);
      if (offset === undefined) continue;
      for (const note of clip.notes)
        events.push({
          trackId: track.id,
          instrument,
          volume: track.vol,
          beat: offset + note.start,
          dur: note.dur,
          pitch: note.pitch,
          vel: note.vel,
        });
    }
  }

  if (errors.length > 0) return { ok: false, errors };
  events.sort(
    (a, b) =>
      a.beat - b.beat ||
      a.trackId.localeCompare(b.trackId) ||
      a.pitch - b.pitch,
  );
  return {
    ok: true,
    plan: {
      documentId: document.id,
      tempo: document.meta.tempo,
      totalBeats: [...offsets.values()].at(-1) ?? 0,
      events,
    },
  };
}

function determinePlayableTracks(document: ProjectDocument): Set<string> {
  const hasSolo = document.tracks.some((track) => track.solo && !track.mute);
  return new Set(
    document.tracks
      .filter((track) => !track.mute && (!hasSolo || track.solo))
      .map((track) => track.id),
  );
}

function sectionOffsets(document: ProjectDocument): Map<string, number> {
  const offsets = new Map<string, number>();
  let currentBeat = 0;
  for (const section of document.sections) {
    offsets.set(section.id, currentBeat);
    currentBeat += section.bars * 4;
  }
  // Sentinel value lets callers use the final project length without recreating section traversal.
  offsets.set("__project_end__", currentBeat);
  return offsets;
}
