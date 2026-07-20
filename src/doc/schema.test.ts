import { describe, expect, it } from "vitest";
import invalidNoteBoundary from "./fixtures/invalid-note-boundary.json";
import invalidReference from "./fixtures/invalid-reference.json";
import invalidSchemaVersion from "./fixtures/invalid-schema-version.json";
import validProject from "./fixtures/valid-project-v1.json";
import { getBuiltInDemo } from "./demo";
import { validateProjectDocument } from "./schema";

function clone<T>(value: T): T {
  return structuredClone(value);
}

function invalidPaths(value: unknown): string[] {
  const result = validateProjectDocument(value);
  return result.valid ? [] : result.errors.map((error) => error.path);
}

describe("ProjectDocument schema v1", () => {
  it("接受完整的 8 小节三轨 demo，并由同一校验器提供内置工程", () => {
    const result = validateProjectDocument(validProject);

    expect(result.valid).toBe(true);
    expect(getBuiltInDemo()).toMatchObject({
      meta: { tempo: 120, key: "C", mode: "minor", timeSig: [4, 4] },
    });
    expect(getBuiltInDemo().sections).toHaveLength(1);
    expect(getBuiltInDemo().sections[0]?.bars).toBe(8);
    expect(getBuiltInDemo().tracks.map((track) => track.role)).toEqual([
      "harmony",
      "bass",
      "lead",
    ]);
  });

  it("拒绝版本、引用与 section 边界 fixture，并返回字段路径", () => {
    expect(invalidPaths(invalidSchemaVersion)).toContain("$.schemaVersion");
    expect(invalidPaths(invalidReference)).toContain("$.clips[0].trackId");
    expect(invalidPaths(invalidNoteBoundary)).toContain("$.clips[0].notes[0]");
  });

  it("覆盖工程级、结构、音符与 automation 约束", () => {
    const cases: Array<{
      name: string;
      mutate: (project: Record<string, any>) => void;
      path: string;
    }> = [
      {
        name: "tempo",
        mutate: (project) => {
          project.meta.tempo = 241;
        },
        path: "$.meta.tempo",
      },
      {
        name: "time signature",
        mutate: (project) => {
          project.meta.timeSig = [3, 4];
        },
        path: "$.meta.timeSig",
      },
      {
        name: "duplicate persistent id",
        mutate: (project) => {
          project.tracks[0].id = project.sections[0].id;
        },
        path: "$.tracks[0].id",
      },
      {
        name: "duplicate clip tuple",
        mutate: (project) => {
          project.clips[1].trackId = project.clips[0].trackId;
        },
        path: "$.clips[1]",
      },
      {
        name: "unordered notes",
        mutate: (project) => {
          project.clips[2].notes.reverse();
        },
        path: "$.clips[2].notes[1]",
      },
      {
        name: "invalid note velocity",
        mutate: (project) => {
          project.clips[2].notes[0].vel = 0;
        },
        path: "$.clips[2].notes[0].vel",
      },
      {
        name: "unknown automation track",
        mutate: (project) => {
          project.automation[0].trackId =
            "00000000-0000-4000-8000-000000000099";
        },
        path: "$.automation[0].trackId",
      },
      {
        name: "unordered automation",
        mutate: (project) => {
          project.automation[0].points[1].at = 0;
        },
        path: "$.automation[0].points[1].at",
      },
    ];

    for (const testCase of cases) {
      const project = clone(validProject) as Record<string, any>;
      testCase.mutate(project);
      expect(invalidPaths(project), testCase.name).toContain(testCase.path);
    }
  });

  it("不会静默修正排序或非法输入", () => {
    const project = clone(validProject) as Record<string, any>;
    project.clips[2].notes[0].pitch = 200;
    const snapshot = JSON.stringify(project);

    validateProjectDocument(project);

    expect(JSON.stringify(project)).toBe(snapshot);
  });
});
