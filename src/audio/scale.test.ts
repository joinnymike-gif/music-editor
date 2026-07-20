import { describe, expect, it } from "vitest";
import { qwertKeyToMidi, scaleDegreeToMidi } from "./scale";

describe("QWERT 音阶映射", () => {
  it("将 C major 和 C minor 的 do re mi fa sol 映射为不同 MIDI 音高", () => {
    expect(
      ["q", "w", "e", "r", "t"].map((key) => qwertKeyToMidi(key, "C", "major")),
    ).toEqual([60, 62, 64, 65, 67]);
    expect(
      ["q", "w", "e", "r", "t"].map((key) => qwertKeyToMidi(key, "C", "minor")),
    ).toEqual([60, 62, 63, 65, 67]);
  });

  it("拒绝非音阶键与越界的音阶级数", () => {
    expect(qwertKeyToMidi("a", "C", "minor")).toBeUndefined();
    expect(() => scaleDegreeToMidi("C", "minor", 7)).toThrow(
      "不支持的音阶级数",
    );
  });
});
