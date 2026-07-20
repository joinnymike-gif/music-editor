import * as Tone from "tone";
import type { M0PlaybackPlan, ScheduledNote } from "./playbackPlan";
import {
  resolveInstrument,
  type InstrumentEntry,
} from "../instruments/registry";
import {
  closestSampleLayer,
  isDeliberateSynthInstrument,
  hasRecordedSamples,
  loadedRecordedSamples,
  preloadRecordedSampleForMidi,
  preloadRecordedSamples,
  recordedAssetUnavailableMessage,
  type SampleLayer,
} from "./sampleBank";

interface Voice {
  noteOn: (midi: number, velocity: number, time?: number) => void;
  noteOff: (midi: number, time?: number) => void;
  play: (note: ScheduledNote, time: number, seconds: number) => void;
  allNotesOff: () => void;
  dispose: () => void;
}

export class M0AudioEngine {
  private readonly voices = new Map<string, Voice>();
  private readonly auditionRequests = new Map<string, number>();
  private readonly heldAuditions = new Map<string, RawAudition>();
  private readonly oneShotAuditions = new Set<RawAudition>();
  private activePlan: M0PlaybackPlan | undefined;
  private loopEnabled = true;
  private playbackRequest = 0;
  // Tone.Transport may still report "stopped" during its short look-ahead
  // window after start(). The UI must not treat that as a user-initiated stop:
  // doing so made a second click cancel the events that had just been queued.
  private playbackActive = false;
  // A Transport callback runs outside the initiating click handler. Preserve
  // errors from that boundary so the UI can stop truthfully instead of
  // continuing to display a silent "playing" state.
  private playbackError: string | null = null;
  private audioStartPromise: Promise<AudioContext> | undefined;

  async play(plan: M0PlaybackPlan, loopEnabled = true): Promise<boolean> {
    const request = ++this.playbackRequest;
    const context = await this.ensureStarted();
    // Loading is done before Transport is scheduled. A scheduled callback must
    // never await fetch/decode: that was the source of missed first notes in
    // early sample-player experiments.
    await this.preloadSamples(
      context,
      plan.events.map((event) => event.instrument.id),
    );
    if (request !== this.playbackRequest) return false;
    this.stopTransport();
    this.playbackError = null;
    // Allocate every voice while `play()` can still reject to the caller.
    // Creating a voice for the first time from a scheduled callback used to
    // turn a missing native audio resource into a silent transport failure.
    const instruments = [
      ...new Map(
        plan.events.map((event) => [event.instrument.id, event.instrument]),
      ).values(),
    ];
    instruments.forEach((instrument) => this.voiceFor(instrument));
    this.activePlan = plan;
    this.loopEnabled = loopEnabled;
    const transport = Tone.getTransport();
    transport.bpm.value = plan.tempo;
    transport.loop = loopEnabled;
    transport.loopStart = "0:0:0";
    transport.loopEnd = beatToTransportTime(plan.totalBeats);
    for (const event of plan.events) {
      transport.schedule((time) => {
        if (request !== this.playbackRequest || this.playbackError) return;
        const voice = this.voices.get(event.instrument.id);
        if (!voice) {
          this.failPlayback(`播放声部 ${event.instrument.name} 未就绪。`);
          return;
        }
        try {
          voice.play(event, time, (event.dur * 60) / plan.tempo);
        } catch (error) {
          const detail = error instanceof Error ? error.message : "未知错误。";
          this.failPlayback(
            `播放 ${event.instrument.name} 失败，已停止以避免静默播放：${detail}`,
          );
        }
      }, beatToTransportTime(event.beat));
    }
    if (!loopEnabled) {
      transport.scheduleOnce(() => {
        if (request !== this.playbackRequest) return;
        transport.stop();
        this.playbackActive = false;
      }, beatToTransportTime(plan.totalBeats));
    }
    // 立刻启动，避免 UI 在延迟启动窗口内把 Transport 误判为已停止。
    // Tone.start() 已在用户手势中完成；调度事件使用 Transport 时间轴即可。
    transport.start();
    this.playbackActive = true;
    return true;
  }

  stop(): void {
    this.playbackRequest += 1;
    this.playbackError = null;
    this.stopTransport();
  }

  private failPlayback(message: string): void {
    // A Transport cancel cannot retroactively interrupt callbacks that were
    // already pulled into the current scheduling window. Invalidate those too.
    this.playbackRequest += 1;
    this.playbackError = message;
    this.stopTransport();
  }

  private stopTransport(): void {
    const transport = Tone.getTransport();
    transport.stop();
    // Tone.Transport keeps scheduled callbacks in its timeline until cancel.
    // Clear them on every stop rather than waiting for the next playback, so a
    // long editing session cannot retain old project callbacks and closures.
    transport.cancel(0);
    transport.position = "0:0:0";
    this.playbackActive = false;
    this.activePlan = undefined;
    this.allNotesOff();
  }

  setLoopEnabled(enabled: boolean): void {
    this.loopEnabled = enabled;
    Tone.getTransport().loop = enabled;
  }

  getPlaybackSnapshot(): PlaybackSnapshot {
    const plan = this.activePlan;
    if (!plan)
      return {
        isPlaying: false,
        beat: 0,
        totalBeats: 0,
        loopEnabled: this.loopEnabled,
        error: this.playbackError,
      };
    const transport = Tone.getTransport();
    const rawBeat = Math.max(0, (transport.seconds * plan.tempo) / 60);
    return {
      // Do not derive this solely from Tone.Transport.state. On WebKit the
      // state can lag behind start() by one scheduling window, while the
      // context is already unlocked and events are validly scheduled.
      isPlaying: this.playbackActive,
      beat: normalizePlaybackBeat(rawBeat, plan.totalBeats, this.loopEnabled),
      totalBeats: plan.totalBeats,
      loopEnabled: this.loopEnabled,
      error: this.playbackError,
    };
  }

  async auditionNoteOn(
    instrumentId: string,
    midi: number,
    velocity = 0.78,
  ): Promise<boolean> {
    const key = auditionKey(instrumentId, midi);
    const request = (this.auditionRequests.get(key) ?? 0) + 1;
    this.auditionRequests.set(key, request);
    const context = await this.ensureStarted();
    if (this.auditionRequests.get(key) !== request) return false;
    const instrument = resolveInstrument("1.0", instrumentId);
    if (!instrument) throw new Error(`未找到可试听乐器 ${instrumentId}。`);
    this.releaseHeldAudition(key, context.currentTime);
    await this.preloadAuditionSample(context, instrument, midi);
    const audition = createAudition(context, instrument, midi, velocity);
    this.heldAuditions.set(key, audition);
    return true;
  }

  /**
   * A short, self-contained audition for on-screen controls. It intentionally
   * uses raw, finite Web Audio voices instead of Tone.PolySynth: Tone drops
   * notes once its pending voices reach maxPolyphony, which made rapid clicks
   * eventually go silent before release callbacks had run.
   */
  async auditionNote(
    instrumentId: string,
    midi: number,
    velocity = 0.78,
    durationSeconds = 0.22,
  ): Promise<boolean> {
    const context = await this.ensureStarted();
    const instrument = resolveInstrument("1.0", instrumentId);
    if (!instrument) throw new Error(`未找到可试听乐器 ${instrumentId}。`);
    this.makeRoomForOneShot(context.currentTime);
    await this.preloadAuditionSample(context, instrument, midi);
    const audition = createAudition(
      context,
      instrument,
      midi,
      velocity,
      durationSeconds,
    );
    audition.onEnded = () => this.oneShotAuditions.delete(audition);
    this.oneShotAuditions.add(audition);
    return true;
  }

  auditionNoteOff(instrumentId: string, midi: number): void {
    const key = auditionKey(instrumentId, midi);
    this.auditionRequests.delete(key);
    this.releaseHeldAudition(key, Tone.getContext().rawContext.currentTime);
  }

  allNotesOff(): void {
    this.auditionRequests.clear();
    const now = Tone.getContext().rawContext.currentTime;
    this.heldAuditions.forEach((audition) => releaseRawAudition(audition, now));
    this.heldAuditions.clear();
    this.oneShotAuditions.forEach((audition) => stopRawAudition(audition, now));
    this.oneShotAuditions.clear();
    this.voices.forEach((voice) => voice.allNotesOff());
  }

  dispose(): void {
    this.stop();
    this.voices.forEach((voice) => voice.dispose());
    this.voices.clear();
  }

  /**
   * Fetches and decodes the one real layer needed for the current keyboard
   * range without resuming audio. App UI calls this after an instrument or
   * octave changes, so the following press has no loading round-trip.
   */
  async prewarmAuditionNote(instrumentId: string, midi: number): Promise<void> {
    const instrument = resolveInstrument("1.0", instrumentId);
    if (!instrument) throw new Error(`未找到可试听乐器 ${instrumentId}。`);
    const context = Tone.getContext().rawContext;
    if (!isRealtimeAudioContext(context)) {
      throw new Error("当前设备不支持实时 Web Audio 输出。");
    }
    await this.preloadAuditionSample(context, instrument, midi);
  }

  private async ensureStarted(): Promise<AudioContext> {
    const context = Tone.getContext().rawContext;
    if (isRealtimeAudioContext(context) && context.state === "running") {
      return context;
    }
    // Starting/resuming the Web Audio context is comparatively expensive. A
    // dense keyboard run previously created one Tone.start() promise for every
    // note; share one in-flight resume and reuse the running context instead.
    if (this.audioStartPromise) return this.audioStartPromise;
    const start = this.startAudioContext();
    this.audioStartPromise = start;
    try {
      return await start;
    } finally {
      if (this.audioStartPromise === start) this.audioStartPromise = undefined;
    }
  }

  private async startAudioContext(): Promise<AudioContext> {
    // The OS can suspend a previously initialized Web Audio context after a
    // focus change. Calling Tone.start() from the next user gesture resumes it.
    await Tone.start();
    const context = Tone.getContext().rawContext;
    if (!isRealtimeAudioContext(context)) {
      throw new Error("当前设备不支持实时 Web Audio 输出。");
    }
    if (context.state !== "running") await context.resume();
    if (context.state !== "running") {
      throw new Error("音频上下文未能恢复。请检查系统输出设备后重试。");
    }
    return context;
  }

  private makeRoomForOneShot(now: number): void {
    while (this.oneShotAuditions.size >= MAX_ONE_SHOT_AUDITIONS) {
      const oldest = this.oneShotAuditions.values().next().value;
      if (!oldest) return;
      stopRawAudition(oldest, now);
      this.oneShotAuditions.delete(oldest);
    }
  }

  private releaseHeldAudition(key: string, now: number): void {
    const audition = this.heldAuditions.get(key);
    if (!audition) return;
    this.heldAuditions.delete(key);
    releaseRawAudition(audition, now);
  }

  private async preloadSamples(
    context: AudioContext,
    instrumentIds: Iterable<InstrumentEntry["id"]>,
  ): Promise<void> {
    const entries = [...new Set(instrumentIds)].map((id) => {
      const entry = resolveInstrument("1.0", id);
      if (!entry) throw new Error(`未找到乐器 ${id}。`);
      return entry;
    });
    const unavailable = entries.filter(
      (entry) =>
        !hasRecordedSamples(entry.id) && !isDeliberateSynthInstrument(entry.id),
    );
    if (unavailable.length > 0) {
      throw new Error(
        unavailable.map(recordedAssetUnavailableMessage).join("；"),
      );
    }
    try {
      await preloadRecordedSamples(
        context,
        entries
          .filter((entry) => hasRecordedSamples(entry.id))
          .map((entry) => entry.id),
      );
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知读取错误。";
      throw new Error(
        `真实采样加载失败，已阻止播放以避免回退为电子音：${detail}`,
        { cause: error },
      );
    }
    const notReady = entries.filter(
      (entry) =>
        hasRecordedSamples(entry.id) && !loadedRecordedSamples(entry.id),
    );
    if (notReady.length > 0) {
      throw new Error(notReady.map(recordedAssetUnavailableMessage).join("；"));
    }
  }

  private async preloadAuditionSample(
    context: AudioContext,
    instrument: InstrumentEntry,
    midi: number,
  ): Promise<void> {
    if (isDeliberateSynthInstrument(instrument.id)) return;
    if (!hasRecordedSamples(instrument.id)) {
      throw new Error(recordedAssetUnavailableMessage(instrument));
    }
    try {
      await preloadRecordedSampleForMidi(context, instrument.id, midi);
    } catch (error) {
      const detail = error instanceof Error ? error.message : "未知读取错误。";
      throw new Error(
        `真实采样加载失败，已阻止播放以避免回退为电子音：${detail}`,
        { cause: error },
      );
    }
    const layer = closestSampleLayer(instrument.id, midi);
    const samples = loadedRecordedSamples(instrument.id);
    if (!layer || !samples?.has(layer)) {
      throw new Error(recordedAssetUnavailableMessage(instrument));
    }
  }

  private voiceFor(entry: InstrumentEntry): Voice {
    const current = this.voices.get(entry.id);
    if (current) return current;
    if (isDeliberateSynthInstrument(entry.id)) {
      const voice = createSquareLeadVoice(
        Tone.getContext().rawContext as AudioContext,
        entry,
      );
      this.voices.set(entry.id, voice);
      return voice;
    }
    if (!hasRecordedSamples(entry.id)) {
      throw new Error(recordedAssetUnavailableMessage(entry));
    }
    const samples = loadedRecordedSamples(entry.id);
    if (!samples) throw new Error(recordedAssetUnavailableMessage(entry));
    const voice = createSampleVoice(
      Tone.getContext().rawContext as AudioContext,
      entry,
      samples,
    );
    this.voices.set(entry.id, voice);
    return voice;
  }
}

const MAX_ONE_SHOT_AUDITIONS = 24;
const MIN_AUDITION_GAIN = 0.0001;
const ATTACK_SECONDS = 0.008;
const RELEASE_SECONDS = 0.04;
const STOP_TAIL_SECONDS = 0.02;

interface RawAudition {
  gain: GainNode;
  cleaned: boolean;
  releasing: boolean;
  stopSource: (time: number) => void;
  disconnectSource: () => void;
  onEnded?: () => void;
}

function isRealtimeAudioContext(
  context: ReturnType<typeof Tone.getContext>["rawContext"],
): context is AudioContext {
  return typeof (context as AudioContext).resume === "function";
}

function createAudition(
  context: AudioContext,
  instrument: InstrumentEntry,
  midi: number,
  velocity: number,
  durationSeconds?: number,
  onEnded?: () => void,
): RawAudition {
  if (isDeliberateSynthInstrument(instrument.id)) {
    return createSquareLeadAudition(
      context,
      instrument,
      midi,
      velocity,
      durationSeconds,
      onEnded,
    );
  }
  const samples = loadedRecordedSamples(instrument.id);
  if (!samples || samples.size === 0) {
    throw new Error(recordedAssetUnavailableMessage(instrument));
  }
  return createSampleAudition(
    context,
    instrument,
    samples,
    midi,
    velocity,
    durationSeconds,
    onEnded,
  );
}

/**
 * The only oscillator voice in the product.  This function is intentionally
 * named after the registry's explicit square-lead asset, rather than being a
 * generic fallback for recorded instruments.
 */
function createSquareLeadAudition(
  context: AudioContext,
  instrument: InstrumentEntry,
  midi: number,
  velocity: number,
  durationSeconds?: number,
  onEnded?: () => void,
  destination: AudioNode = context.destination,
  startTime = context.currentTime,
  gainMultiplier = decibelsToGain(instrument.defaultGainDb),
): RawAudition {
  const source = context.createOscillator();
  const gain = context.createGain();
  const audition: RawAudition = {
    gain,
    cleaned: false,
    releasing: false,
    stopSource: (time) => source.stop(time),
    disconnectSource: () => source.disconnect(),
    onEnded,
  };
  const now = Math.max(context.currentTime, startTime);
  const attackEnd = now + ATTACK_SECONDS;
  const peak = Math.max(
    MIN_AUDITION_GAIN,
    Math.min(1, velocity) * gainMultiplier,
  );
  source.type = "square";
  source.frequency.setValueAtTime(440 * 2 ** ((midi - 69) / 12), now);
  gain.gain.setValueAtTime(MIN_AUDITION_GAIN, now);
  gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  source.connect(gain);
  gain.connect(destination);
  source.onended = () => cleanupRawAudition(audition);
  source.start(now);
  if (durationSeconds !== undefined) {
    const releaseStart = attackEnd + Math.max(0.01, durationSeconds);
    const releaseEnd = releaseStart + RELEASE_SECONDS;
    gain.gain.setValueAtTime(peak, releaseStart);
    gain.gain.exponentialRampToValueAtTime(MIN_AUDITION_GAIN, releaseEnd);
    source.stop(releaseEnd + STOP_TAIL_SECONDS);
  }
  return audition;
}

function createSampleAudition(
  context: AudioContext,
  instrument: InstrumentEntry,
  samples: ReadonlyMap<SampleLayer, AudioBuffer>,
  midi: number,
  velocity: number,
  durationSeconds?: number,
  onEnded?: () => void,
): RawAudition {
  const layer = closestSampleLayer(instrument.id, midi);
  const buffer = layer ? samples.get(layer) : undefined;
  if (!layer || !buffer) {
    throw new Error(recordedAssetUnavailableMessage(instrument));
  }
  const source = context.createBufferSource();
  const gain = context.createGain();
  const audition: RawAudition = {
    gain,
    cleaned: false,
    releasing: false,
    stopSource: (time) => source.stop(time),
    disconnectSource: () => source.disconnect(),
    onEnded,
  };
  const now = context.currentTime;
  const attackEnd = now + ATTACK_SECONDS;
  const peak = Math.max(
    MIN_AUDITION_GAIN,
    Math.min(1, velocity) * decibelsToGain(instrument.defaultGainDb),
  );

  source.buffer = buffer;
  source.playbackRate.setValueAtTime(2 ** ((midi - layer.rootMidi) / 12), now);
  gain.gain.setValueAtTime(MIN_AUDITION_GAIN, now);
  gain.gain.exponentialRampToValueAtTime(peak, attackEnd);
  source.connect(gain);
  gain.connect(context.destination);
  source.onended = () => cleanupRawAudition(audition);
  source.start(now, layer.onsetSeconds);

  if (durationSeconds !== undefined) {
    const releaseStart = attackEnd + Math.max(0.01, durationSeconds);
    const releaseEnd = releaseStart + RELEASE_SECONDS;
    gain.gain.setValueAtTime(peak, releaseStart);
    gain.gain.exponentialRampToValueAtTime(MIN_AUDITION_GAIN, releaseEnd);
    source.stop(releaseEnd + STOP_TAIL_SECONDS);
  }
  return audition;
}

function releaseRawAudition(audition: RawAudition, now: number): void {
  if (audition.cleaned || audition.releasing) return;
  audition.releasing = true;
  const releaseEnd = now + RELEASE_SECONDS;
  const currentGain = Math.max(audition.gain.gain.value, MIN_AUDITION_GAIN);
  audition.gain.gain.cancelScheduledValues(now);
  audition.gain.gain.setValueAtTime(currentGain, now);
  audition.gain.gain.exponentialRampToValueAtTime(
    MIN_AUDITION_GAIN,
    releaseEnd,
  );
  try {
    audition.stopSource(releaseEnd + STOP_TAIL_SECONDS);
  } catch {
    cleanupRawAudition(audition);
  }
}

function stopRawAudition(audition: RawAudition, now: number): void {
  if (audition.cleaned) return;
  try {
    audition.stopSource(now);
  } catch {
    // A stopped oscillator has already released its native resources.
  }
  cleanupRawAudition(audition);
}

function cleanupRawAudition(audition: RawAudition): void {
  if (audition.cleaned) return;
  audition.cleaned = true;
  try {
    audition.disconnectSource();
    audition.gain.disconnect();
  } finally {
    audition.onEnded?.();
  }
}

function decibelsToGain(decibels: number): number {
  return 10 ** (decibels / 20);
}

export const audioEngine = new M0AudioEngine();

export interface PlaybackSnapshot {
  isPlaying: boolean;
  beat: number;
  totalBeats: number;
  loopEnabled: boolean;
  error: string | null;
}

export function normalizePlaybackBeat(
  rawBeat: number,
  totalBeats: number,
  loopEnabled: boolean,
): number {
  if (totalBeats <= 0) return 0;
  const safeBeat = Math.max(0, rawBeat);
  if (!loopEnabled) return Math.min(safeBeat, totalBeats);
  return safeBeat % totalBeats;
}

function createSampleVoice(
  context: AudioContext,
  entry: InstrumentEntry,
  samples: ReadonlyMap<SampleLayer, AudioBuffer>,
): Voice {
  const output = context.createGain();
  output.gain.value = decibelsToGain(entry.defaultGainDb);
  output.connect(context.destination);
  const active = new Map<number, Set<RawAudition>>();

  const start = (
    midi: number,
    velocity: number,
    time: number,
    durationSeconds?: number,
  ): RawAudition => {
    const layer = closestSampleLayer(entry.id, midi);
    const buffer = layer ? samples.get(layer) : undefined;
    if (!layer || !buffer) {
      throw new Error(`内置采样 ${entry.name} 未就绪。`);
    }
    const source = context.createBufferSource();
    const gain = context.createGain();
    const audition: RawAudition = {
      gain,
      cleaned: false,
      releasing: false,
      stopSource: (stopTime) => source.stop(stopTime),
      disconnectSource: () => source.disconnect(),
      onEnded: () => active.get(midi)?.delete(audition),
    };
    const safeTime = Math.max(context.currentTime, time);
    const peak = Math.max(MIN_AUDITION_GAIN, Math.min(1, velocity));
    source.buffer = buffer;
    source.playbackRate.setValueAtTime(
      2 ** ((midi - layer.rootMidi) / 12),
      safeTime,
    );
    gain.gain.setValueAtTime(MIN_AUDITION_GAIN, safeTime);
    gain.gain.exponentialRampToValueAtTime(peak, safeTime + ATTACK_SECONDS);
    source.connect(gain);
    gain.connect(output);
    source.onended = () => cleanupRawAudition(audition);
    source.start(safeTime, layer.onsetSeconds);
    if (durationSeconds !== undefined) {
      const releaseStart = safeTime + Math.max(0.03, durationSeconds);
      const releaseEnd = releaseStart + Math.min(0.55, RELEASE_SECONDS * 8);
      gain.gain.setValueAtTime(peak, releaseStart);
      gain.gain.exponentialRampToValueAtTime(MIN_AUDITION_GAIN, releaseEnd);
      source.stop(releaseEnd + STOP_TAIL_SECONDS);
    }
    const byMidi = active.get(midi) ?? new Set<RawAudition>();
    byMidi.add(audition);
    active.set(midi, byMidi);
    return audition;
  };

  const releaseMidi = (midi: number, time = context.currentTime) => {
    active.get(midi)?.forEach((voice) => releaseRawAudition(voice, time));
    active.delete(midi);
  };

  return {
    noteOn: (midi, velocity, time) =>
      start(midi, velocity, time ?? context.currentTime),
    noteOff: (midi, time) => releaseMidi(midi, time),
    play: (note, time, seconds) =>
      start(note.pitch, (note.vel / 127) * note.volume, time, seconds),
    allNotesOff: () => {
      active.forEach((voices) =>
        voices.forEach((voice) =>
          releaseRawAudition(voice, context.currentTime),
        ),
      );
      active.clear();
    },
    dispose: () => {
      active.forEach((voices) =>
        voices.forEach((voice) => stopRawAudition(voice, context.currentTime)),
      );
      active.clear();
      output.disconnect();
    },
  };
}

function createSquareLeadVoice(
  context: AudioContext,
  entry: InstrumentEntry,
): Voice {
  const output = context.createGain();
  output.gain.value = decibelsToGain(entry.defaultGainDb);
  output.connect(context.destination);
  const active = new Map<number, Set<RawAudition>>();

  const start = (
    midi: number,
    velocity: number,
    time: number,
    durationSeconds?: number,
  ): RawAudition => {
    const audition = createSquareLeadAudition(
      context,
      entry,
      midi,
      velocity,
      durationSeconds,
      () => active.get(midi)?.delete(audition),
      output,
      time,
      1,
    );
    const byMidi = active.get(midi) ?? new Set<RawAudition>();
    byMidi.add(audition);
    active.set(midi, byMidi);
    return audition;
  };

  const releaseMidi = (midi: number, time = context.currentTime) => {
    active.get(midi)?.forEach((voice) => releaseRawAudition(voice, time));
    active.delete(midi);
  };

  return {
    noteOn: (midi, velocity, time) =>
      start(midi, velocity, time ?? context.currentTime),
    noteOff: (midi, time) => releaseMidi(midi, time),
    play: (note, time, seconds) =>
      start(note.pitch, (note.vel / 127) * note.volume, time, seconds),
    allNotesOff: () => {
      active.forEach((voices) =>
        voices.forEach((voice) =>
          releaseRawAudition(voice, context.currentTime),
        ),
      );
      active.clear();
    },
    dispose: () => {
      active.forEach((voices) =>
        voices.forEach((voice) => stopRawAudition(voice, context.currentTime)),
      );
      active.clear();
      output.disconnect();
    },
  };
}

function beatToTransportTime(beat: number): string {
  const bars = Math.floor(beat / 4);
  const beats = beat % 4;
  return `${bars}:${beats}:0`;
}

function auditionKey(instrumentId: string, midi: number): string {
  return `${instrumentId}:${midi}`;
}
