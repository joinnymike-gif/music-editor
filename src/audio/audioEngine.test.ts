import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { compileM0PlaybackPlan } from "./playbackPlan";

const toneMock = vi.hoisted(() => {
  const audioParam = () => ({
    cancelScheduledValues: vi.fn(),
    exponentialRampToValueAtTime: vi.fn(),
    setValueAtTime: vi.fn(),
    value: 0.2,
  });
  const oscillators: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    frequency: ReturnType<typeof audioParam>;
    onended: (() => void) | null;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
    type?: OscillatorType;
  }> = [];
  const bufferSources: Array<{
    buffer: AudioBuffer | null;
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    onended: (() => void) | null;
    playbackRate: ReturnType<typeof audioParam>;
    start: ReturnType<typeof vi.fn>;
    stop: ReturnType<typeof vi.fn>;
  }> = [];
  const gains: Array<{
    connect: ReturnType<typeof vi.fn>;
    disconnect: ReturnType<typeof vi.fn>;
    gain: ReturnType<typeof audioParam>;
  }> = [];
  const rawContext = {
    createGain: vi.fn(() => {
      const gain = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        gain: audioParam(),
      };
      gains.push(gain);
      return gain;
    }),
    createOscillator: vi.fn(() => {
      const oscillator = {
        connect: vi.fn(),
        disconnect: vi.fn(),
        frequency: audioParam(),
        onended: null as (() => void) | null,
        start: vi.fn(),
        stop: vi.fn(),
        type: undefined as OscillatorType | undefined,
      };
      oscillators.push(oscillator);
      return oscillator;
    }),
    createBufferSource: vi.fn(() => {
      const source = {
        buffer: null as AudioBuffer | null,
        connect: vi.fn(),
        disconnect: vi.fn(),
        onended: null as (() => void) | null,
        playbackRate: audioParam(),
        start: vi.fn(),
        stop: vi.fn(),
      };
      bufferSources.push(source);
      return source;
    }),
    decodeAudioData: vi.fn(async () => ({
      getChannelData: () => new Float32Array(44_100).fill(0.2),
      length: 44_100,
      numberOfChannels: 1,
      sampleRate: 44_100,
    })),
    currentTime: 0,
    destination: {},
    resume: vi.fn<() => Promise<void>>(),
    state: "running" as AudioContextState,
  };
  class Volume {
    dispose = vi.fn();
    toDestination() {
      return this;
    }
  }
  class PolySynth {
    connect() {
      return this;
    }
    dispose = vi.fn();
    releaseAll = vi.fn();
    triggerAttack = vi.fn();
    triggerAttackRelease = vi.fn();
    triggerRelease = vi.fn();
  }
  class Synth {}
  const transport = {
    bpm: { value: 0 },
    cancel: vi.fn(),
    loop: false,
    loopEnd: "",
    loopStart: "",
    position: "0:0:0",
    schedule: vi.fn(),
    scheduleOnce: vi.fn(),
    seconds: 0,
    start: vi.fn(),
    state: "stopped",
    stop: vi.fn(),
  };
  return {
    Frequency: vi.fn(() => ({ toNote: () => "C4" })),
    bufferSources,
    getContext: vi.fn(() => ({ rawContext })),
    gains,
    now: vi.fn(() => 0),
    oscillators,
    PolySynth,
    rawContext,
    Synth,
    Volume,
    start: vi.fn<() => Promise<void>>(),
    transport,
  };
});

vi.mock("tone", () => ({
  Frequency: toneMock.Frequency,
  getContext: toneMock.getContext,
  PolySynth: toneMock.PolySynth,
  Synth: toneMock.Synth,
  Volume: toneMock.Volume,
  getTransport: () => toneMock.transport,
  now: toneMock.now,
  start: toneMock.start,
}));

import { M0AudioEngine, normalizePlaybackBeat } from "./audioEngine";

function deferred(): { promise: Promise<void>; resolve: () => void } {
  let resolve: () => void = () => undefined;
  const promise = new Promise<void>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function resetToneMock() {
  toneMock.gains.length = 0;
  toneMock.oscillators.length = 0;
  toneMock.bufferSources.length = 0;
  toneMock.rawContext.createGain.mockClear();
  toneMock.rawContext.createOscillator.mockClear();
  toneMock.rawContext.createBufferSource.mockClear();
  toneMock.rawContext.decodeAudioData.mockClear();
  toneMock.rawContext.currentTime = 0;
  toneMock.rawContext.resume.mockReset();
  toneMock.rawContext.resume.mockResolvedValue();
  toneMock.rawContext.state = "running";
  toneMock.now.mockReset();
  toneMock.now.mockReturnValue(0);
  toneMock.start.mockReset();
  toneMock.transport.bpm.value = 0;
  toneMock.transport.cancel.mockReset();
  toneMock.transport.loop = false;
  toneMock.transport.loopEnd = "";
  toneMock.transport.loopStart = "";
  toneMock.transport.position = "0:0:0";
  toneMock.transport.schedule.mockReset();
  toneMock.transport.scheduleOnce.mockReset();
  toneMock.transport.seconds = 0;
  toneMock.transport.start.mockReset();
  toneMock.transport.state = "stopped";
  toneMock.transport.stop.mockReset();
}

beforeAll(() => {
  vi.stubGlobal("fetch", async (input: string | URL) => {
    const pathname = new URL(String(input), "http://localhost").pathname;
    const file = readFileSync(
      resolve(process.cwd(), "public", pathname.slice(1)),
    );
    return {
      ok: true,
      status: 200,
      arrayBuffer: async () =>
        file.buffer.slice(file.byteOffset, file.byteOffset + file.byteLength),
    } as Response;
  });
});

function demoPlan() {
  const result = compileM0PlaybackPlan(getBuiltInDemo());
  if (!result.ok) throw new Error("内置 demo 无法编译播放计划。");
  return result.plan;
}

describe("播放位置归一化", () => {
  it("循环播放时将超出范围的 beat 折回工程长度", () => {
    expect(normalizePlaybackBeat(33.25, 32, true)).toBe(1.25);
  });

  it("非循环播放时将播放位置限制在工程末尾", () => {
    expect(normalizePlaybackBeat(33.25, 32, false)).toBe(32);
    expect(normalizePlaybackBeat(-2, 32, false)).toBe(0);
  });
});

describe("M0AudioEngine 调度与取消", () => {
  it("以工程 beat 编排事件，并设置全曲循环边界", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();
    const plan = demoPlan();

    await expect(engine.play(plan, true)).resolves.toBe(true);

    expect(toneMock.transport.bpm.value).toBe(120);
    expect(toneMock.transport.loop).toBe(true);
    expect(toneMock.transport.loopStart).toBe("0:0:0");
    expect(toneMock.transport.loopEnd).toBe("8:0:0");
    expect(toneMock.transport.schedule).toHaveBeenCalledTimes(
      plan.events.length,
    );
    expect(toneMock.transport.start).toHaveBeenCalledOnce();
    // The mock intentionally leaves Tone.Transport.state at "stopped" to
    // reproduce WebKit's delayed state transition after start(). The engine
    // must still retain the scheduled playback instead of making the UI stop.
    expect(engine.getPlaybackSnapshot().isPlaying).toBe(true);
  });

  it("内置 C minor Demo 的全部 Transport 回调都会创建真实采样声源", async () => {
    resetToneMock();
    const scheduled: Array<(time: number) => void> = [];
    toneMock.transport.schedule.mockImplementation((callback) => {
      scheduled.push(callback as (time: number) => void);
      return 0;
    });
    const engine = new M0AudioEngine();
    const plan = demoPlan();

    await expect(engine.play(plan, true)).resolves.toBe(true);
    scheduled.forEach((callback) => callback(0));

    expect(scheduled).toHaveLength(plan.events.length);
    expect(toneMock.rawContext.createBufferSource).toHaveBeenCalledTimes(
      plan.events.length,
    );
    expect(
      toneMock.bufferSources.every(
        (source) => source.start.mock.calls.length === 1,
      ),
    ).toBe(true);
  });

  it("在 Transport 启动前预创建所有声部，并将回调期播放错误反馈给界面", async () => {
    resetToneMock();
    const scheduled: Array<(time: number) => void> = [];
    toneMock.transport.schedule.mockImplementation((callback) => {
      scheduled.push(callback as (time: number) => void);
      return 0;
    });
    const engine = new M0AudioEngine();

    await expect(engine.play(demoPlan(), true)).resolves.toBe(true);
    // 音源输出节点已在开始 Transport 前构建，不再依赖首个调度回调。
    expect(toneMock.rawContext.createGain).toHaveBeenCalledTimes(3);

    toneMock.rawContext.createBufferSource.mockImplementationOnce(() => {
      throw new Error("测试音频设备不可用");
    });
    scheduled.forEach((callback) => callback(0));

    expect(engine.getPlaybackSnapshot()).toMatchObject({
      isPlaying: false,
      error: expect.stringContaining("测试音频设备不可用"),
    });
    expect(toneMock.bufferSources).toHaveLength(0);
    expect(toneMock.transport.stop).toHaveBeenCalled();
  });

  it("停止发生在音频初始化期间时，不得迟到启动播放", async () => {
    resetToneMock();
    const pending = deferred();
    toneMock.rawContext.state = "suspended";
    toneMock.start.mockReturnValue(pending.promise);
    const engine = new M0AudioEngine();

    const playback = engine.play(demoPlan());
    engine.stop();
    toneMock.rawContext.state = "running";
    pending.resolve();

    await expect(playback).resolves.toBe(false);
    expect(toneMock.transport.start).not.toHaveBeenCalled();
  });

  it("非循环播放会安排工程末尾停止，手动停止会复位 Transport", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();

    await expect(engine.play(demoPlan(), false)).resolves.toBe(true);
    expect(toneMock.transport.loop).toBe(false);
    expect(toneMock.transport.scheduleOnce).toHaveBeenCalledOnce();

    engine.stop();
    expect(toneMock.transport.stop).toHaveBeenCalled();
    expect(toneMock.transport.cancel).toHaveBeenCalledWith(0);
    expect(toneMock.transport.position).toBe("0:0:0");
    expect(engine.getPlaybackSnapshot().isPlaying).toBe(false);
  });

  it("连续重新播放会在每次编排前清空旧调度", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();
    const plan = demoPlan();

    for (let index = 0; index < 10; index += 1) {
      await expect(engine.play(plan, true)).resolves.toBe(true);
    }

    expect(toneMock.transport.cancel).toHaveBeenCalledTimes(10);
    expect(toneMock.transport.schedule).toHaveBeenCalledTimes(
      plan.events.length * 10,
    );
    expect(toneMock.transport.start).toHaveBeenCalledTimes(10);
    expect(toneMock.start).not.toHaveBeenCalled();
  });

  it("试听键在初始化前松开时，不得产生迟到的音符", async () => {
    resetToneMock();
    const pending = deferred();
    toneMock.rawContext.state = "suspended";
    toneMock.start.mockReturnValue(pending.promise);
    const engine = new M0AudioEngine();

    const audition = engine.auditionNoteOn("acoustic_piano", 60);
    engine.auditionNoteOff("acoustic_piano", 60);
    toneMock.rawContext.state = "running";
    pending.resolve();

    await expect(audition).resolves.toBe(false);
  });

  it("多次释放后，同一 MIDI 音符仍可重新试听", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();

    for (let index = 0; index < 8; index += 1) {
      await expect(engine.auditionNoteOn("acoustic_piano", 60)).resolves.toBe(
        true,
      );
      engine.auditionNoteOff("acoustic_piano", 60);
    }

    await expect(engine.auditionNoteOn("acoustic_piano", 60)).resolves.toBe(
      true,
    );
  });

  it("页面白键的短促试听不受旧的按住状态影响，并复用已运行的音频上下文", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();

    await expect(engine.auditionNoteOn("acoustic_piano", 60)).resolves.toBe(
      true,
    );
    engine.allNotesOff();
    await expect(engine.auditionNote("acoustic_piano", 60)).resolves.toBe(true);
    await expect(engine.auditionNote("acoustic_piano", 84)).resolves.toBe(true);

    expect(toneMock.start).not.toHaveBeenCalled();
  });

  it("实录试听从测得的音乐起音点开始，不播放录音前导静音", async () => {
    resetToneMock();
    const engine = new M0AudioEngine();

    await expect(engine.auditionNote("acoustic_piano", 24)).resolves.toBe(true);
    await expect(engine.auditionNote("violin", 55)).resolves.toBe(true);

    expect(toneMock.bufferSources[0]!.start).toHaveBeenCalledWith(0, 0.557);
    expect(toneMock.bufferSources[1]!.start).toHaveBeenCalledWith(0, 1.989);
  });

  it("并发试听共享一次音频恢复，不会为每个按键重复创建启动任务", async () => {
    resetToneMock();
    const pending = deferred();
    toneMock.rawContext.state = "suspended";
    toneMock.start.mockReturnValue(pending.promise);
    const engine = new M0AudioEngine();

    const requests = [
      engine.auditionNote("acoustic_piano", 60),
      engine.auditionNote("acoustic_piano", 64),
      engine.auditionNote("acoustic_piano", 67),
    ];

    expect(toneMock.start).toHaveBeenCalledOnce();
    toneMock.rawContext.state = "running";
    pending.resolve();

    await expect(Promise.all(requests)).resolves.toEqual([true, true, true]);
    expect(toneMock.start).toHaveBeenCalledOnce();
  });

  it("连续 10,000 次页面键盘点击始终创建新试听，并将并发音源限制在安全上限", async () => {
    resetToneMock();
    toneMock.start.mockResolvedValue();
    const engine = new M0AudioEngine();

    for (let index = 0; index < 10_000; index += 1) {
      await expect(
        engine.auditionNote("acoustic_piano", 48 + (index % 37)),
      ).resolves.toBe(true);
    }

    expect(toneMock.rawContext.createBufferSource).toHaveBeenCalledTimes(
      10_000,
    );
    expect(toneMock.start).not.toHaveBeenCalled();
    expect(toneMock.bufferSources).toHaveLength(10_000);
    expect(
      toneMock.bufferSources.filter(
        (source) => source.stop.mock.calls.length === 2,
      ),
    ).toHaveLength(9_976);
    expect(
      toneMock.bufferSources.filter(
        (source) => source.stop.mock.calls.length === 1,
      ),
    ).toHaveLength(24);

    engine.allNotesOff();
    expect(
      toneMock.bufferSources.filter(
        (source) => source.stop.mock.calls.length === 2,
      ),
    ).toHaveLength(10_000);
  });

  it("六种实录乐器在 C1–C7 的全部 QWERTY 音阶都能解码并创建真实采样声源", async () => {
    resetToneMock();
    const engine = new M0AudioEngine();
    const recordedInstruments = [
      "finger_bass",
      "acoustic_piano",
      "electric_piano",
      "acoustic_guitar",
      "violin",
      "flute",
    ] as const;
    const scaleOffsets = [0, 2, 3, 5, 7, 8, 10];

    for (const instrumentId of recordedInstruments) {
      for (let octave = 1; octave <= 7; octave += 1) {
        for (const offset of scaleOffsets) {
          const midi = (octave + 1) * 12 + offset;
          await expect(engine.auditionNote(instrumentId, midi)).resolves.toBe(
            true,
          );
        }
      }
    }

    expect(toneMock.rawContext.createBufferSource).toHaveBeenCalledTimes(
      recordedInstruments.length * 7 * scaleOffsets.length,
    );
    expect(toneMock.rawContext.createOscillator).not.toHaveBeenCalled();
  });

  it("合成主音走明确的方波合成路径，实录缺失的鼓组仍不得兜底播放", async () => {
    resetToneMock();
    const engine = new M0AudioEngine();

    await expect(engine.auditionNote("square_lead", 60)).resolves.toBe(true);
    expect(toneMock.rawContext.createOscillator).toHaveBeenCalledOnce();
    expect(toneMock.oscillators[0]!.type).toBe("square");
    expect(toneMock.rawContext.createBufferSource).not.toHaveBeenCalled();

    await expect(engine.auditionNote("acoustic_kit", 36)).rejects.toThrow(
      "尚未附带真实采样",
    );
    expect(toneMock.rawContext.createOscillator).toHaveBeenCalledOnce();
  });
});
