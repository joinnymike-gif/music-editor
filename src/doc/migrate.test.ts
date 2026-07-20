import { describe, expect, it } from "vitest";
import validProject from "./fixtures/valid-project-v1.json";
import { openProjectDocument } from "./migrate";

describe("工程版本打开策略", () => {
  it("将有效 v1 工程以可编辑状态打开", () => {
    const result = openProjectDocument(validProject);
    expect(result.kind).toBe("editable");
  });

  it("将未来版本保留为原始只读诊断，且可导出备份", () => {
    const future = { ...validProject, schemaVersion: "9.0" };
    const result = openProjectDocument(future);

    expect(result).toMatchObject({
      kind: "read_only_diagnostic",
      raw: future,
      sourceVersion: "9.0",
      recovery: "export_raw_backup",
    });
  });

  it("不把同版本但非法的工程伪装成可编辑文档", () => {
    const invalid = {
      ...validProject,
      meta: { ...validProject.meta, tempo: 300 },
    };
    const result = openProjectDocument(invalid);

    expect(result.kind).toBe("read_only_diagnostic");
    if (result.kind === "read_only_diagnostic")
      expect(result.errors[0]?.path).toBe("$.meta.tempo");
  });
});
