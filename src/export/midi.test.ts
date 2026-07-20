import { describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { createMidiFile, midiTicksPerBeat } from "./midi";

describe("MIDI 导出", () => {
  it("输出 Type 1、PPQN 480、conductor 和每条工程轨道", () => {
    const document = getBuiltInDemo();
    const midi = createMidiFile(document);

    expect(asciiAt(midi, 0, 4)).toBe("MThd");
    expect(readUint16(midi, 8)).toBe(1);
    expect(readUint16(midi, 10)).toBe(document.tracks.length + 1);
    expect(readUint16(midi, 12)).toBe(midiTicksPerBeat);
    expect(countAscii(midi, "MTrk")).toBe(document.tracks.length + 1);
    expect(countByte(midi, 0x90)).toBeGreaterThan(0);
    expect(countByte(midi, 0x99)).toBe(0);
  });

  it("将 mute/solo 后不可试听的轨道保留为 MIDI 轨，但不写 note-on", () => {
    const document = getBuiltInDemo();
    document.tracks[0]!.mute = true;
    const midi = createMidiFile(document);

    expect(asciiAt(midi, 0, 4)).toBe("MThd");
    expect(countAscii(midi, "MTrk")).toBe(document.tracks.length + 1);
    expect(countByte(midi, 0x99)).toBe(0);
  });

  it("拒绝导出所有轨道均静音的空白 MIDI", () => {
    const document = getBuiltInDemo();
    document.tracks.forEach((track) => {
      track.mute = true;
    });

    expect(() => createMidiFile(document)).toThrow("当前工程没有可播放的音符");
  });
});

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return (bytes[offset]! << 8) | bytes[offset + 1]!;
}

function countAscii(bytes: Uint8Array, token: string): number {
  const text = new TextDecoder().decode(bytes);
  return text.split(token).length - 1;
}

function countByte(bytes: Uint8Array, byte: number): number {
  return [...bytes].filter((item) => item === byte).length;
}
