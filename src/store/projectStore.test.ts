import { beforeEach, describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { createTenSecondWorkshopProject } from "../journey/workshop";
import { useProjectStore } from "./projectStore";

function tempoBatch(tempo: number, label = "调整速度") {
  return {
    id: "10000000-0000-4000-8000-000000000001",
    source: "manual" as const,
    label,
    operations: [
      {
        id: "10000000-0000-4000-8000-000000000010",
        type: "setTempo" as const,
        scope: { kind: "whole" as const },
        args: { tempo },
      },
    ],
  };
}

describe("projectStore", () => {
  beforeEach(() => useProjectStore.getState().resetToBuiltInDemo());

  it("以经过校验的内置 demo 作为初始状态", () => {
    const state = useProjectStore.getState();
    expect(state.document.name).toBe("C minor 8-bar demo");
    expect(state.openResult.kind).toBe("editable");
    expect(state.isDirty).toBe(false);
  });

  it("从模板新建工程会替换文档并清空历史", () => {
    useProjectStore.getState().applyOperations(tempoBatch(130));

    useProjectStore.getState().createNewProject("blank");

    const state = useProjectStore.getState();
    expect(state.document.name).toBe("Untitled project");
    expect(state.document.sections[0]!.name).toBe("Idea");
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.isDirty).toBe(true);
  });

  it("创作工坊可替换为已校验的新工程，并从干净的可撤销历史开始", () => {
    useProjectStore.getState().applyOperations(tempoBatch(130));
    const workshop = createTenSecondWorkshopProject("bright");

    useProjectStore.getState().replaceWithNewProject(workshop);

    const state = useProjectStore.getState();
    expect(state.document).toEqual(workshop);
    expect(state.filePath).toBeNull();
    expect(state.lastSavedAt).toBeNull();
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
    expect(state.isDirty).toBe(true);
  });

  it("拒绝非法工程时保留当前有效文档，只记录只读诊断", () => {
    const originalId = useProjectStore.getState().document.id;
    const demo = getBuiltInDemo();
    const invalid = { ...demo, meta: { ...demo.meta, tempo: 300 } };

    const result = useProjectStore.getState().loadDocument(invalid);

    expect(result.kind).toBe("read_only_diagnostic");
    expect(useProjectStore.getState().document.id).toBe(originalId);
    expect(useProjectStore.getState().openResult.kind).toBe(
      "read_only_diagnostic",
    );
  });

  it("只在整个 OperationBatch 成功后一次替换文档", () => {
    const document = useProjectStore.getState().document;
    const result = useProjectStore.getState().applyOperations({
      id: "10000000-0000-4000-8000-000000000001",
      source: "manual",
      label: "改速后故意失败",
      operations: [
        {
          id: "10000000-0000-4000-8000-000000000010",
          type: "setTempo",
          scope: { kind: "whole" },
          args: { tempo: 130 },
        },
        {
          id: "10000000-0000-4000-8000-000000000011",
          type: "solo",
          scope: {
            kind: "track",
            trackId: "20000000-0000-4000-8000-000000000001",
          },
          args: { value: true },
        },
      ],
    });

    expect(result.applied).toBe(false);
    expect(useProjectStore.getState().document).toBe(document);
    expect(useProjectStore.getState().document.meta.tempo).toBe(120);
    expect(useProjectStore.getState().past).toHaveLength(0);
  });

  it("以成功 batch 为粒度撤销/重做，并在新提交后清空 future", () => {
    const store = useProjectStore.getState();
    const result = store.applyOperations(tempoBatch(130));

    expect(result.applied).toBe(true);
    expect(useProjectStore.getState().document.meta.tempo).toBe(130);
    expect(useProjectStore.getState().past).toHaveLength(1);
    expect(useProjectStore.getState().future).toHaveLength(0);
    expect(useProjectStore.getState().isDirty).toBe(true);

    expect(useProjectStore.getState().undo()).toBe(true);
    expect(useProjectStore.getState().document.meta.tempo).toBe(120);
    expect(useProjectStore.getState().past).toHaveLength(0);
    expect(useProjectStore.getState().future).toHaveLength(1);

    expect(useProjectStore.getState().redo()).toBe(true);
    expect(useProjectStore.getState().document.meta.tempo).toBe(130);

    expect(useProjectStore.getState().undo()).toBe(true);
    expect(
      useProjectStore.getState().applyOperations(tempoBatch(140)).applied,
    ).toBe(true);
    expect(useProjectStore.getState().document.meta.tempo).toBe(140);
    expect(useProjectStore.getState().future).toHaveLength(0);
    expect(useProjectStore.getState().redo()).toBe(false);
  });

  it("保存成功后记录路径与时间，并清除 dirty 而不改变历史", () => {
    useProjectStore.getState().applyOperations(tempoBatch(130));
    const current = useProjectStore.getState().document;
    const saved = {
      ...current,
      updatedAt: "2026-07-18T12:00:00.000Z",
    };

    useProjectStore.getState().markSaved(saved, "/tmp/demo.json");

    const state = useProjectStore.getState();
    expect(state.document.updatedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(state.filePath).toBe("/tmp/demo.json");
    expect(state.lastSavedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(state.isDirty).toBe(false);
    expect(state.past).toHaveLength(1);
  });

  it("打开已保存工程会替换文档、设置路径并清空历史", () => {
    useProjectStore.getState().applyOperations(tempoBatch(130));
    const document = getBuiltInDemo();
    document.name = "Opened project";

    useProjectStore.getState().openSavedProject(document, "/tmp/opened.json");

    const state = useProjectStore.getState();
    expect(state.document.name).toBe("Opened project");
    expect(state.filePath).toBe("/tmp/opened.json");
    expect(state.isDirty).toBe(false);
    expect(state.past).toHaveLength(0);
    expect(state.future).toHaveLength(0);
  });

  it("恢复副本会保留保存路径，但明确标记为未保存修改", () => {
    const document = getBuiltInDemo();

    useProjectStore
      .getState()
      .restoreRecoveredProject(
        document,
        "/tmp/recovered.json",
        "2026-07-18T12:00:00.000Z",
      );

    const state = useProjectStore.getState();
    expect(state.document).toEqual(document);
    expect(state.filePath).toBe("/tmp/recovered.json");
    expect(state.lastSavedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(state.isDirty).toBe(true);
    expect(state.past).toHaveLength(0);
  });

  it("将内存 history 限制在最近 50 个成功批次", () => {
    for (let index = 0; index < 55; index += 1) {
      const result = useProjectStore
        .getState()
        .applyOperations(
          tempoBatch(120 + (index % 2), `第 ${index + 1} 次改速`),
        );
      expect(result.applied).toBe(true);
    }

    expect(useProjectStore.getState().past).toHaveLength(50);
    expect(useProjectStore.getState().undo()).toBe(true);
    expect(useProjectStore.getState().future).toHaveLength(1);
  });

  it("将 trimAndSplit 范围删除作为单一 batch 撤销", () => {
    const document = useProjectStore.getState().document;
    const lead = document.tracks[2]!;
    const clip = document.clips.find((item) => item.trackId === lead.id)!;
    const originalNote = structuredClone(clip.notes[0]!);
    const result = useProjectStore.getState().applyOperations({
      id: "50000000-0000-4000-8000-000000000001",
      source: "manual",
      label: "删除中间范围",
      operations: [
        {
          id: "50000000-0000-4000-8000-000000000010",
          type: "removeNotesInRange",
          scope: { kind: "clip", trackId: lead.id, sectionId: clip.sectionId },
          args: {
            trackId: lead.id,
            sectionId: clip.sectionId,
            start: 0.25,
            end: 0.75,
            mode: "trimAndSplit",
            splitNoteIds: {
              [originalNote.id]: "50000000-0000-4000-8000-000000000011",
            },
          },
        },
      ],
    });

    expect(result.applied).toBe(true);
    expect(
      useProjectStore
        .getState()
        .document.clips.find((item) => item.id === clip.id)!.notes,
    ).toHaveLength(5);
    expect(useProjectStore.getState().undo()).toBe(true);
    expect(
      useProjectStore
        .getState()
        .document.clips.find((item) => item.id === clip.id)!.notes[0],
    ).toEqual(originalNote);
  });
});
