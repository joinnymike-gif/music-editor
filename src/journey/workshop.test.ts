import { describe, expect, it } from "vitest";
import { applyOperationBatch } from "../ops/apply";
import {
  buildJourneyAiPrompt,
  buildLocalSectionExtension,
  buildWorkshopLengthAdjustment,
  createSongPlan,
  createTenSecondWorkshopProject,
  workshopLengthSeconds,
} from "./workshop";
import { createCreativeJourney } from "./progress";

function ids(): () => string {
  let count = 0;
  return () => `10000000-0000-4000-8000-${String(++count).padStart(12, "0")}`;
}

describe("10 秒音乐工坊", () => {
  it("创建经过 Schema 校验的 10 秒开场和完整一分钟路线", () => {
    const project = createTenSecondWorkshopProject(
      "bright",
      new Date("2026-07-19T00:00:00.000Z"),
      ids(),
    );

    expect(project.name).toBe("我的第一首歌");
    expect(project.sections.map((section) => section.bars)).toEqual([
      5, 8, 8, 8, 1,
    ]);
    expect(
      project.sections.reduce((sum, section) => sum + section.bars, 0),
    ).toBe(30);
    expect(project.tracks.map((track) => track.role)).toEqual([
      "harmony",
      "bass",
      "lead",
    ]);
    expect(project.clips).toHaveLength(3);
    expect(
      project.clips.every((clip) => clip.sectionId === project.sections[0]!.id),
    ).toBe(true);
    expect(createSongPlan(project)).toHaveLength(5);
  });

  it("本机扩展只写入指定的非开场段落，并作为原子可撤销批次通过校验", () => {
    const project = createTenSecondWorkshopProject("relaxed", undefined, ids());
    const brief = createCreativeJourney().brief;
    const target = project.sections[1]!;
    const batch = buildLocalSectionExtension(project, target.id, brief);

    expect(batch).not.toBeNull();
    expect(batch?.source).toBe("macro");
    expect(batch?.operations).toHaveLength(3);
    expect(
      batch?.operations.every(
        (operation) =>
          operation.scope.kind === "clip" &&
          operation.scope.sectionId === target.id,
      ),
    ).toBe(true);

    const result = applyOperationBatch(project, batch!);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.filter((clip) => clip.sectionId === target.id),
    ).toHaveLength(3);
    expect(
      result.document.clips.filter(
        (clip) => clip.sectionId === project.sections[0]!.id,
      ),
    ).toEqual(project.clips);
  });

  it.each([
    ["30s", [5, 4, 3, 2, 1], 30],
    ["60s", [5, 8, 8, 8, 1], 60],
    ["120s", [5, 16, 16, 16, 7], 120],
  ] as const)(
    "将成品长度 %s 真实写入后续段落和播放时长",
    (length, expectedBars, seconds) => {
      const project = createTenSecondWorkshopProject(
        "relaxed",
        undefined,
        ids(),
      );
      const batch = buildWorkshopLengthAdjustment(project, length);
      const result = batch
        ? applyOperationBatch(project, batch)
        : { applied: true, document: project };

      expect(result.applied).toBe(true);
      if (!result.applied) return;
      expect(result.document.sections.map((section) => section.bars)).toEqual(
        expectedBars,
      );
      expect(workshopLengthSeconds(length)).toBe(seconds);
      expect(
        result.document.sections.reduce(
          (total, section) => total + section.bars,
          0,
        ),
      ).toBe(seconds / 2);
    },
  );

  it("AI 提示词只使用用户确认的摘要，不暴露参考文件路径", () => {
    const project = createTenSecondWorkshopProject(
      "powerful",
      undefined,
      ids(),
    );
    const brief = createCreativeJourney().brief;
    brief.audioSeeds = [
      {
        id: "seed-1",
        fileName: "reference.wav",
        localPath: "/Users/example/private/reference.wav",
        byteLength: 2048,
        contentHash: "fnv1a-test",
        purpose: "rhythm",
        weight: 4,
        selectedRangeLabel: "整段 12 秒",
        analysis: {
          durationSeconds: 12,
          energy: "balanced",
          brightness: "warm",
          energyArc: "steady",
          summary: "reference.wav：约 12 秒，节奏较稳定。",
        },
      },
    ];

    const prompt = buildJourneyAiPrompt(
      project,
      project.sections[1]!.id,
      brief,
    );

    expect(prompt).toContain("reference.wav：约 12 秒，节奏较稳定。");
    expect(prompt).not.toContain("/Users/example/private");
    expect(prompt).toContain("不要修改");
  });
});
