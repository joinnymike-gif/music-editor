import { describe, expect, it } from "vitest";
import {
  createCreativeJourney,
  loadCreativeJourney,
  reconcileCreativeJourneyProject,
  saveCreativeJourney,
} from "./progress";

function createStorage(initial?: Record<string, string>) {
  const values = new Map(Object.entries(initial ?? {}));
  return {
    getItem: (key: string) => values.get(key) ?? null,
    setItem: (key: string, value: string) => values.set(key, value),
  };
}

describe("创作旅程本机状态", () => {
  it("保存并恢复同一台 Mac 上的创作选择", () => {
    const storage = createStorage();
    const journey = createCreativeJourney();
    journey.projectId = "project-1";
    journey.stage = "extend";
    journey.brief.userCorrection = "鼓点稀疏一点";

    saveCreativeJourney(journey, storage);

    expect(loadCreativeJourney(storage)).toMatchObject({
      projectId: "project-1",
      stage: "extend",
      brief: { userCorrection: "鼓点稀疏一点", sendAudioToProvider: false },
    });
  });

  it("损坏或不受支持的本机状态回退到安全默认值", () => {
    const storage = createStorage({
      "ai-music-ide:creative-journey:v1": JSON.stringify({
        version: 1,
        stage: "delete-all-projects",
        selectedProvider: "unknown",
        completedSectionIds: ["ok", 42],
        brief: {
          mood: "unknown",
          userCorrection: "x".repeat(400),
          audioSeeds: [{ fileName: "not-a-seed" }],
          sendAudioToProvider: true,
        },
      }),
    });

    const journey = loadCreativeJourney(storage);

    expect(journey.stage).toBe("rhythm");
    expect(journey.selectedProvider).toBe("gemini");
    expect(journey.completedSectionIds).toEqual(["ok"]);
    expect(journey.brief.mood).toBe("relaxed");
    expect(journey.brief.userCorrection).toHaveLength(280);
    expect(journey.brief.audioSeeds).toEqual([]);
    expect(journey.brief.sendAudioToProvider).toBe(false);
  });

  it("不会将已保存的创作步骤恢复到另一个工程或内置 Demo", () => {
    const journey = createCreativeJourney();
    journey.projectId = "10000000-0000-4000-8000-000000000001";
    journey.stage = "export";

    expect(
      reconcileCreativeJourneyProject(
        journey,
        "20000000-0000-4000-8000-000000000001",
      ),
    ).toEqual(createCreativeJourney());
    expect(reconcileCreativeJourneyProject(journey, journey.projectId)).toBe(
      journey,
    );
  });
});
