import { describe, expect, it } from "vitest";
import { quantizeKeyboardRecording, recordingElapsedBeats } from "./recording";

describe("键盘录制量化", () => {
  it("将键盘事件量化到 1/16，并使用固定力度", () => {
    expect(
      quantizeKeyboardRecording(
        [{ midi: 60, start: 0.14, duration: 0.39 }],
        16,
      ),
    ).toEqual({
      notes: [{ start: 0.25, dur: 0.25, pitch: 60, vel: 100 }],
      droppedCount: 0,
    });
  });

  it("截断段落末尾的音符并丢弃段落外和非法事件", () => {
    expect(
      quantizeKeyboardRecording(
        [
          { midi: 64, start: 3.7, duration: 0.8 },
          { midi: 67, start: 4, duration: 0.5 },
          { midi: 130, start: 0, duration: 1 },
        ],
        4,
      ),
    ).toEqual({
      notes: [{ start: 3.75, dur: 0.25, pitch: 64, vel: 100 }],
      droppedCount: 2,
    });
  });

  it("按工程速度计算相对拍数", () => {
    expect(recordingElapsedBeats(1_000, 2_000, 120)).toBe(2);
    expect(recordingElapsedBeats(2_000, 1_000, 120)).toBe(0);
  });
});
