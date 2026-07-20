import { beforeEach, describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import {
  discardRecoverySnapshot,
  loadRecoverySnapshot,
  recoveryStorageKey,
  saveRecoverySnapshot,
} from "./recovery";

describe("本地恢复副本", () => {
  let storage: Storage;

  beforeEach(() => {
    storage = fakeStorage();
  });

  it("只保存可校验的工程及本地文件元数据", () => {
    const document = getBuiltInDemo();
    saveRecoverySnapshot(
      {
        document,
        filePath: "/tmp/demo.json",
        lastSavedAt: "2026-07-18T00:00:00.000Z",
        capturedAt: "2026-07-18T00:00:02.000Z",
      },
      storage,
    );

    expect(loadRecoverySnapshot(storage)).toEqual({
      document,
      filePath: "/tmp/demo.json",
      lastSavedAt: "2026-07-18T00:00:00.000Z",
      capturedAt: "2026-07-18T00:00:02.000Z",
    });
  });

  it("丢弃损坏副本，且不把它暴露为可恢复工程", () => {
    storage.setItem(recoveryStorageKey, "{not-json");

    expect(loadRecoverySnapshot(storage)).toBeNull();
    expect(storage.getItem(recoveryStorageKey)).toBeNull();
  });

  it("允许用户主动丢弃恢复副本", () => {
    saveRecoverySnapshot(
      {
        document: getBuiltInDemo(),
        filePath: null,
        lastSavedAt: null,
        capturedAt: "2026-07-18T00:00:02.000Z",
      },
      storage,
    );
    discardRecoverySnapshot(storage);

    expect(loadRecoverySnapshot(storage)).toBeNull();
  });
});

function fakeStorage(): Storage {
  const values = new Map<string, string>();
  return {
    get length() {
      return values.size;
    },
    clear: () => values.clear(),
    getItem: (key) => values.get(key) ?? null,
    key: (index) => [...values.keys()][index] ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}
