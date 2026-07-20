import { open } from "@tauri-apps/plugin-dialog";
import { readFile } from "@tauri-apps/plugin-fs";
import { assertDesktopRuntime } from "../lifecycle/tauriRuntime";
import type { AudioSeed, AudioSeedAnalysis, SeedPurpose } from "./types";

const supportedExtensions = ["wav", "mp3", "m4a", "aiff", "aif"];
const maxAudioSeedCount = 3;
const maxAudioSeedBytes = 40 * 1024 * 1024;
export const maxSelectedAudioSeedSeconds = 45;
export const defaultSelectedAudioSeedSeconds = 30;

/**
 * A source selected from the Mac file picker. It intentionally lives only in
 * component memory until the user confirms the visible timeline selection.
 * This prevents the full source recording, its path and decoded PCM from
 * entering the journey state or an AI request.
 */
export interface PendingAudioSeed {
  id: string;
  fileName: string;
  localPath: string;
  byteLength: number;
  contentHash: string;
  buffer: AudioBuffer;
  startSeconds: number;
  endSeconds: number;
}

export async function chooseAudioSeedCandidates(
  existingCount: number,
): Promise<PendingAudioSeed[]> {
  assertDesktopRuntime();
  if (existingCount >= maxAudioSeedCount) {
    throw new Error("每个创作任务最多保留 3 个音频参考。请先删除一个参考。 ");
  }
  const selected = await open({
    multiple: true,
    filters: [{ name: "音频参考", extensions: supportedExtensions }],
  });
  const paths = selected
    ? Array.isArray(selected)
      ? selected
      : [selected]
    : [];
  const available = paths.slice(0, maxAudioSeedCount - existingCount);
  const candidates: PendingAudioSeed[] = [];
  for (const path of available) {
    const bytes = await readFile(path);
    if (bytes.byteLength > maxAudioSeedBytes) {
      throw new Error(`${fileName(path)} 超过 40 MB，无法作为参考导入。`);
    }
    const buffer = await decodeAudioSeed(bytes, fileName(path));
    candidates.push({
      id: crypto.randomUUID(),
      fileName: fileName(path),
      localPath: path,
      byteLength: bytes.byteLength,
      contentHash: hashBytes(bytes),
      buffer,
      startSeconds: 0,
      endSeconds: Math.min(buffer.duration, defaultSelectedAudioSeedSeconds),
    });
  }
  return candidates;
}

/**
 * Decodes locally in the desktop WebView. It deliberately does not impose a
 * source-duration limit: a user can select a useful short timeline from a
 * longer recording before importing it into the creative brief.
 */
export async function decodeAudioSeed(
  bytes: Uint8Array,
  fileNameForMessage: string,
): Promise<AudioBuffer> {
  if (typeof AudioContext === "undefined") {
    throw new Error("当前环境无法在本机解析音频参考。请在桌面应用中重试。");
  }
  const context = new AudioContext();
  try {
    // Make an owned ArrayBuffer: Web Audio intentionally does not accept a
    // SharedArrayBuffer, while Tauri's file bridge may expose an ArrayBufferLike.
    const copy = new Uint8Array(bytes).buffer;
    return await context.decodeAudioData(copy);
  } catch {
    throw new Error(
      `${fileNameForMessage} 无法解析。请使用 WAV、MP3、M4A 或 AIFF。`,
    );
  } finally {
    await context.close();
  }
}

/**
 * Converts a confirmed in-memory timeline selection into the compact seed
 * stored by the journey. Only the selected range is summarized; source PCM is
 * discarded by the caller immediately after this returns.
 */
export function createAudioSeedFromCandidate(
  candidate: PendingAudioSeed,
): AudioSeed {
  const range = normalizeAudioSeedRange(
    candidate.buffer.duration,
    candidate.startSeconds,
    candidate.endSeconds,
  );
  const analysis = summarizeAudioRange(
    candidate.buffer,
    range.startSeconds,
    range.endSeconds,
    candidate.fileName,
  );
  return {
    id: candidate.id,
    fileName: candidate.fileName,
    localPath: candidate.localPath,
    byteLength: candidate.byteLength,
    contentHash: candidate.contentHash,
    purpose: "mood",
    weight: 3,
    selectedRangeLabel: `${formatTimelineSeconds(range.startSeconds)} – ${formatTimelineSeconds(range.endSeconds)}（${formatSeconds(analysis.durationSeconds)}）`,
    analysis,
  };
}

/** Keeps timeline handles valid and caps the imported clip at 45 seconds. */
export function normalizeAudioSeedRange(
  durationSeconds: number,
  requestedStartSeconds: number,
  requestedEndSeconds: number,
): Pick<PendingAudioSeed, "startSeconds" | "endSeconds"> {
  const duration = Math.max(0, durationSeconds);
  const startSeconds = clamp(requestedStartSeconds, 0, duration);
  const endSeconds = clamp(
    requestedEndSeconds,
    startSeconds,
    Math.min(duration, startSeconds + maxSelectedAudioSeedSeconds),
  );
  if (endSeconds <= startSeconds) {
    throw new Error("请在时间轴上保留至少 1 秒的音频后再导入。");
  }
  return { startSeconds, endSeconds };
}

/**
 * Plays just the selected source range. No Blob, temp file or provider upload
 * is created: this is a local Web Audio preview of the candidate clip.
 */
export async function previewAudioSeedCandidate(
  candidate: PendingAudioSeed,
  onEnded: () => void,
): Promise<() => void> {
  if (typeof AudioContext === "undefined") {
    throw new Error("当前环境无法试听音频参考。请在桌面应用中重试。");
  }
  const range = normalizeAudioSeedRange(
    candidate.buffer.duration,
    candidate.startSeconds,
    candidate.endSeconds,
  );
  const context = new AudioContext();
  const source = context.createBufferSource();
  let finished = false;
  const finish = () => {
    if (finished) return;
    finished = true;
    source.disconnect();
    void context.close();
    onEnded();
  };
  source.buffer = candidate.buffer;
  source.connect(context.destination);
  source.onended = finish;
  try {
    if (context.state !== "running") await context.resume();
    source.start(0, range.startSeconds, range.endSeconds - range.startSeconds);
  } catch (cause) {
    finish();
    throw cause;
  }
  return () => {
    try {
      source.stop();
    } catch {
      finish();
    }
  };
}

export function summarizeAudioRange(
  buffer: Pick<
    AudioBuffer,
    "duration" | "length" | "numberOfChannels" | "getChannelData"
  >,
  startSeconds: number,
  endSeconds: number,
  fileNameForMessage = "音频参考",
): AudioSeedAnalysis {
  const range = normalizeAudioSeedRange(
    buffer.duration,
    startSeconds,
    endSeconds,
  );
  const sampleRate = buffer.length / buffer.duration;
  const from = Math.floor(range.startSeconds * sampleRate);
  const to = Math.min(buffer.length, Math.ceil(range.endSeconds * sampleRate));
  const selectedSamples = buffer.getChannelData(0).slice(from, to);
  return summarizeAudioBuffer(
    {
      duration: range.endSeconds - range.startSeconds,
      length: selectedSamples.length,
      numberOfChannels: buffer.numberOfChannels,
      getChannelData: () => selectedSamples,
    },
    fileNameForMessage,
  );
}

export function summarizeAudioBuffer(
  buffer: Pick<
    AudioBuffer,
    "duration" | "length" | "numberOfChannels" | "getChannelData"
  >,
  fileNameForMessage = "音频参考",
): AudioSeedAnalysis {
  const samples = buffer.getChannelData(0);
  const windows = 12;
  const energies: number[] = [];
  let crossings = 0;
  let previous = samples[0] ?? 0;
  for (let windowIndex = 0; windowIndex < windows; windowIndex += 1) {
    const from = Math.floor((samples.length * windowIndex) / windows);
    const to = Math.floor((samples.length * (windowIndex + 1)) / windows);
    let sum = 0;
    for (let index = from; index < to; index += 1) {
      const sample = samples[index] ?? 0;
      sum += sample * sample;
      if (sample >= 0 !== previous >= 0) crossings += 1;
      previous = sample;
    }
    energies.push(Math.sqrt(sum / Math.max(1, to - from)));
  }
  const average = energies.reduce((sum, value) => sum + value, 0) / windows;
  const early = energies.slice(0, 4).reduce((sum, value) => sum + value, 0) / 4;
  const late = energies.slice(-4).reduce((sum, value) => sum + value, 0) / 4;
  const peak = Math.max(...energies, 0);
  const energy =
    average < 0.06 ? "gentle" : average > 0.18 ? "strong" : "balanced";
  const brightness =
    crossings / Math.max(1, samples.length) > 0.13
      ? "bright"
      : crossings / Math.max(1, samples.length) < 0.04
        ? "warm"
        : "balanced";
  const energyArc =
    late > early * 1.35 ? "rising" : peak > average * 1.8 ? "varied" : "steady";
  const energyText =
    energy === "gentle" ? "柔和" : energy === "strong" ? "有力量" : "平衡";
  const brightnessText =
    brightness === "warm" ? "温暖" : brightness === "bright" ? "明亮" : "均衡";
  const arcText =
    energyArc === "rising"
      ? "后段更有力量"
      : energyArc === "varied"
        ? "有明显变化"
        : "整体平稳";
  return {
    durationSeconds: Number(buffer.duration.toFixed(1)),
    energy,
    brightness,
    energyArc,
    summary: `${fileNameForMessage}：约 ${formatSeconds(buffer.duration)}，听感偏${energyText}、${brightnessText}，${arcText}。此结论仅由本机特征估计，随后可由你修正。`,
  };
}

export function updateAudioSeed(
  seed: AudioSeed,
  updates: Partial<Pick<AudioSeed, "purpose" | "weight">>,
): AudioSeed {
  const purpose: SeedPurpose = updates.purpose ?? seed.purpose;
  const weight = Math.max(
    1,
    Math.min(5, Math.round(updates.weight ?? seed.weight)),
  );
  return { ...seed, purpose, weight };
}

function hashBytes(bytes: Uint8Array): string {
  let hash = 0x811c9dc5;
  for (const byte of bytes) {
    hash ^= byte;
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a-${(hash >>> 0).toString(16).padStart(8, "0")}-${bytes.byteLength}`;
}

function fileName(path: string): string {
  return path.split(/[\\/]/).at(-1) || "音频参考";
}

function formatSeconds(seconds: number): string {
  const rounded = Math.max(1, Math.round(seconds));
  return rounded >= 60
    ? `${Math.floor(rounded / 60)} 分 ${rounded % 60} 秒`
    : `${rounded} 秒`;
}

function formatTimelineSeconds(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}

function clamp(value: number, minimum: number, maximum: number): number {
  return Math.min(
    maximum,
    Math.max(minimum, Number.isFinite(value) ? value : minimum),
  );
}
