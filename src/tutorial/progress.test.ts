import { describe, expect, it } from "vitest";
import { getTutorialById } from "./content";
import {
  emptyTutorialProgress,
  entryForTutorial,
  loadTutorialProgress,
  saveTutorialProgress,
  tutorialProgressStorageKey,
  updateTutorialProgress,
} from "./progress";

const welcomeTutorial = getTutorialById("welcome-basics");

if (!welcomeTutorial) throw new Error("缺少欢迎页教程 fixture。");

describe("TutorialProgress", () => {
  it("保存并恢复当前步骤和状态", () => {
    const storage = new Map<string, string>();
    const fakeStorage: Storage = {
      get length() {
        return storage.size;
      },
      clear: () => storage.clear(),
      getItem: (key) => storage.get(key) ?? null,
      key: (index) => [...storage.keys()][index] ?? null,
      removeItem: (key) => storage.delete(key),
      setItem: (key, value) => storage.set(key, value),
    };
    const updated = updateTutorialProgress(
      emptyTutorialProgress(),
      welcomeTutorial,
      "in_progress",
      1,
      new Date("2026-07-18T00:00:00Z"),
    );

    saveTutorialProgress(updated, fakeStorage);

    expect(loadTutorialProgress(fakeStorage)).toEqual(updated);
    expect(fakeStorage.getItem(tutorialProgressStorageKey)).not.toBeNull();
  });

  it("教程版本变更时从安全的第一步恢复", () => {
    const oldProgress = updateTutorialProgress(
      emptyTutorialProgress(),
      welcomeTutorial,
      "completed",
      1,
    );
    const newVersion = {
      ...welcomeTutorial,
      contentVersion: welcomeTutorial.contentVersion + 1,
    };

    expect(entryForTutorial(oldProgress, newVersion)).toMatchObject({
      status: "not_started",
      stepIndex: 0,
    });
  });

  it("损坏的本地数据不会中断应用启动", () => {
    const storage = { getItem: () => "not-json" } as unknown as Storage;
    expect(loadTutorialProgress(storage)).toEqual(emptyTutorialProgress());
  });
});
