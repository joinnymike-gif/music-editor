import { describe, expect, it } from "vitest";
import {
  createAudioSeedFromCandidate,
  normalizeAudioSeedRange,
  summarizeAudioBuffer,
  summarizeAudioRange,
  updateAudioSeed,
} from "./audioSeed";
import type { AudioSeed } from "./types";

describe("本机音频参考摘要", () => {
  it("从本机 PCM 特征生成可供用户检查的简短摘要", () => {
    const samples = Float32Array.from({ length: 1200 }, (_, index) =>
      index < 600 ? 0.03 : index % 2 === 0 ? 0.24 : -0.24,
    );
    const analysis = summarizeAudioBuffer(
      {
        duration: 12,
        length: samples.length,
        numberOfChannels: 1,
        getChannelData: () => samples,
      },
      "my-reference.wav",
    );

    expect(analysis.durationSeconds).toBe(12);
    expect(analysis.energyArc).toBe("rising");
    expect(analysis.summary).toContain("my-reference.wav");
    expect(analysis.summary).toContain("本机特征估计");
  });

  it("限制用户设置的参考权重", () => {
    const seed = {
      id: "seed",
      fileName: "reference.wav",
      localPath: "/private/reference.wav",
      byteLength: 1,
      contentHash: "fnv1a-test",
      purpose: "mood",
      weight: 3,
      selectedRangeLabel: "整段 1 秒",
      analysis: {
        durationSeconds: 1,
        energy: "gentle",
        brightness: "warm",
        energyArc: "steady",
        summary: "摘要",
      },
    } satisfies AudioSeed;

    expect(updateAudioSeed(seed, { weight: 99 })).toMatchObject({ weight: 5 });
    expect(
      updateAudioSeed(seed, { weight: -3, purpose: "timbre" }),
    ).toMatchObject({
      weight: 1,
      purpose: "timbre",
    });
  });

  it("允许长源文件选择最多 45 秒的时间轴片段，并只分析所选范围", () => {
    const samples = Float32Array.from({ length: 2_400 }, (_, index) =>
      index < 300 ? 0.02 : index % 2 === 0 ? 0.32 : -0.32,
    );
    const buffer = {
      duration: 240,
      length: samples.length,
      numberOfChannels: 1,
      getChannelData: () => samples,
    } as unknown as AudioBuffer;

    expect(normalizeAudioSeedRange(240, 10, 100)).toEqual({
      startSeconds: 10,
      endSeconds: 55,
    });
    expect(
      summarizeAudioRange(buffer, 10, 55, "long-reference.mp3"),
    ).toMatchObject({ durationSeconds: 45, energyArc: "rising" });

    const seed = createAudioSeedFromCandidate({
      id: "long-source",
      fileName: "long-reference.mp3",
      localPath: "/private/long-reference.mp3",
      byteLength: 10,
      contentHash: "fnv1a-test",
      buffer,
      startSeconds: 10,
      endSeconds: 100,
    });

    expect(seed.selectedRangeLabel).toContain("0:10 – 0:55");
    expect(seed.analysis.durationSeconds).toBe(45);
  });
});
