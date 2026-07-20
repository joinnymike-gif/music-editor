import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import { decodePcmWav } from "./pcmWav";

describe("随包 PCM WAV 解码", () => {
  it("保留真实钢琴录音的双向波形，而不是测试常量缓冲", () => {
    const bytes = readFileSync(
      resolve(process.cwd(), "public/samples/iowa-mis/piano-c4.wav"),
    );
    const payload = bytes.buffer.slice(
      bytes.byteOffset,
      bytes.byteOffset + bytes.byteLength,
    );
    const decoded = decodePcmWav(payload);
    const samples = decoded.getChannelData(0).slice(Math.round(0.345 * 44_100));

    expect(decoded.sampleRate).toBe(44_100);
    expect(decoded.numberOfChannels).toBe(2);
    expect(samples.some((sample) => sample > 0)).toBe(true);
    expect(samples.some((sample) => sample < 0)).toBe(true);
  });
});
