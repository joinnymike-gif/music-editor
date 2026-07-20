import { describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { createWavFile, wavReleaseTailSeconds, wavSampleRate } from "./wav";

describe("WAV 导出", () => {
  it("输出可被标准播放器识别的 44.1 kHz stereo PCM WAV 和 release tail", async () => {
    const document = getBuiltInDemo();
    const wav = await createWavFile(document);
    const view = new DataView(wav.buffer);

    expect(asciiAt(wav, 0, 4)).toBe("RIFF");
    expect(asciiAt(wav, 8, 4)).toBe("WAVE");
    expect(asciiAt(wav, 36, 4)).toBe("data");
    expect(view.getUint16(22, true)).toBe(2);
    expect(view.getUint32(24, true)).toBe(wavSampleRate);
    expect(view.getUint16(34, true)).toBe(16);
    expect(view.getUint32(40, true)).toBe(
      (32 * (60 / 120) + wavReleaseTailSeconds) * wavSampleRate * 4,
    );
  });

  it("所有轨道静音时拒绝导出表面成功但无声的 WAV", async () => {
    const document = getBuiltInDemo();
    document.tracks.forEach((track) => {
      track.mute = true;
    });
    await expect(createWavFile(document)).rejects.toThrow("没有可播放的音符");
  });

  it("有可播放音符时必须写入非静音 PCM 采样", async () => {
    const wav = await createWavFile(getBuiltInDemo());
    const data = new Int16Array(wav.buffer.slice(44));

    expect(data.some((sample) => sample !== 0)).toBe(true);
    // A fixed test buffer can make a file non-silent while still containing no
    // instrument recording. Real PCM layers must retain positive and negative
    // waveform excursions after offline mixing.
    expect(data.some((sample) => sample > 0)).toBe(true);
    expect(data.some((sample) => sample < 0)).toBe(true);
    expect(
      data.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
    ).toBeGreaterThan(20_000);
  });

  it.each([
    "acoustic_piano",
    "electric_piano",
    "acoustic_guitar",
    "violin",
    "flute",
    "square_lead",
  ])("每个可用旋律乐器 %s 可离线导出非静音 WAV", async (instrument) => {
    const document = getBuiltInDemo();
    document.tracks[2]!.instrument = instrument;

    const wav = await createWavFile(document);
    const data = new Int16Array(wav.buffer.slice(44));

    expect(data.some((sample) => sample !== 0)).toBe(true);
  });
});

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}
