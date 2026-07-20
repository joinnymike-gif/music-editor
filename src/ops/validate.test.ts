import { describe, expect, it } from "vitest";
import { validateOperationBatch } from "./validate";

const ids = {
  batch: "70000000-0000-4000-8000-000000000001",
  operation: "70000000-0000-4000-8000-000000000002",
  section: "10000000-0000-4000-8000-000000000002",
  track: "20000000-0000-4000-8000-000000000001",
};

function validBatch() {
  return {
    id: ids.batch,
    source: "manual",
    label: "将速度改为 100 BPM",
    operations: [
      {
        id: ids.operation,
        type: "setTempo",
        scope: { kind: "whole" },
        args: { tempo: 100 },
      },
    ],
  };
}

describe("OperationBatch 结构校验", () => {
  it("接受带受支持来源、原语和 scope 的最小批次", () => {
    const result = validateOperationBatch(validBatch());

    expect(result.valid).toBe(true);
  });

  it("拒绝未知字段与未知原语", () => {
    const batch = validBatch();
    batch.operations[0]!.type = "directDocumentMutation";
    (batch as Record<string, unknown>).secret = "禁止进入工程";
    const result = validateOperationBatch(batch);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid)
      expect(result.errors.map((error) => error.code)).toEqual(
        expect.arrayContaining(["unknown_key", "enum"]),
      );
  });

  it("拒绝重复操作 ID 与不完整 clip scope", () => {
    const batch = validBatch();
    batch.operations.push({
      id: ids.operation,
      type: "transpose",
      scope: { kind: "clip", trackId: ids.track },
      args: { semitones: 1 },
    } as unknown as (typeof batch.operations)[number]);
    const result = validateOperationBatch(batch);

    expect(result).toMatchObject({ valid: false });
    if (!result.valid) {
      expect(result.errors.map((error) => error.path)).toEqual(
        expect.arrayContaining([
          "$.operations[1].id",
          "$.operations[1].scope.sectionId",
        ]),
      );
    }
  });
});
