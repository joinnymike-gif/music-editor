import { validateProjectDocument } from "../doc/schema";
import type {
  AutomationLane,
  Clip,
  Note,
  ProjectDocument,
  ProjectKey,
  ProjectMode,
  Section,
  Track,
  TrackRole,
} from "../doc/types";
import {
  isInstrumentCompatible,
  resolveInstrument,
} from "../instruments/registry";
import { isInstrumentPlaybackAvailable } from "../audio/sampleBank";
import type { Operation, OperationIssue, Scope } from "./types";
import { validateOperationBatch } from "./validate";

export interface AffectedObjects {
  wholeProject: boolean;
  trackIds: string[];
  sectionIds: string[];
  createdNoteIds: string[];
  trimmedNoteIds: string[];
  removedNoteIds: string[];
  removedAutomationPoints: number;
  mergedAutomationPoints: number;
}

export type OperationApplyResult =
  | {
      applied: true;
      document: ProjectDocument;
      affected: AffectedObjects;
    }
  | { applied: false; errors: OperationIssue[] };

const projectKeys = new Set<ProjectKey>([
  "C",
  "C#",
  "D",
  "D#",
  "E",
  "F",
  "F#",
  "G",
  "G#",
  "A",
  "A#",
  "B",
]);
const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const keyPitchClasses: Record<ProjectKey, number> = {
  C: 0,
  "C#": 1,
  D: 2,
  "D#": 3,
  E: 4,
  F: 5,
  "F#": 6,
  G: 7,
  "G#": 8,
  A: 9,
  "A#": 10,
  B: 11,
};
const trackRoles = new Set<TrackRole>([
  "drums",
  "bass",
  "harmony",
  "lead",
  "pad",
  "fx",
]);

/**
 * Simulates a batch against a copy of a valid document. Only a fully valid
 * candidate is returned, so callers can replace their current document once.
 */
export function applyOperationBatch(
  document: ProjectDocument,
  rawBatch: unknown,
): OperationApplyResult {
  const batchResult = validateOperationBatch(rawBatch);
  if (!batchResult.valid) return { applied: false, errors: batchResult.errors };

  const sourceResult = validateProjectDocument(document);
  if (!sourceResult.valid)
    return {
      applied: false,
      errors: sourceResult.errors.map((error) => ({
        ...error,
        code: "document_invalid",
      })),
    };

  const candidate = structuredClone(sourceResult.document);
  const affected = createAffectedObjects();
  for (const operation of batchResult.batch.operations) {
    const error = applyOperation(candidate, operation, affected);
    if (error) return { applied: false, errors: [error] };
  }

  const finalResult = validateProjectDocument(candidate);
  if (!finalResult.valid)
    return {
      applied: false,
      errors: finalResult.errors.map((error) => ({
        ...error,
        code: "schema",
      })),
    };

  return { applied: true, document: finalResult.document, affected };
}

function applyOperation(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  switch (operation.type) {
    case "setTempo":
      return applySetTempo(document, operation, affected);
    case "setKey":
      return applySetKey(document, operation, affected);
    case "transpose":
      return applyTranspose(document, operation, affected);
    case "changeKey":
      return applyChangeKey(document, operation, affected);
    case "halfTime":
      return applyTimeScale(document, operation, affected, 2);
    case "doubleTime":
      return applyTimeScale(document, operation, affected, 0.5);
    case "quantize":
      return applyQuantize(document, operation, affected);
    case "setVelocity":
      return applySetVelocity(document, operation, affected);
    case "humanize":
      return applyHumanize(document, operation, affected);
    case "upsertClip":
      return applyUpsertClip(document, operation, affected);
    case "removeClip":
      return applyRemoveClip(document, operation, affected);
    case "replaceClipNotes":
      return applyReplaceClipNotes(document, operation, affected);
    case "insertNotes":
      return applyInsertNotes(document, operation, affected);
    case "updateNotes":
      return applyUpdateNotes(document, operation, affected);
    case "removeNotes":
      return applyRemoveNotes(document, operation, affected);
    case "removeNotesInRange":
      return applyRemoveNotesInRange(document, operation, affected);
    case "addTrack":
      return applyAddTrack(document, operation, affected);
    case "removeTrack":
      return applyRemoveTrack(document, operation, affected);
    case "setInstrument":
      return applySetInstrument(document, operation, affected);
    case "addSection":
      return applyAddSection(document, operation, affected);
    case "removeSection":
      return applyRemoveSection(document, operation, affected);
    case "extendSection":
      return applyExtendSection(document, operation, affected);
    case "shrinkSection":
      return applyShrinkSection(document, operation, affected);
    case "reorderSections":
      return applyReorderSections(document, operation, affected);
    case "upsertAutomationPoints":
      return applyUpsertAutomationPoints(document, operation, affected);
    case "removeAutomationPoints":
      return applyRemoveAutomationPoints(document, operation, affected);
    case "setVolume":
      return applyTrackProperty(document, operation, affected, "vol", "volume");
    case "mute":
      return applyTrackProperty(document, operation, affected, "mute", "value");
    case "solo":
      return applyTrackProperty(document, operation, affected, "solo", "value");
    default:
      return operationIssue(
        operation,
        "unsupported_operation",
        "该原语已登记，但尚未实现，不能写入工程。",
        "type",
      );
  }
}

function applySetTempo(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, ["tempo"]);
  if (argsError) return argsError;
  const tempo = operation.args.tempo;
  if (!isNumberInRange(tempo, 40, 240))
    return operationIssue(
      operation,
      "range",
      "tempo 必须是 40–240 BPM 的有限数字。",
      "args.tempo",
    );
  document.meta.tempo = tempo;
  affected.wholeProject = true;
  return undefined;
}

function applySetKey(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, ["key", "mode"]);
  if (argsError) return argsError;
  const { key, mode } = operation.args;
  if (typeof key !== "string" || !projectKeys.has(key as ProjectKey))
    return operationIssue(
      operation,
      "enum",
      "key 必须是 12 个半音名之一。",
      "args.key",
    );
  if (mode !== "major" && mode !== "minor")
    return operationIssue(
      operation,
      "enum",
      "mode 必须是 major 或 minor。",
      "args.mode",
    );
  document.meta.key = key as ProjectKey;
  document.meta.mode = mode as ProjectMode;
  affected.wholeProject = true;
  return undefined;
}

function applyTranspose(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["semitones"]);
  if (argsError) return argsError;
  const semitones = operation.args.semitones;
  if (!isIntegerInRange(semitones, -24, 24) || semitones === 0)
    return operationIssue(
      operation,
      "range",
      "semitones 必须是 -24–24 之间且不为 0 的整数。",
      "args.semitones",
    );

  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const melodicNotes = scopeResult.notes.filter(
    (item) => item.role !== "drums",
  );
  if (
    melodicNotes.some(
      (item) =>
        item.note.pitch + semitones < 0 || item.note.pitch + semitones > 127,
    )
  )
    return operationIssue(
      operation,
      "pitch_range",
      "转置后的任一非鼓组音符超出 MIDI 0–127，整个批次未应用。",
      "args.semitones",
    );

  melodicNotes.forEach((item) => {
    item.note.pitch += semitones;
    addAffectedTrack(affected, item.trackId);
    addAffectedSection(affected, item.sectionId);
  });
  return undefined;
}

function applyChangeKey(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, ["key", "mode", "semitones"]);
  if (argsError) return argsError;
  const { key, mode, semitones } = operation.args;
  if (typeof key !== "string" || !projectKeys.has(key as ProjectKey))
    return operationIssue(
      operation,
      "enum",
      "key 必须是 12 个半音名之一。",
      "args.key",
    );
  if (mode !== document.meta.mode)
    return operationIssue(
      operation,
      "mode_change",
      "changeKey 不可改变 major/minor；只改调性解释时请使用 setKey。",
      "args.mode",
    );
  if (!isIntegerInRange(semitones, -24, 24) || semitones === 0)
    return operationIssue(
      operation,
      "range",
      "semitones 必须是 -24–24 之间且不为 0 的整数。",
      "args.semitones",
    );
  const expectedPitchClass =
    (keyPitchClasses[document.meta.key] + semitones + 120) % 12;
  if (keyPitchClasses[key as ProjectKey] !== expectedPitchClass)
    return operationIssue(
      operation,
      "key_mismatch",
      "key 必须等于原 key 加 semitones 后的 pitch class。",
      "args.key",
    );
  const transposeOperation: Operation = {
    ...operation,
    type: "transpose",
    args: { semitones },
  };
  const transposeError = applyTranspose(document, transposeOperation, affected);
  if (transposeError) return transposeError;
  document.meta.key = key as ProjectKey;
  document.meta.mode = mode as ProjectMode;
  affected.wholeProject = true;
  return undefined;
}

function applyTimeScale(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
  factor: number,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, []);
  if (argsError) return argsError;
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const invalid = scopeResult.notes.find((item) => {
    const nextStart = item.note.start * factor;
    const nextDuration = item.note.dur * factor;
    return nextDuration < 0.25 || nextStart + nextDuration > item.sectionBeats;
  });
  if (invalid)
    return operationIssue(
      operation,
      "time_boundary",
      "缩放后音符不能短于 0.25 beat 或超出所在 section；整个批次未应用。",
      "scope",
    );
  scopeResult.notes.forEach((item) => {
    item.note.start *= factor;
    item.note.dur *= factor;
    addAffectedTrack(affected, item.trackId);
    addAffectedSection(affected, item.sectionId);
  });
  return undefined;
}

function applyQuantize(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["grid"]);
  if (argsError) return argsError;
  const grid = operation.args.grid;
  if (grid !== 0.25 && grid !== 0.5 && grid !== 1)
    return operationIssue(
      operation,
      "enum",
      "grid 只能是 0.25、0.5 或 1 beat。",
      "args.grid",
    );
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const quantized = scopeResult.notes.map((item) => ({
    ...item,
    start: quantizeBeat(item.note.start, grid),
  }));
  if (quantized.some((item) => item.start + item.note.dur > item.sectionBeats))
    return operationIssue(
      operation,
      "section_boundary",
      "量化后的音符不能超出所在 section；整个批次未应用。",
      "args.grid",
    );
  quantized.forEach((item) => {
    item.note.start = item.start;
    addAffectedTrack(affected, item.trackId);
    addAffectedSection(affected, item.sectionId);
  });
  sortAffectedClips(document, operation.scope);
  return undefined;
}

function applySetVelocity(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["velocity"]);
  if (argsError) return argsError;
  const velocity = operation.args.velocity;
  if (!isIntegerInRange(velocity, 1, 127))
    return operationIssue(
      operation,
      "range",
      "velocity 必须是 MIDI 1–127 的整数。",
      "args.velocity",
    );
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  scopeResult.notes.forEach((item) => {
    item.note.vel = velocity;
    addAffectedTrack(affected, item.trackId);
    addAffectedSection(affected, item.sectionId);
  });
  return undefined;
}

function applyHumanize(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["seed", "timing", "velocity"]);
  if (argsError) return argsError;
  const { seed, timing, velocity } = operation.args;
  if (!isIntegerInRange(seed, 0, 4_294_967_295))
    return operationIssue(
      operation,
      "range",
      "seed 必须是 0–4294967295 的整数。",
      "args.seed",
    );
  if (!isNumberInRange(timing, 0, 0.25))
    return operationIssue(
      operation,
      "range",
      "timing 必须是 0–0.25 beat 的有限数字。",
      "args.timing",
    );
  if (!isIntegerInRange(velocity, 0, 32))
    return operationIssue(
      operation,
      "range",
      "velocity 必须是 0–32 的整数。",
      "args.velocity",
    );
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const random = createSeededRandom(seed);
  const changes = scopeResult.notes.map((item) => ({
    ...item,
    start: normalizeBeat(item.note.start + randomSigned(random) * timing),
    vel: item.note.vel + Math.round(randomSigned(random) * velocity),
  }));
  if (
    changes.some(
      (item) =>
        item.start < 0 ||
        item.start + item.note.dur > item.sectionBeats ||
        item.vel < 1 ||
        item.vel > 127,
    )
  )
    return operationIssue(
      operation,
      "humanize_boundary",
      "humanize 后音符不能越出 section，力度也不能超出 MIDI 1–127；整个批次未应用。",
      "args",
    );
  changes.forEach((item) => {
    item.note.start = item.start;
    item.note.vel = item.vel;
    addAffectedTrack(affected, item.trackId);
    addAffectedSection(affected, item.sectionId);
  });
  sortAffectedClips(document, operation.scope);
  return undefined;
}

function applyUpsertClip(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["clipId", "notes"]);
  if (argsError) return argsError;
  const scopeResult = resolveClipScope(document, operation, false);
  if (!scopeResult.ok) return scopeResult.error;
  const clipId = operation.args.clipId;
  if (!isUuid(clipId))
    return operationIssue(
      operation,
      "uuid",
      "clipId 必须是 UUID。",
      "args.clipId",
    );
  const notesResult = parseNewNotes(
    document,
    operation,
    operation.args.notes,
    "args.notes",
    scopeResult.sectionBeats,
  );
  if (!notesResult.ok) return notesResult.error;
  if (scopeResult.clip) {
    if (scopeResult.clip.id !== clipId)
      return operationIssue(
        operation,
        "reference",
        "已存在的 clip 必须使用当前 clipId 更新。",
        "args.clipId",
      );
    scopeResult.clip.notes = notesResult.notes;
  } else {
    if (allPersistentIds(document).has(clipId))
      return operationIssue(
        operation,
        "duplicate",
        "clipId 必须在工程内全局唯一。",
        "args.clipId",
      );
    document.clips.push({
      id: clipId,
      trackId: scopeResult.trackId,
      sectionId: scopeResult.sectionId,
      notes: notesResult.notes,
    });
  }
  addAffectedTrack(affected, scopeResult.trackId);
  addAffectedSection(affected, scopeResult.sectionId);
  return undefined;
}

function applyRemoveClip(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, []);
  if (argsError) return argsError;
  const scopeResult = resolveClipScope(document, operation, true);
  if (!scopeResult.ok) return scopeResult.error;
  document.clips = document.clips.filter((clip) => clip !== scopeResult.clip);
  addAffectedTrack(affected, scopeResult.trackId);
  addAffectedSection(affected, scopeResult.sectionId);
  return undefined;
}

function applyReplaceClipNotes(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, [
    "trackId",
    "sectionId",
    "notes",
  ]);
  if (argsError) return argsError;
  const scopeResult = resolveClipScope(document, operation, true);
  if (!scopeResult.ok) return scopeResult.error;
  const clip = scopeResult.clip;
  if (!clip)
    return operationIssue(
      operation,
      "reference",
      "scope 必须引用当前工程中的 clip。",
      "scope",
    );
  const targetError = requireTargetArgs(operation, scopeResult);
  if (targetError) return targetError;
  const notesResult = parseNewNotes(
    document,
    operation,
    operation.args.notes,
    "args.notes",
    scopeResult.sectionBeats,
  );
  if (!notesResult.ok) return notesResult.error;
  clip.notes = notesResult.notes;
  addAffectedTrack(affected, scopeResult.trackId);
  addAffectedSection(affected, scopeResult.sectionId);
  return undefined;
}

function applyInsertNotes(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, [
    "trackId",
    "sectionId",
    "notes",
  ]);
  if (argsError) return argsError;
  const scopeResult = resolveClipScope(document, operation, true);
  if (!scopeResult.ok) return scopeResult.error;
  const clip = scopeResult.clip;
  if (!clip)
    return operationIssue(
      operation,
      "reference",
      "scope 必须引用当前工程中的 clip。",
      "scope",
    );
  const targetError = requireTargetArgs(operation, scopeResult);
  if (targetError) return targetError;
  const notesResult = parseNewNotes(
    document,
    operation,
    operation.args.notes,
    "args.notes",
    scopeResult.sectionBeats,
  );
  if (!notesResult.ok) return notesResult.error;
  clip.notes = sortNotes([...clip.notes, ...notesResult.notes]);
  addAffectedTrack(affected, scopeResult.trackId);
  addAffectedSection(affected, scopeResult.sectionId);
  return undefined;
}

function applyUpdateNotes(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["changes"]);
  if (argsError) return argsError;
  if (
    !Array.isArray(operation.args.changes) ||
    operation.args.changes.length === 0
  )
    return operationIssue(
      operation,
      "min_items",
      "changes 必须是至少包含一项的数组。",
      "args.changes",
    );
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const notesById = new Map(
    scopeResult.notes.map((item) => [item.note.id, item]),
  );
  const seenIds = new Set<string>();
  const changes: Array<{ note: Note; next: Note; scoped: ScopedNote }> = [];
  for (let index = 0; index < operation.args.changes.length; index += 1) {
    const path = `args.changes[${index}]`;
    const change = operation.args.changes[index];
    if (!isRecord(change))
      return operationIssue(operation, "type", "change 必须是对象。", path);
    const allowed = ["noteId", "pitch", "start", "dur", "vel"];
    const unknownKey = Object.keys(change).find(
      (key) => !allowed.includes(key),
    );
    if (unknownKey)
      return operationIssue(
        operation,
        "unknown_key",
        "change 不允许未知字段。",
        `${path}.${unknownKey}`,
      );
    if (!isUuid(change.noteId))
      return operationIssue(
        operation,
        "uuid",
        "noteId 必须是 UUID。",
        `${path}.noteId`,
      );
    if (seenIds.has(change.noteId))
      return operationIssue(
        operation,
        "duplicate",
        "同一 batch 内每个 noteId 只能更新一次。",
        `${path}.noteId`,
      );
    seenIds.add(change.noteId);
    if (
      !("pitch" in change) &&
      !("start" in change) &&
      !("dur" in change) &&
      !("vel" in change)
    )
      return operationIssue(
        operation,
        "required",
        "change 至少需要一个 pitch、start、dur 或 vel 字段。",
        path,
      );
    const scoped = notesById.get(change.noteId);
    if (!scoped)
      return operationIssue(
        operation,
        "reference",
        "noteId 必须存在于当前 scope。",
        `${path}.noteId`,
      );
    const next: Note = { ...scoped.note };
    if ("pitch" in change) {
      if (!isIntegerInRange(change.pitch, 0, 127))
        return operationIssue(
          operation,
          "range",
          "pitch 必须是 0–127 的整数。",
          `${path}.pitch`,
        );
      next.pitch = change.pitch;
    }
    if ("start" in change) {
      if (!isNumberInRange(change.start, 0, scoped.sectionBeats))
        return operationIssue(
          operation,
          "range",
          "start 必须在所在 section 内。",
          `${path}.start`,
        );
      next.start = change.start;
    }
    if ("dur" in change) {
      if (
        typeof change.dur !== "number" ||
        !Number.isFinite(change.dur) ||
        change.dur <= 0
      )
        return operationIssue(
          operation,
          "range",
          "dur 必须大于 0。",
          `${path}.dur`,
        );
      next.dur = change.dur;
    }
    if ("vel" in change) {
      if (!isIntegerInRange(change.vel, 1, 127))
        return operationIssue(
          operation,
          "range",
          "vel 必须是 1–127 的整数。",
          `${path}.vel`,
        );
      next.vel = change.vel;
    }
    if (next.start + next.dur > scoped.sectionBeats)
      return operationIssue(
        operation,
        "section_boundary",
        "更新后的 note 不能超出所在 section。",
        path,
      );
    changes.push({ note: scoped.note, next, scoped });
  }
  changes.forEach(({ note, next, scoped }) => {
    Object.assign(note, next);
    addAffectedTrack(affected, scoped.trackId);
    addAffectedSection(affected, scoped.sectionId);
  });
  sortAffectedClips(document, operation.scope);
  return undefined;
}

function applyRemoveNotes(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, ["noteIds"]);
  if (argsError) return argsError;
  const noteIds = operation.args.noteIds;
  if (!Array.isArray(noteIds) || noteIds.length === 0)
    return operationIssue(
      operation,
      "min_items",
      "noteIds 必须是至少包含一项的数组。",
      "args.noteIds",
    );
  const scopeResult = resolveNotesInScope(document, operation);
  if (!scopeResult.ok) return scopeResult.error;
  const scopedNotes = new Map(
    scopeResult.notes.map((item) => [item.note.id, item]),
  );
  const ids = new Set<string>();
  for (let index = 0; index < noteIds.length; index += 1) {
    const path = `args.noteIds[${index}]`;
    const noteId = noteIds[index];
    if (!isUuid(noteId))
      return operationIssue(operation, "uuid", "noteId 必须是 UUID。", path);
    if (ids.has(noteId))
      return operationIssue(operation, "duplicate", "noteIds 不能重复。", path);
    if (!scopedNotes.has(noteId))
      return operationIssue(
        operation,
        "reference",
        "noteId 必须存在于当前 scope。",
        path,
      );
    ids.add(noteId);
  }
  scopeResult.notes.forEach((item) => {
    if (ids.has(item.note.id)) {
      addAffectedTrack(affected, item.trackId);
      addAffectedSection(affected, item.sectionId);
      addRemovedNote(affected, item.note.id);
    }
  });
  document.clips.forEach((clip) => {
    clip.notes = clip.notes.filter((note) => !ids.has(note.id));
  });
  return undefined;
}

function applyRemoveNotesInRange(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const argsError = requireExactArgs(operation, [
    "trackId",
    "sectionId",
    "start",
    "end",
    "mode",
    "splitNoteIds",
  ]);
  if (argsError) return argsError;
  const scopeResult = resolveClipScope(document, operation, true);
  if (!scopeResult.ok) return scopeResult.error;
  const clip = scopeResult.clip;
  if (!clip)
    return operationIssue(
      operation,
      "reference",
      "scope 必须引用当前工程中的 clip。",
      "scope",
    );
  const targetError = requireTargetArgs(operation, scopeResult);
  if (targetError) return targetError;
  const { start, end, mode, splitNoteIds } = operation.args;
  if (!isNumberInRange(start, 0, scopeResult.sectionBeats))
    return operationIssue(
      operation,
      "range",
      "start 必须在所在 section 内。",
      "args.start",
    );
  if (!isNumberInRange(end, 0, scopeResult.sectionBeats) || end <= start)
    return operationIssue(
      operation,
      "range",
      "end 必须大于 start 且在所在 section 内。",
      "args.end",
    );
  if (mode !== "trimAndSplit")
    return operationIssue(
      operation,
      "enum",
      "mode 只能是 trimAndSplit。",
      "args.mode",
    );
  if (!isRecord(splitNoteIds))
    return operationIssue(
      operation,
      "type",
      "splitNoteIds 必须是对象。",
      "args.splitNoteIds",
    );

  const crossingIds = clip.notes
    .filter((note) => note.start < start && note.start + note.dur > end)
    .map((note) => note.id);
  const expectedCrossings = new Set(crossingIds);
  const splitKeys = Object.keys(splitNoteIds);
  const unexpectedId = splitKeys.find((id) => !expectedCrossings.has(id));
  if (unexpectedId)
    return operationIssue(
      operation,
      "unknown_key",
      "splitNoteIds 只能包含跨越整个删除范围的 note ID。",
      `args.splitNoteIds.${unexpectedId}`,
    );
  const missingId = crossingIds.find((id) => !(id in splitNoteIds));
  if (missingId)
    return operationIssue(
      operation,
      "required",
      "每个跨越删除范围的 note 都需要新的右半段 ID。",
      `args.splitNoteIds.${missingId}`,
    );
  const occupiedIds = allPersistentIds(document);
  const newIds = new Set<string>();
  for (const originalId of crossingIds) {
    const newId = splitNoteIds[originalId];
    if (!isUuid(newId))
      return operationIssue(
        operation,
        "uuid",
        "splitNoteIds 的值必须是 UUID。",
        `args.splitNoteIds.${originalId}`,
      );
    if (occupiedIds.has(newId) || newIds.has(newId))
      return operationIssue(
        operation,
        "duplicate",
        "split 生成的 note ID 必须在工程内全局唯一。",
        `args.splitNoteIds.${originalId}`,
      );
    newIds.add(newId);
  }

  const nextNotes: Note[] = [];
  for (const note of clip.notes) {
    const noteEnd = note.start + note.dur;
    if (noteEnd <= start || note.start >= end) {
      nextNotes.push(note);
      continue;
    }
    addAffectedTrack(affected, scopeResult.trackId);
    addAffectedSection(affected, scopeResult.sectionId);
    if (note.start >= start && noteEnd <= end) {
      addRemovedNote(affected, note.id);
      continue;
    }
    if (note.start < start && noteEnd <= end) {
      nextNotes.push({ ...note, dur: start - note.start });
      addTrimmedNote(affected, note.id);
      continue;
    }
    if (note.start >= start && noteEnd > end) {
      nextNotes.push({ ...note, start: end, dur: noteEnd - end });
      addTrimmedNote(affected, note.id);
      continue;
    }
    const rightId = splitNoteIds[note.id] as string;
    nextNotes.push({ ...note, dur: start - note.start });
    nextNotes.push({
      ...note,
      id: rightId,
      start: end,
      dur: noteEnd - end,
    });
    addTrimmedNote(affected, note.id);
    addCreatedNote(affected, rightId);
  }
  clip.notes = sortNotes(nextNotes);
  return undefined;
}

function applyAddSection(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, [
    "sectionId",
    "name",
    "bars",
    "afterSectionId",
  ]);
  if (argsError) return argsError;
  const { sectionId, name, bars, afterSectionId } = operation.args;
  if (!isUuid(sectionId))
    return operationIssue(
      operation,
      "uuid",
      "sectionId 必须是 UUID。",
      "args.sectionId",
    );
  if (allPersistentIds(document).has(sectionId))
    return operationIssue(
      operation,
      "duplicate",
      "sectionId 必须在工程内全局唯一。",
      "args.sectionId",
    );
  const nameError = validateName(operation, name, "args.name");
  if (nameError) return nameError;
  if (!isIntegerInRange(bars, 1, 64))
    return operationIssue(
      operation,
      "range",
      "bars 必须是 1–64 的整数。",
      "args.bars",
    );
  let insertionIndex = document.sections.length;
  if (afterSectionId !== null) {
    if (!isUuid(afterSectionId))
      return operationIssue(
        operation,
        "uuid",
        "afterSectionId 必须是 section UUID 或 null。",
        "args.afterSectionId",
      );
    const index = document.sections.findIndex(
      (section) => section.id === afterSectionId,
    );
    if (index === -1)
      return operationIssue(
        operation,
        "reference",
        "afterSectionId 必须引用当前工程中的 section。",
        "args.afterSectionId",
      );
    insertionIndex = index + 1;
  }
  const relativeAutomation = toRelativeAutomation(document);
  const section: Section = { id: sectionId, name: name as string, bars };
  document.sections.splice(insertionIndex, 0, section);
  rebuildAutomation(document, relativeAutomation, affected);
  addAffectedSection(affected, section.id);
  affected.wholeProject = true;
  return undefined;
}

function applyRemoveSection(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const sectionId = sectionIdFromScope(operation.scope);
  if (!sectionId)
    return operationIssue(
      operation,
      "scope",
      "removeSection 只能作用于单个 section。",
      "scope",
    );
  const argsError = requireExactArgs(operation, []);
  if (argsError) return argsError;
  if (!document.sections.some((section) => section.id === sectionId))
    return operationIssue(
      operation,
      "reference",
      "scope.sectionId 必须引用当前工程中的 section。",
      "scope.sectionId",
    );
  if (document.sections.length === 1)
    return operationIssue(
      operation,
      "min_items",
      "工程至少需要保留一个 section。",
      "scope.sectionId",
    );
  const relativeAutomation = toRelativeAutomation(document);
  const removedClips = document.clips.filter(
    (clip) => clip.sectionId === sectionId,
  );
  document.sections = document.sections.filter(
    (section) => section.id !== sectionId,
  );
  document.clips = document.clips.filter(
    (clip) => clip.sectionId !== sectionId,
  );
  removedClips.forEach((clip) => {
    addAffectedTrack(affected, clip.trackId);
    clip.notes.forEach((note) => addRemovedNote(affected, note.id));
  });
  const retainedAutomation = relativeAutomation.map((lane) => ({
    ...lane,
    points: lane.points.filter((point) => {
      const remove = point.sectionId === sectionId;
      if (remove) affected.removedAutomationPoints += 1;
      return !remove;
    }),
  }));
  rebuildAutomation(document, retainedAutomation, affected);
  addAffectedSection(affected, sectionId);
  affected.wholeProject = true;
  return undefined;
}

function applyExtendSection(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const section = resolveSectionScope(document, operation);
  if (!section.ok) return section.error;
  const argsError = requireExactArgs(operation, ["bars"]);
  if (argsError) return argsError;
  const bars = operation.args.bars;
  if (!isIntegerInRange(bars, section.section.bars + 1, 64))
    return operationIssue(
      operation,
      "range",
      "extendSection 的 bars 必须大于当前值且不超过 64。",
      "args.bars",
    );
  const relativeAutomation = toRelativeAutomation(document);
  section.section.bars = bars;
  rebuildAutomation(document, relativeAutomation, affected);
  addAffectedSection(affected, section.section.id);
  affected.wholeProject = true;
  return undefined;
}

function applyShrinkSection(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const section = resolveSectionScope(document, operation);
  if (!section.ok) return section.error;
  const argsError = requireExactArgs(operation, ["bars", "overflow"]);
  if (argsError) return argsError;
  const { bars, overflow } = operation.args;
  if (!isIntegerInRange(bars, 1, section.section.bars - 1))
    return operationIssue(
      operation,
      "range",
      "shrinkSection 的 bars 必须小于当前值且至少为 1。",
      "args.bars",
    );
  if (overflow !== "trim")
    return operationIssue(
      operation,
      "enum",
      "overflow 只能是 trim。",
      "args.overflow",
    );
  const nextBeats = bars * 4;
  const relativeAutomation = toRelativeAutomation(document);
  document.clips
    .filter((clip) => clip.sectionId === section.section.id)
    .forEach((clip) => {
      const notes: Note[] = [];
      clip.notes.forEach((note) => {
        if (note.start >= nextBeats) {
          addRemovedNote(affected, note.id);
          return;
        }
        if (note.start + note.dur > nextBeats) {
          notes.push({ ...note, dur: nextBeats - note.start });
          addTrimmedNote(affected, note.id);
          return;
        }
        notes.push(note);
      });
      clip.notes = notes;
      addAffectedTrack(affected, clip.trackId);
    });
  const retainedAutomation = relativeAutomation.map((lane) => ({
    ...lane,
    points: lane.points.filter((point) => {
      const remove =
        point.sectionId === section.section.id &&
        point.relativeBeat > nextBeats;
      if (remove) affected.removedAutomationPoints += 1;
      return !remove;
    }),
  }));
  section.section.bars = bars;
  rebuildAutomation(document, retainedAutomation, affected);
  addAffectedSection(affected, section.section.id);
  affected.wholeProject = true;
  return undefined;
}

function applyReorderSections(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, ["sectionIds"]);
  if (argsError) return argsError;
  const sectionIds = operation.args.sectionIds;
  if (
    !Array.isArray(sectionIds) ||
    sectionIds.length !== document.sections.length
  )
    return operationIssue(
      operation,
      "length",
      "sectionIds 必须完整列出每个 section 一次。",
      "args.sectionIds",
    );
  if (sectionIds.some((id) => !isUuid(id)))
    return operationIssue(
      operation,
      "uuid",
      "sectionIds 必须全部为 UUID。",
      "args.sectionIds",
    );
  const currentIds = new Set(document.sections.map((section) => section.id));
  const incomingIds = new Set(sectionIds);
  if (
    incomingIds.size !== sectionIds.length ||
    [...incomingIds].some((id) => !currentIds.has(id))
  )
    return operationIssue(
      operation,
      "reference",
      "sectionIds 必须是当前 section ID 的无重复排列。",
      "args.sectionIds",
    );
  const relativeAutomation = toRelativeAutomation(document);
  document.sections = sectionIds.map((id) =>
    document.sections.find((section) => section.id === id)!,
  );
  rebuildAutomation(document, relativeAutomation, affected);
  sectionIds.forEach((id) => addAffectedSection(affected, id));
  affected.wholeProject = true;
  return undefined;
}

function applyUpsertAutomationPoints(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const trackId = trackIdFromScope(operation.scope);
  if (!trackId)
    return operationIssue(
      operation,
      "scope",
      "automation 原语只能作用于单条 track。",
      "scope",
    );
  const argsError = requireExactArgs(operation, ["param", "points"]);
  if (argsError) return argsError;
  if (!document.tracks.some((track) => track.id === trackId))
    return operationIssue(
      operation,
      "reference",
      "scope.trackId 必须引用当前工程中的 track。",
      "scope.trackId",
    );
  const param = operation.args.param;
  if (param !== "volume" && param !== "filterCutoff")
    return operationIssue(
      operation,
      "enum",
      "param 必须是 volume 或 filterCutoff。",
      "args.param",
    );
  const points = parseAutomationPoints(
    document,
    operation,
    operation.args.points,
  );
  if (!points.ok) return points.error;
  let lane = document.automation.find(
    (item) => item.trackId === trackId && item.param === param,
  );
  if (!lane) {
    lane = { trackId, param, points: [] };
    document.automation.push(lane);
  }
  const pointsByBeat = new Map(
    lane.points.map((point) => [point.at, point.val]),
  );
  points.points.forEach((point) => {
    if (pointsByBeat.has(point.at)) affected.mergedAutomationPoints += 1;
    pointsByBeat.set(point.at, point.val);
  });
  lane.points = [...pointsByBeat.entries()]
    .sort(([first], [second]) => first - second)
    .map(([at, val]) => ({ at, val }));
  addAffectedTrack(affected, trackId);
  return undefined;
}

function applyRemoveAutomationPoints(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const trackId = trackIdFromScope(operation.scope);
  if (!trackId)
    return operationIssue(
      operation,
      "scope",
      "automation 原语只能作用于单条 track。",
      "scope",
    );
  const argsError = requireExactArgs(operation, ["param", "ats"]);
  if (argsError) return argsError;
  const param = operation.args.param;
  if (param !== "volume" && param !== "filterCutoff")
    return operationIssue(
      operation,
      "enum",
      "param 必须是 volume 或 filterCutoff。",
      "args.param",
    );
  const ats = operation.args.ats;
  if (!Array.isArray(ats) || ats.length === 0)
    return operationIssue(
      operation,
      "min_items",
      "ats 必须是至少包含一个全局 beat 的数组。",
      "args.ats",
    );
  const lane = document.automation.find(
    (item) => item.trackId === trackId && item.param === param,
  );
  if (!lane)
    return operationIssue(
      operation,
      "reference",
      "目标 track/param 没有 automation lane。",
      "args.param",
    );
  const knownAts = new Set(lane.points.map((point) => point.at));
  const removalAts = new Set<number>();
  const projectBeats = document.sections.reduce(
    (sum, section) => sum + section.bars * 4,
    0,
  );
  for (let index = 0; index < ats.length; index += 1) {
    const at = ats[index];
    const path = `args.ats[${index}]`;
    if (!isNumberInRange(at, 0, projectBeats))
      return operationIssue(
        operation,
        "range",
        "automation at 必须在工程全局 beat 范围内。",
        path,
      );
    if (removalAts.has(at))
      return operationIssue(operation, "duplicate", "ats 不能重复。", path);
    if (!knownAts.has(at))
      return operationIssue(
        operation,
        "reference",
        "每个 at 都必须存在于目标 lane。",
        path,
      );
    removalAts.add(at);
  }
  lane.points = lane.points.filter((point) => !removalAts.has(point.at));
  affected.removedAutomationPoints += removalAts.size;
  addAffectedTrack(affected, trackId);
  return undefined;
}

type AutomationPointsResult =
  | { ok: true; points: Array<{ at: number; val: number }> }
  | { ok: false; error: OperationIssue };

function parseAutomationPoints(
  document: ProjectDocument,
  operation: Operation,
  value: unknown,
): AutomationPointsResult {
  if (!Array.isArray(value) || value.length === 0)
    return {
      ok: false,
      error: operationIssue(
        operation,
        "min_items",
        "points 必须是至少包含一项的数组。",
        "args.points",
      ),
    };
  const projectBeats = document.sections.reduce(
    (sum, section) => sum + section.bars * 4,
    0,
  );
  const points: Array<{ at: number; val: number }> = [];
  for (let index = 0; index < value.length; index += 1) {
    const path = `args.points[${index}]`;
    const point = value[index];
    if (!isRecord(point))
      return {
        ok: false,
        error: operationIssue(operation, "type", "point 必须是对象。", path),
      };
    const unknownKey = Object.keys(point).find(
      (key) => key !== "at" && key !== "val",
    );
    if (unknownKey)
      return {
        ok: false,
        error: operationIssue(
          operation,
          "unknown_key",
          "automation point 不允许未知字段。",
          `${path}.${unknownKey}`,
        ),
      };
    if (!isNumberInRange(point.at, 0, projectBeats))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "automation at 必须在工程全局 beat 范围内。",
          `${path}.at`,
        ),
      };
    if (!isNumberInRange(point.val, 0, 1))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "automation val 必须在 0–1。",
          `${path}.val`,
        ),
      };
    points.push({ at: point.at, val: point.val });
  }
  return { ok: true, points };
}

function applyAddTrack(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const scopeError = requireWholeScope(operation);
  if (scopeError) return scopeError;
  const argsError = requireExactArgs(operation, [
    "trackId",
    "name",
    "role",
    "instrument",
    "volume",
  ]);
  if (argsError) return argsError;
  const { trackId, name, role, instrument, volume } = operation.args;
  if (!isUuid(trackId))
    return operationIssue(
      operation,
      "uuid",
      "trackId 必须是 UUID。",
      "args.trackId",
    );
  if (allPersistentIds(document).has(trackId))
    return operationIssue(
      operation,
      "duplicate",
      "trackId 必须在工程内全局唯一。",
      "args.trackId",
    );
  if (
    typeof name !== "string" ||
    name.length < 1 ||
    name.length > 100 ||
    name.trim().length === 0
  )
    return operationIssue(
      operation,
      "string",
      "name 必须是 1–100 个非空字符。",
      "args.name",
    );
  if (typeof role !== "string" || !trackRoles.has(role as TrackRole))
    return operationIssue(
      operation,
      "enum",
      "role 必须是受支持的轨道角色。",
      "args.role",
    );
  if (!isNumberInRange(volume, 0, 1))
    return operationIssue(
      operation,
      "range",
      "volume 必须是 0–1 的有限数字。",
      "args.volume",
    );
  const instrumentError = validateInstrumentForRole(
    document,
    operation,
    role as TrackRole,
    instrument,
    "args.instrument",
  );
  if (instrumentError) return instrumentError;
  const track: Track = {
    id: trackId,
    name,
    role: role as TrackRole,
    instrument: instrument as string,
    vol: volume,
    mute: false,
    solo: false,
  };
  document.tracks.push(track);
  addAffectedTrack(affected, track.id);
  return undefined;
}

function applyRemoveTrack(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const trackId = trackIdFromScope(operation.scope);
  if (!trackId)
    return operationIssue(
      operation,
      "scope",
      "removeTrack 只能作用于单条 track。",
      "scope",
    );
  const argsError = requireExactArgs(operation, []);
  if (argsError) return argsError;
  if (!document.tracks.some((track) => track.id === trackId))
    return operationIssue(
      operation,
      "reference",
      "scope.trackId 必须引用当前工程中的 track。",
      "scope.trackId",
    );
  if (document.tracks.length === 1)
    return operationIssue(
      operation,
      "min_items",
      "工程至少需要保留一条 track。",
      "scope.trackId",
    );
  const removedClips = document.clips.filter(
    (clip) => clip.trackId === trackId,
  );
  document.tracks = document.tracks.filter((track) => track.id !== trackId);
  document.clips = document.clips.filter((clip) => clip.trackId !== trackId);
  document.automation = document.automation.filter(
    (lane) => lane.trackId !== trackId,
  );
  removedClips.forEach((clip) =>
    clip.notes.forEach((note) => addRemovedNote(affected, note.id)),
  );
  addAffectedTrack(affected, trackId);
  return undefined;
}

function applySetInstrument(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
): OperationIssue | undefined {
  const trackId = trackIdFromScope(operation.scope);
  if (!trackId)
    return operationIssue(
      operation,
      "scope",
      "setInstrument 只能作用于单条 track。",
      "scope",
    );
  const argsError = requireExactArgs(operation, ["instrument"]);
  if (argsError) return argsError;
  const track = document.tracks.find((item) => item.id === trackId);
  if (!track)
    return operationIssue(
      operation,
      "reference",
      "scope.trackId 必须引用当前工程中的 track。",
      "scope.trackId",
    );
  const instrumentError = validateInstrumentForRole(
    document,
    operation,
    track.role,
    operation.args.instrument,
    "args.instrument",
  );
  if (instrumentError) return instrumentError;
  track.instrument = operation.args.instrument as string;
  addAffectedTrack(affected, track.id);
  return undefined;
}

function validateInstrumentForRole(
  document: ProjectDocument,
  operation: Operation,
  role: TrackRole,
  instrumentId: unknown,
  path: string,
): OperationIssue | undefined {
  if (typeof instrumentId !== "string" || instrumentId.trim().length === 0)
    return operationIssue(
      operation,
      "string",
      "instrument 必须是非空注册表 ID。",
      path,
    );
  const instrument = resolveInstrument(
    document.meta.instrumentRegistryVersion,
    instrumentId,
  );
  if (!instrument)
    return operationIssue(
      operation,
      "instrument_missing",
      "当前注册表版本中找不到该 instrument。",
      path,
    );
  if (!isInstrumentCompatible(role, instrument))
    return operationIssue(
      operation,
      "instrument_role",
      "instrument 与 track role 或 MIDI channel 不兼容。",
      path,
    );
  if (!isInstrumentPlaybackAvailable(instrument.id))
    return operationIssue(
      operation,
      "instrument_unavailable",
      "instrument 尚未附带通过校验的真实采样，不能写入工程。",
      path,
    );
  return undefined;
}

function applyTrackProperty(
  document: ProjectDocument,
  operation: Operation,
  affected: AffectedObjects,
  property: "vol" | "mute" | "solo",
  argName: "volume" | "value",
): OperationIssue | undefined {
  const trackId = trackIdFromScope(operation.scope);
  if (!trackId)
    return operationIssue(
      operation,
      "scope",
      "该混音原语只能作用于单条 track。",
      "scope",
    );
  const argsError = requireExactArgs(operation, [argName]);
  if (argsError) return argsError;
  const value = operation.args[argName];
  if (property === "vol" && !isNumberInRange(value, 0, 1))
    return operationIssue(
      operation,
      "range",
      "volume 必须是 0–1 的有限数字。",
      `args.${argName}`,
    );
  if (property !== "vol" && typeof value !== "boolean")
    return operationIssue(
      operation,
      "type",
      "mute/solo 的 value 必须是布尔值。",
      `args.${argName}`,
    );
  const track = document.tracks.find((item) => item.id === trackId);
  if (!track)
    return operationIssue(
      operation,
      "reference",
      "scope.trackId 必须引用当前工程中的 track。",
      "scope.trackId",
    );
  if (property === "vol") track.vol = value as number;
  else track[property] = value as boolean;
  affected.trackIds.push(track.id);
  return undefined;
}

function createAffectedObjects(): AffectedObjects {
  return {
    wholeProject: false,
    trackIds: [],
    sectionIds: [],
    createdNoteIds: [],
    trimmedNoteIds: [],
    removedNoteIds: [],
    removedAutomationPoints: 0,
    mergedAutomationPoints: 0,
  };
}

type SectionScopeResolution =
  { ok: true; section: Section } | { ok: false; error: OperationIssue };

type SectionPosition = { id: string; start: number; beats: number };

type RelativeAutomationLane = {
  trackId: string;
  param: AutomationLane["param"];
  points: Array<{
    sectionId: string;
    relativeBeat: number;
    val: number;
    order: number;
  }>;
};

function resolveSectionScope(
  document: ProjectDocument,
  operation: Operation,
): SectionScopeResolution {
  const sectionId = sectionIdFromScope(operation.scope);
  if (!sectionId)
    return {
      ok: false,
      error: operationIssue(
        operation,
        "scope",
        "该原语只能作用于单个 section。",
        "scope",
      ),
    };
  const section = document.sections.find((item) => item.id === sectionId);
  if (!section)
    return {
      ok: false,
      error: operationIssue(
        operation,
        "reference",
        "scope.sectionId 必须引用当前工程中的 section。",
        "scope.sectionId",
      ),
    };
  return { ok: true, section };
}

function sectionIdFromScope(scope: Scope): string | undefined {
  return scope.kind === "section" ? scope.sectionId : undefined;
}

function validateName(
  operation: Operation,
  value: unknown,
  path: string,
): OperationIssue | undefined {
  if (
    typeof value !== "string" ||
    value.length < 1 ||
    value.length > 100 ||
    value.trim().length === 0
  )
    return operationIssue(
      operation,
      "string",
      "name 必须是 1–100 个非空字符。",
      path,
    );
  return undefined;
}

function toRelativeAutomation(
  document: ProjectDocument,
): RelativeAutomationLane[] {
  const layout = sectionLayout(document.sections);
  return document.automation.map((lane) => ({
    trackId: lane.trackId,
    param: lane.param,
    points: lane.points.map((point, order) => {
      const position = positionForBeat(layout, point.at)!;
      return {
        sectionId: position.id,
        relativeBeat: point.at - position.start,
        val: point.val,
        order,
      };
    }),
  }));
}

function rebuildAutomation(
  document: ProjectDocument,
  lanes: RelativeAutomationLane[],
  affected: AffectedObjects,
): void {
  const layout = sectionLayout(document.sections);
  const positions = new Map(layout.map((position) => [position.id, position]));
  document.automation = lanes.map((lane) => {
    const pointsByBeat = new Map<number, { val: number; order: number }>();
    lane.points.forEach((point) => {
      const position = positions.get(point.sectionId);
      if (
        !position ||
        point.relativeBeat < 0 ||
        point.relativeBeat > position.beats
      )
        return;
      const at = normalizeBeat(position.start + point.relativeBeat);
      if (pointsByBeat.has(at)) affected.mergedAutomationPoints += 1;
      pointsByBeat.set(at, { val: point.val, order: point.order });
    });
    return {
      trackId: lane.trackId,
      param: lane.param,
      points: [...pointsByBeat.entries()]
        .sort(([first], [second]) => first - second)
        .map(([at, point]) => ({ at, val: point.val })),
    };
  });
}

function sectionLayout(sections: Section[]): SectionPosition[] {
  let start = 0;
  return sections.map((section) => {
    const position = { id: section.id, start, beats: section.bars * 4 };
    start += position.beats;
    return position;
  });
}

function positionForBeat(
  layout: SectionPosition[],
  beat: number,
): SectionPosition | undefined {
  return layout.find(
    (position, index) =>
      beat >= position.start &&
      (beat < position.start + position.beats ||
        (index === layout.length - 1 &&
          beat === position.start + position.beats)),
  );
}

type ClipScopeResolution =
  | {
      ok: true;
      trackId: string;
      sectionId: string;
      sectionBeats: number;
      clip?: Clip;
    }
  | { ok: false; error: OperationIssue };

type NewNotesResult =
  { ok: true; notes: Note[] } | { ok: false; error: OperationIssue };

function resolveClipScope(
  document: ProjectDocument,
  operation: Operation,
  requireExisting: boolean,
): ClipScopeResolution {
  if (operation.scope.kind !== "clip")
    return {
      ok: false,
      error: operationIssue(
        operation,
        "scope",
        "该原语只能作用于单个 clip。",
        "scope",
      ),
    };
  const { trackId, sectionId } = operation.scope;
  if (!document.tracks.some((track) => track.id === trackId))
    return missingClipScopeReference(operation, "scope.trackId");
  const section = document.sections.find((item) => item.id === sectionId);
  if (!section) return missingClipScopeReference(operation, "scope.sectionId");
  const clip = document.clips.find(
    (item) => item.trackId === trackId && item.sectionId === sectionId,
  );
  if (requireExisting && !clip)
    return missingClipScopeReference(operation, "scope");
  return {
    ok: true,
    trackId,
    sectionId,
    sectionBeats: section.bars * 4,
    ...(clip ? { clip } : {}),
  };
}

function missingClipScopeReference(
  operation: Operation,
  field: string,
): ClipScopeResolution {
  return {
    ok: false,
    error: operationIssue(
      operation,
      "reference",
      "scope 必须引用当前工程中的对象。",
      field,
    ),
  };
}

function requireTargetArgs(
  operation: Operation,
  target: Extract<ClipScopeResolution, { ok: true }>,
): OperationIssue | undefined {
  if (operation.args.trackId !== target.trackId)
    return operationIssue(
      operation,
      "scope_mismatch",
      "args.trackId 必须与 clip scope 相同。",
      "args.trackId",
    );
  if (operation.args.sectionId !== target.sectionId)
    return operationIssue(
      operation,
      "scope_mismatch",
      "args.sectionId 必须与 clip scope 相同。",
      "args.sectionId",
    );
  return undefined;
}

function parseNewNotes(
  document: ProjectDocument,
  operation: Operation,
  value: unknown,
  path: string,
  sectionBeats: number,
): NewNotesResult {
  if (!Array.isArray(value))
    return {
      ok: false,
      error: operationIssue(operation, "type", "notes 必须是数组。", path),
    };
  const occupiedIds = allPersistentIds(document);
  const incomingIds = new Set<string>();
  const notes: Note[] = [];
  for (let index = 0; index < value.length; index += 1) {
    const notePath = `${path}[${index}]`;
    const item = value[index];
    if (!isRecord(item))
      return {
        ok: false,
        error: operationIssue(operation, "type", "note 必须是对象。", notePath),
      };
    const allowedKeys = ["id", "start", "dur", "pitch", "vel"];
    const unknownKey = Object.keys(item).find(
      (key) => !allowedKeys.includes(key),
    );
    if (unknownKey)
      return {
        ok: false,
        error: operationIssue(
          operation,
          "unknown_key",
          "note 不允许未知字段。",
          `${notePath}.${unknownKey}`,
        ),
      };
    if (!isUuid(item.id))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "uuid",
          "note.id 必须是 UUID。",
          `${notePath}.id`,
        ),
      };
    if (occupiedIds.has(item.id) || incomingIds.has(item.id))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "duplicate",
          "新的 note ID 必须在工程内全局唯一。",
          `${notePath}.id`,
        ),
      };
    if (!isNumberInRange(item.start, 0, sectionBeats))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "note.start 必须在所在 section 内。",
          `${notePath}.start`,
        ),
      };
    if (
      typeof item.dur !== "number" ||
      !Number.isFinite(item.dur) ||
      item.dur <= 0
    )
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "note.dur 必须大于 0。",
          `${notePath}.dur`,
        ),
      };
    if (item.start + item.dur > sectionBeats)
      return {
        ok: false,
        error: operationIssue(
          operation,
          "section_boundary",
          "note 不能超出所在 section。",
          notePath,
        ),
      };
    if (!isIntegerInRange(item.pitch, 0, 127))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "note.pitch 必须是 0–127 的整数。",
          `${notePath}.pitch`,
        ),
      };
    if (!isIntegerInRange(item.vel, 1, 127))
      return {
        ok: false,
        error: operationIssue(
          operation,
          "range",
          "note.vel 必须是 1–127 的整数。",
          `${notePath}.vel`,
        ),
      };
    incomingIds.add(item.id);
    notes.push({
      id: item.id,
      start: item.start,
      dur: item.dur,
      pitch: item.pitch,
      vel: item.vel,
    });
  }
  return { ok: true, notes: sortNotes(notes) };
}

function allPersistentIds(document: ProjectDocument): Set<string> {
  return new Set([
    document.id,
    ...document.sections.map((section) => section.id),
    ...document.tracks.map((track) => track.id),
    ...document.clips.flatMap((clip) => [
      clip.id,
      ...clip.notes.map((note) => note.id),
    ]),
  ]);
}

function sortNotes(notes: Note[]): Note[] {
  return notes.sort(
    (a, b) => a.start - b.start || a.pitch - b.pitch || a.dur - b.dur,
  );
}

type ScopedNote = {
  note: Note;
  role: ProjectDocument["tracks"][number]["role"];
  trackId: string;
  sectionId: string;
  sectionBeats: number;
};

type ScopeResolution =
  { ok: true; notes: ScopedNote[] } | { ok: false; error: OperationIssue };

function resolveNotesInScope(
  document: ProjectDocument,
  operation: Operation,
): ScopeResolution {
  const { scope } = operation;
  if (scope.kind === "whole")
    return {
      ok: true,
      notes: document.clips.flatMap((clip) => notesForClip(document, clip)),
    };
  if (scope.kind === "section") {
    if (!document.sections.some((section) => section.id === scope.sectionId))
      return missingScopeReference(operation, "scope.sectionId");
    return {
      ok: true,
      notes: document.clips
        .filter((clip) => clip.sectionId === scope.sectionId)
        .flatMap((clip) => notesForClip(document, clip)),
    };
  }
  if (scope.kind === "track") {
    if (!document.tracks.some((track) => track.id === scope.trackId))
      return missingScopeReference(operation, "scope.trackId");
    return {
      ok: true,
      notes: document.clips
        .filter((clip) => clip.trackId === scope.trackId)
        .flatMap((clip) => notesForClip(document, clip)),
    };
  }
  const clip = document.clips.find(
    (item) =>
      item.trackId === scope.trackId && item.sectionId === scope.sectionId,
  );
  if (!clip) return missingScopeReference(operation, "scope");
  return { ok: true, notes: notesForClip(document, clip) };
}

function notesForClip(
  document: ProjectDocument,
  clip: ProjectDocument["clips"][number],
): ScopedNote[] {
  const track = document.tracks.find((item) => item.id === clip.trackId);
  const section = document.sections.find((item) => item.id === clip.sectionId);
  if (!track || !section) return [];
  return clip.notes.map((note) => ({
    note,
    role: track.role,
    trackId: track.id,
    sectionId: clip.sectionId,
    sectionBeats: section.bars * 4,
  }));
}

function missingScopeReference(
  operation: Operation,
  field: string,
): ScopeResolution {
  return {
    ok: false,
    error: operationIssue(
      operation,
      "reference",
      "scope 必须引用当前工程中的对象。",
      field,
    ),
  };
}

function addAffectedTrack(affected: AffectedObjects, trackId: string): void {
  if (!affected.trackIds.includes(trackId)) affected.trackIds.push(trackId);
}

function addAffectedSection(
  affected: AffectedObjects,
  sectionId: string,
): void {
  if (!affected.sectionIds.includes(sectionId))
    affected.sectionIds.push(sectionId);
}

function addCreatedNote(affected: AffectedObjects, noteId: string): void {
  if (!affected.createdNoteIds.includes(noteId))
    affected.createdNoteIds.push(noteId);
}

function addTrimmedNote(affected: AffectedObjects, noteId: string): void {
  if (!affected.trimmedNoteIds.includes(noteId))
    affected.trimmedNoteIds.push(noteId);
}

function addRemovedNote(affected: AffectedObjects, noteId: string): void {
  if (!affected.removedNoteIds.includes(noteId))
    affected.removedNoteIds.push(noteId);
}

function quantizeBeat(value: number, grid: 0.25 | 0.5 | 1): number {
  return Number((Math.round(value / grid) * grid).toFixed(6));
}

function normalizeBeat(value: number): number {
  return Number(value.toFixed(6));
}

function createSeededRandom(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4_294_967_296;
  };
}

function randomSigned(random: () => number): number {
  return random() * 2 - 1;
}

function sortAffectedClips(document: ProjectDocument, scope: Scope): void {
  document.clips
    .filter((clip) => clipMatchesScope(clip, scope))
    .forEach((clip) =>
      clip.notes.sort(
        (a, b) => a.start - b.start || a.pitch - b.pitch || a.dur - b.dur,
      ),
    );
}

function clipMatchesScope(
  clip: ProjectDocument["clips"][number],
  scope: Scope,
): boolean {
  if (scope.kind === "whole") return true;
  if (scope.kind === "section") return clip.sectionId === scope.sectionId;
  if (scope.kind === "track") return clip.trackId === scope.trackId;
  return clip.trackId === scope.trackId && clip.sectionId === scope.sectionId;
}

function requireWholeScope(operation: Operation): OperationIssue | undefined {
  if (operation.scope.kind === "whole") return undefined;
  return operationIssue(
    operation,
    "scope",
    "该工程级原语只能使用 whole scope。",
    "scope",
  );
}

function trackIdFromScope(scope: Scope): string | undefined {
  return scope.kind === "track" ? scope.trackId : undefined;
}

function requireExactArgs(
  operation: Operation,
  allowed: string[],
): OperationIssue | undefined {
  const keys = Object.keys(operation.args);
  const unexpected = keys.find((key) => !allowed.includes(key));
  if (unexpected)
    return operationIssue(
      operation,
      "unknown_key",
      "不允许未列出的原语参数。",
      `args.${unexpected}`,
    );
  const missing = allowed.find((key) => !(key in operation.args));
  if (missing)
    return operationIssue(
      operation,
      "required",
      "缺少原语必填参数。",
      `args.${missing}`,
    );
  return undefined;
}

function operationIssue(
  operation: Operation,
  code: string,
  message: string,
  field: string,
): OperationIssue {
  return {
    operationId: operation.id,
    path: `$.operations.${operation.id}.${field}`,
    code,
    message,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isUuid(value: unknown): value is string {
  return typeof value === "string" && uuidPattern.test(value);
}

function isNumberInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return (
    typeof value === "number" &&
    Number.isFinite(value) &&
    value >= min &&
    value <= max
  );
}

function isIntegerInRange(
  value: unknown,
  min: number,
  max: number,
): value is number {
  return Number.isInteger(value) && isNumberInRange(value, min, max);
}
