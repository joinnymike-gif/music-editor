import { describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import {
  parseProjectDocument,
  prepareProjectForSave,
  serializeProjectDocument,
} from "./projectCodec";

describe("projectCodec", () => {
  it("以可读 JSON 序列化并恢复有效工程", () => {
    const document = getBuiltInDemo();
    const text = serializeProjectDocument(document);

    expect(text).toContain('\n  "schemaVersion"');
    expect(parseProjectDocument(text)).toEqual(document);
  });

  it("保存前只更新 updatedAt，并再次运行 Schema 校验", () => {
    const document = getBuiltInDemo();
    const saved = prepareProjectForSave(
      document,
      new Date("2026-07-18T12:00:00.000Z"),
    );

    expect(saved.updatedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(document.updatedAt).toBe("2026-07-18T00:00:00.000Z");
  });

  it("拒绝损坏 JSON 和不符合 Schema 的工程", () => {
    expect(() => parseProjectDocument("{bad")).toThrow("有效 JSON");
    expect(() =>
      parseProjectDocument(
        JSON.stringify({ ...getBuiltInDemo(), schemaVersion: "2.0" }),
      ),
    ).toThrow("工程校验失败");
  });
});
