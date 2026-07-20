import { describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { compileM0PlaybackPlan } from "./playbackPlan";

describe("M0 playback plan", () => {
  it("从有效 demo 编译确定性的三轨事件与 32 beat 循环范围", () => {
    const result = compileM0PlaybackPlan(getBuiltInDemo());

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.plan.totalBeats).toBe(32);
    expect(new Set(result.plan.events.map((event) => event.trackId)).size).toBe(
      3,
    );
    expect(result.plan.events).toEqual(
      [...result.plan.events].sort(
        (a, b) =>
          a.beat - b.beat ||
          a.trackId.localeCompare(b.trackId) ||
          a.pitch - b.pitch,
      ),
    );
  });

  it("遵循 mute/solo 语义", () => {
    const project = getBuiltInDemo();
    project.tracks[0]!.solo = true;
    const result = compileM0PlaybackPlan(project);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(new Set(result.plan.events.map((event) => event.trackId))).toEqual(
      new Set([project.tracks[0]!.id]),
    );
  });

  it("不为未知或不兼容乐器生成播放计划", () => {
    const project = getBuiltInDemo();
    project.tracks[0]!.instrument = "finger_bass";
    const result = compileM0PlaybackPlan(project);

    expect(result).toMatchObject({ ok: false });
    if (!result.ok) expect(result.errors[0]?.code).toBe("instrument_role");
  });
});
