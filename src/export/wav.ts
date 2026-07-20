import {
  compileM0PlaybackPlan,
  playbackPlanAudibilityIssue,
} from "../audio/playbackPlan";
import {
  closestSampleLayer,
  hasRecordedSamples,
  isDeliberateSynthInstrument,
  loadRecordedPcmSamplesForRender,
  type SampleLayer,
} from "../audio/sampleBank";
import type { PcmWavBuffer } from "../audio/pcmWav";
import type { ProjectDocument } from "../doc/types";

export const wavSampleRate = 44_100;
export const wavReleaseTailSeconds = 2;

const maxRenderFrames = wavSampleRate * 60 * 10;

/**
 * 以当前 RenderPlan 生成标准 stereo PCM WAV。实时播放与导出共用同一套经过
 * 校验的内置录音；唯一例外是注册表明确声明的 `square_lead` 合成主音。
 * 缺失实录的其他乐器绝不会回退为程序化电子音。
 */
export async function createWavFile(
  document: ProjectDocument,
): Promise<Uint8Array> {
  const planResult = compileM0PlaybackPlan(document);
  if (!planResult.ok)
    throw new Error(planResult.errors.map((error) => error.message).join("；"));
  const audibilityIssue = playbackPlanAudibilityIssue(planResult.plan);
  if (audibilityIssue) throw new Error(audibilityIssue);
  const unsupported = [
    ...new Set(planResult.plan.events.map((event) => event.instrument.id)),
  ].filter(
    (id) =>
      !hasRecordedSamples(id as Parameters<typeof hasRecordedSamples>[0]) &&
      !isDeliberateSynthInstrument(
        id as Parameters<typeof isDeliberateSynthInstrument>[0],
      ),
  );
  if (unsupported.length > 0) {
    throw new Error(
      `以下乐器未附带真实采样，无法导出：${unsupported.join("、")}。`,
    );
  }
  const secondsPerBeat = 60 / planResult.plan.tempo;
  const frameCount = Math.ceil(
    (planResult.plan.totalBeats * secondsPerBeat + wavReleaseTailSeconds) *
      wavSampleRate,
  );
  if (frameCount > maxRenderFrames)
    throw new Error("当前工程超过 10 分钟，暂不能在内存中导出 WAV。");

  const left = new Float32Array(frameCount);
  const right = new Float32Array(frameCount);
  const renderSamples = await preloadSamplesForRender(
    planResult.plan.events.map((event) => event.instrument.id),
  );
  planResult.plan.events.forEach((event) => {
    const startFrame = Math.round(event.beat * secondsPerBeat * wavSampleRate);
    const noteSeconds = event.dur * secondsPerBeat;
    const pan = panForTrack(event.trackId);
    const leftGain = Math.sqrt((1 - pan) * 0.5);
    const rightGain = Math.sqrt((1 + pan) * 0.5);
    const mixedRecorded = mixRecordedLayer(
      event.instrument.id,
      event.pitch,
      event.vel / 127,
      event.volume,
      renderSamples,
      startFrame,
      noteSeconds,
      left,
      right,
      leftGain,
      rightGain,
    );
    if (!mixedRecorded && isDeliberateSynthInstrument(event.instrument.id)) {
      mixSquareLead(
        event.pitch,
        event.vel / 127,
        event.volume,
        startFrame,
        noteSeconds,
        left,
        right,
        leftGain,
        rightGain,
      );
    } else if (!mixedRecorded) {
      throw new Error(
        `真实采样未就绪，已取消 WAV 导出：${event.instrument.name}。`,
      );
    }
  });
  normalizeStereoForExport(left, right);
  return encodePcmWav(left, right);
}

/**
 * Recorded source layers are intentionally conservative to avoid clipping
 * during live polyphony. A finished offline file has the complete mix, so we
 * can safely raise the whole stereo signal to a listenable, headroom-preserved
 * target without changing the piano/guitar balance.
 */
function normalizeStereoForExport(
  left: Float32Array,
  right: Float32Array,
): void {
  let peak = 0;
  for (let index = 0; index < left.length; index += 1) {
    peak = Math.max(peak, Math.abs(left[index]!), Math.abs(right[index]!));
  }
  if (peak <= 0) return;
  const targetPeak = 0.78;
  // The target peak itself is the clipping guard. A prior 24x ceiling left
  // sparse, all-local arrangements far below the target (about -23.5 dB RMS),
  // which users reasonably perceived as silent next to the AI path.
  const gain = targetPeak / peak;
  if (gain <= 1) return;
  for (let index = 0; index < left.length; index += 1) {
    left[index] *= gain;
    right[index] *= gain;
  }
}

/**
 * Offline counterpart of the explicitly declared square-lead synthesiser.
 * This is purpose-built for `square_lead`, never a substitute for a recorded
 * instrument that failed to load.
 */
function mixSquareLead(
  midi: number,
  velocity: number,
  volume: number,
  startFrame: number,
  noteSeconds: number,
  left: Float32Array,
  right: Float32Array,
  leftGain: number,
  rightGain: number,
): void {
  const frequency = 440 * 2 ** ((midi - 69) / 12);
  const outputFrames = Math.min(
    left.length - startFrame,
    Math.ceil((noteSeconds + 0.16) * wavSampleRate),
  );
  for (let offset = 0; offset < outputFrames; offset += 1) {
    const time = offset / wavSampleRate;
    const envelope = envelopeAt(time, noteSeconds);
    if (envelope <= 0) continue;
    const phase = (time * frequency) % 1;
    const square = phase < 0.5 ? 1 : -1;
    const gain = envelope * velocity * volume * 0.11;
    const frame = startFrame + offset;
    left[frame] += square * gain * leftGain;
    right[frame] += square * gain * rightGain;
  }
}

type RenderSampleBank = ReadonlyMap<
  string,
  ReadonlyMap<SampleLayer, PcmWavBuffer>
>;

async function preloadSamplesForRender(
  instrumentIds: string[],
): Promise<RenderSampleBank> {
  const ids = [
    ...new Set(
      instrumentIds.filter(
        (id): id is Parameters<typeof hasRecordedSamples>[0] =>
          hasRecordedSamples(id as Parameters<typeof hasRecordedSamples>[0]),
      ),
    ),
  ];
  const layers = await Promise.all(
    ids.map(
      async (id) => [id, await loadRecordedPcmSamplesForRender(id)] as const,
    ),
  );
  return new Map(layers);
}

function mixRecordedLayer(
  instrumentId: Parameters<typeof hasRecordedSamples>[0],
  midi: number,
  velocity: number,
  volume: number,
  renderSamples: RenderSampleBank,
  startFrame: number,
  noteSeconds: number,
  left: Float32Array,
  right: Float32Array,
  leftGain: number,
  rightGain: number,
): boolean {
  if (!hasRecordedSamples(instrumentId)) return false;
  const layers = renderSamples.get(instrumentId);
  const layer = closestSampleLayer(instrumentId, midi);
  const buffer = layer ? layers?.get(layer) : undefined;
  if (!layer || !buffer) return false;

  const playbackRate = 2 ** ((midi - layer.rootMidi) / 12);
  const onsetFrames = Math.min(
    buffer.length,
    Math.round(layer.onsetSeconds * buffer.sampleRate),
  );
  const outputFrames = Math.min(
    left.length - startFrame,
    Math.ceil(
      ((buffer.length - onsetFrames) / buffer.sampleRate / playbackRate) *
        wavSampleRate,
    ),
  );
  const sourceLeft = buffer.getChannelData(0);
  const sourceRight =
    buffer.numberOfChannels > 1 ? buffer.getChannelData(1) : sourceLeft;
  const releaseAt = noteSeconds + 0.42;
  for (let offset = 0; offset < outputFrames; offset += 1) {
    const time = offset / wavSampleRate;
    if (time > releaseAt) break;
    const sourceIndex =
      onsetFrames + (offset * playbackRate * buffer.sampleRate) / wavSampleRate;
    const floor = Math.floor(sourceIndex);
    const fraction = sourceIndex - floor;
    const next = Math.min(floor + 1, sourceLeft.length - 1);
    const envelope = envelopeAt(time, noteSeconds);
    if (envelope <= 0) continue;
    const gain = envelope * velocity * volume * 0.42;
    const frame = startFrame + offset;
    left[frame] +=
      (sourceLeft[floor]! * (1 - fraction) + sourceLeft[next]! * fraction) *
      gain *
      leftGain;
    right[frame] +=
      (sourceRight[floor]! * (1 - fraction) + sourceRight[next]! * fraction) *
      gain *
      rightGain;
  }
  return true;
}

function envelopeAt(time: number, noteSeconds: number): number {
  const attack = Math.min(1, time / 0.01);
  if (time <= noteSeconds) return attack;
  return attack * Math.max(0, 1 - (time - noteSeconds) / 0.16);
}

function panForTrack(trackId: string): number {
  let hash = 0;
  for (let index = 0; index < trackId.length; index += 1)
    hash = (hash * 31 + trackId.charCodeAt(index)) | 0;
  return ((hash >>> 0) % 101) / 100 - 0.5;
}

function encodePcmWav(left: Float32Array, right: Float32Array): Uint8Array {
  const bytesPerFrame = 4;
  const dataLength = left.length * bytesPerFrame;
  const output = new Uint8Array(44 + dataLength);
  const view = new DataView(output.buffer);
  writeAscii(output, 0, "RIFF");
  view.setUint32(4, 36 + dataLength, true);
  writeAscii(output, 8, "WAVE");
  writeAscii(output, 12, "fmt ");
  view.setUint32(16, 16, true);
  view.setUint16(20, 1, true);
  view.setUint16(22, 2, true);
  view.setUint32(24, wavSampleRate, true);
  view.setUint32(28, wavSampleRate * bytesPerFrame, true);
  view.setUint16(32, bytesPerFrame, true);
  view.setUint16(34, 16, true);
  writeAscii(output, 36, "data");
  view.setUint32(40, dataLength, true);
  for (let index = 0; index < left.length; index += 1) {
    view.setInt16(44 + index * bytesPerFrame, floatToPcm16(left[index]!), true);
    view.setInt16(
      44 + index * bytesPerFrame + 2,
      floatToPcm16(right[index]!),
      true,
    );
  }
  return output;
}

function floatToPcm16(value: number): number {
  const clamped = Math.max(-1, Math.min(1, value));
  return clamped < 0
    ? Math.round(clamped * 32_768)
    : Math.round(clamped * 32_767);
}

function writeAscii(output: Uint8Array, offset: number, value: string): void {
  new TextEncoder().encode(value).forEach((byte, index) => {
    output[offset + index] = byte;
  });
}
