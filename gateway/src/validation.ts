import { GatewayError } from "./errors.js";
import type {
  ExternalModelProvider,
  GenerateNotesRequest,
  GenerationScope,
  NoteProposal,
  ScopeNote,
} from "./types.js";

const roles = new Set(["drums", "bass", "harmony", "lead", "pad", "fx"]);
const strategies = new Set(["replace", "overdub"]);
const keys = new Set([
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
const modes = new Set(["major", "minor"]);
const maxContextNotes = 120;
const maxGeneratedNotes = 64;

export function validateGenerateNotesRequest(
  raw: unknown,
  maxPromptChars: number,
): GenerateNotesRequest {
  const object = requireObject(raw, "请求体必须是对象。");
  const provider = validateProvider(object.provider);
  const prompt = requireString(
    object.prompt,
    "prompt",
    1,
    maxPromptChars,
  ).trim();
  if (!prompt) throw invalid("prompt 不能为空。");
  const strategy = requireString(object.strategy, "strategy", 1, 16);
  if (!strategies.has(strategy))
    throw invalid("strategy 必须为 replace 或 overdub。");
  const scope = validateScope(object.scope);
  const rawContextNotes = object.contextNotes ?? [];
  if (
    !Array.isArray(rawContextNotes) ||
    rawContextNotes.length > maxContextNotes
  ) {
    throw invalid(`contextNotes 最多包含 ${maxContextNotes} 个音符。`);
  }
  const contextNotes = rawContextNotes.map((note, index) =>
    validateNote(note, scope.sectionBeats, `contextNotes[${index}]`),
  );
  return {
    ...(provider ? { provider } : {}),
    prompt,
    strategy: strategy as GenerateNotesRequest["strategy"],
    scope,
    contextNotes,
  };
}

function validateProvider(value: unknown): ExternalModelProvider | undefined {
  if (value === undefined) return undefined;
  if (value === "openai" || value === "gemini") return value;
  throw invalid("provider 必须为 openai 或 gemini。");
}

export function validateModelProposal(
  raw: unknown,
  sectionBeats: number,
): NoteProposal {
  const object = requireObject(raw, "模型返回的候选不是对象。");
  const summary = requireString(object.summary, "summary", 1, 300).trim();
  if (!summary) throw invalid("模型返回的 summary 为空。");
  if (!Array.isArray(object.notes) || object.notes.length > maxGeneratedNotes) {
    throw invalid(`模型最多只能返回 ${maxGeneratedNotes} 个音符。`);
  }
  const notes = object.notes.map((note, index) =>
    validateNote(note, sectionBeats, `notes[${index}]`),
  );
  return { summary, notes };
}

function validateScope(raw: unknown): GenerationScope {
  const object = requireObject(raw, "scope 必须是对象。");
  const trackId = requireIdentifier(object.trackId, "scope.trackId");
  const sectionId = requireIdentifier(object.sectionId, "scope.sectionId");
  const sectionBeats = requireNumber(
    object.sectionBeats,
    "scope.sectionBeats",
    1,
    512,
  );
  const role = requireString(object.role, "scope.role", 1, 16);
  const tempo = requireNumber(object.tempo, "scope.tempo", 40, 240);
  const key = requireString(object.key, "scope.key", 1, 2);
  const mode = requireString(object.mode, "scope.mode", 1, 8);
  if (!roles.has(role)) throw invalid("scope.role 无效。");
  if (!keys.has(key)) throw invalid("scope.key 无效。");
  if (!modes.has(mode)) throw invalid("scope.mode 无效。");
  return {
    trackId,
    sectionId,
    sectionBeats,
    role: role as GenerationScope["role"],
    tempo,
    key,
    mode: mode as GenerationScope["mode"],
  };
}

function validateNote(
  raw: unknown,
  sectionBeats: number,
  path: string,
): ScopeNote {
  const object = requireObject(raw, `${path} 必须是对象。`);
  const start = requireNumber(
    object.start,
    `${path}.start`,
    0,
    sectionBeats - 0.0625,
  );
  const dur = requireNumber(object.dur, `${path}.dur`, 0.0625, sectionBeats);
  const pitch = requireInteger(object.pitch, `${path}.pitch`, 0, 127);
  const vel = requireInteger(object.vel, `${path}.vel`, 1, 127);
  if (start + dur > sectionBeats + Number.EPSILON) {
    throw invalid(`${path} 超出当前 section 范围。`);
  }
  return { start, dur, pitch, vel };
}

function requireObject(raw: unknown, message: string): Record<string, unknown> {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw))
    throw invalid(message);
  return raw as Record<string, unknown>;
}

function requireString(
  value: unknown,
  path: string,
  minLength: number,
  maxLength: number,
): string {
  if (
    typeof value !== "string" ||
    value.length < minLength ||
    value.length > maxLength
  ) {
    throw invalid(`${path} 必须是 ${minLength}–${maxLength} 个字符。`);
  }
  return value;
}

function requireIdentifier(value: unknown, path: string): string {
  const identifier = requireString(value, path, 1, 128);
  if (!/^[A-Za-z0-9_-]+$/.test(identifier)) throw invalid(`${path} 格式无效。`);
  return identifier;
}

function requireNumber(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    value < min ||
    value > max
  ) {
    throw invalid(`${path} 必须是 ${min}–${max} 的有限数字。`);
  }
  return value;
}

function requireInteger(
  value: unknown,
  path: string,
  min: number,
  max: number,
): number {
  const result = requireNumber(value, path, min, max);
  if (!Number.isInteger(result)) throw invalid(`${path} 必须是整数。`);
  return result;
}

function invalid(message: string): GatewayError {
  return new GatewayError(400, "invalid_request", message);
}
