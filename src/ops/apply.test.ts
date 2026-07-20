import { describe, expect, it } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import type { OperationBatch } from "./types";
import { applyOperationBatch } from "./apply";

const batchId = "10000000-0000-4000-8000-000000000001";
const operationIds = [
  "10000000-0000-4000-8000-000000000010",
  "10000000-0000-4000-8000-000000000011",
  "10000000-0000-4000-8000-000000000012",
  "10000000-0000-4000-8000-000000000013",
];

function createBatch(): OperationBatch {
  const document = getBuiltInDemo();
  return {
    id: batchId,
    source: "manual",
    label: "调整全局设置和 lead 混音",
    operations: [
      {
        id: operationIds[0]!,
        type: "setTempo",
        scope: { kind: "whole" },
        args: { tempo: 128 },
      },
      {
        id: operationIds[1]!,
        type: "setKey",
        scope: { kind: "whole" },
        args: { key: "D#", mode: "minor" },
      },
      {
        id: operationIds[2]!,
        type: "setVolume",
        scope: { kind: "track", trackId: document.tracks[2]!.id },
        args: { volume: 0.42 },
      },
      {
        id: operationIds[3]!,
        type: "mute",
        scope: { kind: "track", trackId: document.tracks[2]!.id },
        args: { value: true },
      },
    ],
  };
}

describe("applyOperationBatch", () => {
  it("在深拷贝上顺序模拟已实现原语，并返回受影响对象", () => {
    const document = getBuiltInDemo();
    const result = applyOperationBatch(document, createBatch());

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(document.meta.tempo).toBe(120);
    expect(result.document.meta).toMatchObject({
      tempo: 128,
      key: "D#",
      mode: "minor",
    });
    expect(result.document.tracks[2]).toMatchObject({ vol: 0.42, mute: true });
    expect(result.affected).toEqual({
      wholeProject: true,
      trackIds: [document.tracks[2]!.id, document.tracks[2]!.id],
      sectionIds: [],
      createdNoteIds: [],
      trimmedNoteIds: [],
      removedNoteIds: [],
      removedAutomationPoints: 0,
      mergedAutomationPoints: 0,
    });
  });

  it("任一操作失败时不返回部分文档", () => {
    const document = getBuiltInDemo();
    const batch = createBatch();
    batch.operations[2]!.scope = {
      kind: "track",
      trackId: "20000000-0000-4000-8000-000000000001",
    };

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(false);
    if (result.applied) return;
    expect(result.errors[0]).toMatchObject({
      code: "reference",
      operationId: operationIds[2],
    });
    expect(document.meta.tempo).toBe(120);
    expect(document.tracks[2]!.vol).toBe(0.62);
  });

  it("拒绝未列出参数、错误作用域和未知原语", () => {
    const document = getBuiltInDemo();
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        args: { tempo: 128, ignored: true },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "unknown_key" }],
    });

    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "notARealOperation" as never,
        args: {},
      },
    ];
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "enum" }],
    });
  });

  it("transpose 只移动 scope 内的非鼓组音符，并且不移动工程调性", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const firstLeadPitch = document.clips.find(
      (clip) => clip.trackId === lead.id,
    )!.notes[0]!.pitch;
    const firstDrumPitch = document.clips.find(
      (clip) => clip.trackId === document.tracks[0]!.id,
    )!.notes[0]!.pitch;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "transpose",
        scope: { kind: "track", trackId: lead.id },
        args: { semitones: 2 },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.meta.key).toBe("C");
    expect(
      result.document.clips.find((clip) => clip.trackId === lead.id)!.notes[0]!
        .pitch,
    ).toBe(firstLeadPitch + 2);
    expect(
      result.document.clips.find(
        (clip) => clip.trackId === document.tracks[0]!.id,
      )!.notes[0]!.pitch,
    ).toBe(firstDrumPitch);
    expect(result.affected).toMatchObject({ trackIds: [lead.id] });
  });

  it("changeKey 原子地转置并更新同 mode 的调性，越界或不一致时失败", () => {
    const document = getBuiltInDemo();
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "changeKey",
        scope: { kind: "whole" },
        args: { key: "D", mode: "minor", semitones: 2 },
      },
    ];

    let result = applyOperationBatch(document, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.meta).toMatchObject({ key: "D", mode: "minor" });
    expect(result.document.clips[1]!.notes[0]!.pitch).toBe(38);

    batch.operations[0]!.args = { key: "D#", mode: "minor", semitones: 2 };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "key_mismatch" }],
    });
    expect(document.meta.key).toBe("C");
  });

  it("halfTime 和 doubleTime 在 section 内缩放所有目标音符", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "halfTime",
        scope: { kind: "track", trackId: lead.id },
        args: {},
      },
    ];

    let result = applyOperationBatch(document, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const halfTimeNotes = result.document.clips.find(
      (clip) => clip.trackId === lead.id,
    )!.notes;
    expect(halfTimeNotes.map((note) => [note.start, note.dur])).toEqual([
      [0, 2],
      [2, 2],
      [4, 2],
      [6, 2],
    ]);

    batch.operations[0]!.type = "doubleTime";
    result = applyOperationBatch(document, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.find((clip) => clip.trackId === lead.id)!.notes[1],
    ).toMatchObject({ start: 0.5, dur: 0.5 });
  });

  it("时间缩放在最小时值或 section 边界无法满足时整批失败", () => {
    const document = getBuiltInDemo();
    document.clips[1]!.notes[3]!.start = 16;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "doubleTime",
        scope: { kind: "track", trackId: document.tracks[0]!.id },
        args: {},
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "time_boundary" }],
    });

    batch.operations[0]!.type = "halfTime";
    batch.operations[0]!.scope = {
      kind: "track",
      trackId: document.tracks[1]!.id,
    };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "time_boundary" }],
    });
    expect(document.clips[1]!.notes[3]).toMatchObject({ start: 16, dur: 4 });
  });

  it("quantize 只吸附起点、排序 notes，并保留时值", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    leadClip.notes[0]!.start = 0.26;
    leadClip.notes[1]!.start = 1.24;
    leadClip.notes[2]!.start = 2.26;
    leadClip.notes[3]!.start = 3.24;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "quantize",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: { grid: 0.5 },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.find((clip) => clip.id === leadClip.id)!.notes,
    ).toMatchObject([
      { start: 0.5, dur: 1 },
      { start: 1, dur: 1 },
      { start: 2.5, dur: 1 },
      { start: 3, dur: 1 },
    ]);
  });

  it("quantize 拒绝未知网格和会越出 section 的吸附结果", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    leadClip.notes = [{ ...leadClip.notes[0]!, start: 31.7, dur: 0.25 }];
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "quantize",
        scope: { kind: "track", trackId: lead.id },
        args: { grid: 1 },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "section_boundary" }],
    });

    batch.operations[0]!.args = { grid: 0.125 };
    result = applyOperationBatch(getBuiltInDemo(), batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "enum" }],
    });
  });

  it("setVelocity 只修改目标 scope 的音符力度", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "setVelocity",
        scope: { kind: "track", trackId: lead.id },
        args: { velocity: 64 },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips
        .find((clip) => clip.trackId === lead.id)!
        .notes.map((note) => note.vel),
    ).toEqual([64, 64, 64, 64]);
    expect(result.document.clips[0]!.notes[0]!.vel).toBe(110);
  });

  it("setVelocity 拒绝非整数、越界和未列出参数", () => {
    const document = getBuiltInDemo();
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "setVelocity",
        scope: { kind: "whole" },
        args: { velocity: 127.5 },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "range" }],
    });

    batch.operations[0]!.args = { velocity: 128 };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "range" }],
    });

    batch.operations[0]!.args = { velocity: 80, extra: true };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "unknown_key" }],
    });
  });

  it("humanize 使用 seed 产生可重放的时值不变结果", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "humanize",
        scope: { kind: "track", trackId: lead.id },
        args: { seed: 42, timing: 0.1, velocity: 8 },
      },
    ];

    const first = applyOperationBatch(document, batch);
    const second = applyOperationBatch(document, batch);

    expect(first.applied).toBe(true);
    expect(second.applied).toBe(true);
    if (!first.applied || !second.applied) return;
    const firstNotes = first.document.clips.find(
      (clip) => clip.trackId === lead.id,
    )!.notes;
    const secondNotes = second.document.clips.find(
      (clip) => clip.trackId === lead.id,
    )!.notes;
    expect(secondNotes).toEqual(firstNotes);
    expect(firstNotes.map((note) => note.dur)).toEqual([1, 1, 1, 1]);
    expect(
      firstNotes.some((note) => note.start % 1 !== 0 || note.vel !== 96),
    ).toBe(true);
  });

  it("humanize 参数非法或产生越界结果时不写入", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    leadClip.notes = [{ ...leadClip.notes[0]!, start: 0, dur: 1 }];
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "humanize",
        scope: { kind: "track", trackId: lead.id },
        args: { seed: 0, timing: 0.25, velocity: 0 },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "humanize_boundary" }],
    });
    expect(leadClip.notes[0]!.start).toBe(0);

    batch.operations[0]!.args = { seed: -1, timing: 0, velocity: 0 };
    result = applyOperationBatch(getBuiltInDemo(), batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "range" }],
    });
  });

  it("upsertClip 和 insertNotes 用调用方生成的新 ID 替换并插入音符", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const firstId = "30000000-0000-4000-8000-000000000001";
    const secondId = "30000000-0000-4000-8000-000000000002";
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "upsertClip",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: {
          clipId: leadClip.id,
          notes: [{ id: firstId, start: 2, dur: 1, pitch: 72, vel: 100 }],
        },
      },
      {
        ...batch.operations[1]!,
        type: "insertNotes",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: {
          trackId: lead.id,
          sectionId: leadClip.sectionId,
          notes: [{ id: secondId, start: 0, dur: 1, pitch: 60, vel: 90 }],
        },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.find((clip) => clip.id === leadClip.id)!.notes,
    ).toMatchObject([
      { id: secondId, start: 0, pitch: 60 },
      { id: firstId, start: 2, pitch: 72 },
    ]);
  });

  it("removeClip 后可以以全新 clip ID 创建相同位置的 clip", () => {
    const document = getBuiltInDemo();
    const bass = document.tracks[1]!;
    const bassClip = document.clips.find((clip) => clip.trackId === bass.id)!;
    const clipId = "30000000-0000-4000-8000-000000000003";
    const noteId = "30000000-0000-4000-8000-000000000004";
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeClip",
        scope: {
          kind: "clip",
          trackId: bass.id,
          sectionId: bassClip.sectionId,
        },
        args: {},
      },
      {
        ...batch.operations[1]!,
        type: "upsertClip",
        scope: {
          kind: "clip",
          trackId: bass.id,
          sectionId: bassClip.sectionId,
        },
        args: {
          clipId,
          notes: [{ id: noteId, start: 0, dur: 4, pitch: 36, vel: 100 }],
        },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.find((clip) => clip.trackId === bass.id),
    ).toMatchObject({ id: clipId, notes: [{ id: noteId }] });
  });

  it("replaceClipNotes 拒绝旧 ID 和与 scope 不一致的目标", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "replaceClipNotes",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: {
          trackId: lead.id,
          sectionId: leadClip.sectionId,
          notes: [{ ...leadClip.notes[0]! }],
        },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "duplicate" }],
    });

    batch.operations[0]!.args = {
      trackId: document.tracks[0]!.id,
      sectionId: leadClip.sectionId,
      notes: [],
    };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "scope_mismatch" }],
    });
  });

  it("updateNotes 和 removeNotes 只按 note ID 操作且遵守 scope", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const removeId = leadClip.notes[0]!.id;
    const updateId = leadClip.notes[1]!.id;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "updateNotes",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: { changes: [{ noteId: updateId, pitch: 65, vel: 80 }] },
      },
      {
        ...batch.operations[1]!,
        type: "removeNotes",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: { noteIds: [removeId] },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    const notes = result.document.clips.find(
      (clip) => clip.id === leadClip.id,
    )!.notes;
    expect(notes.find((note) => note.id === removeId)).toBeUndefined();
    expect(notes.find((note) => note.id === updateId)).toMatchObject({
      pitch: 65,
      vel: 80,
    });

    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "updateNotes",
        scope: { kind: "track", trackId: document.tracks[0]!.id },
        args: { changes: [{ noteId: updateId, pitch: 60 }] },
      },
    ];
    expect(applyOperationBatch(document, batch)).toMatchObject({
      applied: false,
      errors: [{ code: "reference" }],
    });
  });

  it("removeNotesInRange 处理全删、两侧截短和跨范围拆分", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const [fullId, leftId, crossingId, rightId, splitId] = [
      "40000000-0000-4000-8000-000000000001",
      "40000000-0000-4000-8000-000000000002",
      "40000000-0000-4000-8000-000000000003",
      "40000000-0000-4000-8000-000000000004",
      "40000000-0000-4000-8000-000000000005",
    ];
    leadClip.notes = [
      { id: leftId, start: 1, dur: 2, pitch: 60, vel: 90 },
      { id: crossingId, start: 1, dur: 4, pitch: 65, vel: 90 },
      { id: fullId, start: 2, dur: 1, pitch: 67, vel: 90 },
      { id: rightId, start: 3, dur: 2, pitch: 70, vel: 90 },
    ];
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeNotesInRange",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: {
          trackId: lead.id,
          sectionId: leadClip.sectionId,
          start: 2,
          end: 4,
          mode: "trimAndSplit",
          splitNoteIds: { [crossingId]: splitId },
        },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.clips.find((clip) => clip.id === leadClip.id)!.notes,
    ).toMatchObject([
      { id: leftId, start: 1, dur: 1 },
      { id: crossingId, start: 1, dur: 1 },
      { id: splitId, start: 4, dur: 1 },
      { id: rightId, start: 4, dur: 1 },
    ]);
    expect(result.affected).toMatchObject({
      removedNoteIds: [fullId],
      trimmedNoteIds: [leftId, crossingId, rightId],
      createdNoteIds: [splitId],
    });
  });

  it("removeNotesInRange 拒绝缺少、额外或重复的 split ID", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const crossingId = leadClip.notes[0]!.id;
    leadClip.notes = [{ ...leadClip.notes[0]!, start: 1, dur: 4 }];
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeNotesInRange",
        scope: {
          kind: "clip",
          trackId: lead.id,
          sectionId: leadClip.sectionId,
        },
        args: {
          trackId: lead.id,
          sectionId: leadClip.sectionId,
          start: 2,
          end: 4,
          mode: "trimAndSplit",
          splitNoteIds: {},
        },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "required" }],
    });

    batch.operations[0]!.args = {
      ...batch.operations[0]!.args,
      splitNoteIds: { [crossingId]: crossingId },
    };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "duplicate" }],
    });
  });

  it("addTrack 只接受注册表兼容的乐器，并初始化默认混音状态", () => {
    const document = getBuiltInDemo();
    const trackId = "60000000-0000-4000-8000-000000000001";
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "addTrack",
        scope: { kind: "whole" },
        args: {
          trackId,
          name: "Pad",
          role: "pad",
          instrument: "violin",
          volume: 0.6,
        },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(
      result.document.tracks.find((track) => track.id === trackId),
    ).toEqual({
      id: trackId,
      name: "Pad",
      role: "pad",
      instrument: "violin",
      vol: 0.6,
      mute: false,
      solo: false,
    });
  });

  it("removeTrack 级联删除该轨的 clips、automation 和受影响 notes", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const leadClip = document.clips.find((clip) => clip.trackId === lead.id)!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeTrack",
        scope: { kind: "track", trackId: lead.id },
        args: {},
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.tracks.some((track) => track.id === lead.id)).toBe(
      false,
    );
    expect(result.document.clips.some((clip) => clip.trackId === lead.id)).toBe(
      false,
    );
    expect(
      result.document.automation.some((lane) => lane.trackId === lead.id),
    ).toBe(false);
    expect(result.affected.removedNoteIds).toEqual(
      leadClip.notes.map((note) => note.id),
    );
  });

  it("setInstrument 允许明确的合成主音，拒绝不兼容、缺少实录的鼓组、未知乐器以及删除最后一条轨道", () => {
    const document = getBuiltInDemo();
    const harmony = document.tracks[0]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "setInstrument",
        scope: { kind: "track", trackId: harmony.id },
        args: { instrument: "finger_bass" },
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "instrument_role" }],
    });

    batch.operations[0]!.args = { instrument: "square_lead" };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({ applied: true });

    batch.operations[0]!.args = { instrument: "acoustic_kit" };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "instrument_role" }],
    });

    batch.operations[0]!.args = { instrument: "not_in_registry" };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "instrument_missing" }],
    });

    document.tracks = [harmony];
    document.clips = document.clips.filter(
      (clip) => clip.trackId === harmony.id,
    );
    document.automation = [];
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeTrack",
        scope: { kind: "track", trackId: harmony.id },
        args: {},
      },
    ];
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "min_items" }],
    });
  });

  it("addSection 和 reorderSections 以 section 相对 beat 重排 automation", () => {
    const document = getBuiltInDemo();
    const firstSection = document.sections[0]!;
    const secondSectionId = "70000000-0000-4000-8000-000000000001";
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "addSection",
        scope: { kind: "whole" },
        args: {
          sectionId: secondSectionId,
          name: "Outro",
          bars: 4,
          afterSectionId: firstSection.id,
        },
      },
    ];
    const added = applyOperationBatch(document, batch);
    expect(added.applied).toBe(true);
    if (!added.applied) return;

    batch.operations[0] = {
      ...batch.operations[0]!,
      type: "extendSection",
      scope: { kind: "section", sectionId: secondSectionId },
      args: { bars: 5 },
    };
    const extended = applyOperationBatch(added.document, batch);
    expect(extended.applied).toBe(true);
    if (!extended.applied) return;

    batch.operations[0] = {
      ...batch.operations[0]!,
      type: "reorderSections",
      scope: { kind: "whole" },
      args: { sectionIds: [secondSectionId, firstSection.id] },
    };
    const reordered = applyOperationBatch(extended.document, batch);

    expect(reordered.applied).toBe(true);
    if (!reordered.applied) return;
    expect(reordered.document.sections.map((section) => section.id)).toEqual([
      secondSectionId,
      firstSection.id,
    ]);
    expect(reordered.document.automation[0]!.points).toEqual([
      { at: 20, val: 0.7 },
      { at: 36, val: 0.8 },
    ]);
  });

  it("shrinkSection 以 trim 截短/删除 notes 与超出范围的 automation", () => {
    const document = getBuiltInDemo();
    const section = document.sections[0]!;
    const leadClip = document.clips.find(
      (clip) => clip.trackId === document.tracks[2]!.id,
    )!;
    const [kept, trimmed, removed] = leadClip.notes;
    kept!.start = 3;
    kept!.dur = 3;
    trimmed!.start = 6;
    trimmed!.dur = 4;
    removed!.start = 10;
    removed!.dur = 1;
    leadClip.notes = [kept!, trimmed!, removed!];
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "shrinkSection",
        scope: { kind: "section", sectionId: section.id },
        args: { bars: 2, overflow: "trim" },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.sections[0]!.bars).toBe(2);
    expect(
      result.document.clips.find((clip) => clip.id === leadClip.id)!.notes,
    ).toMatchObject([
      { id: kept!.id, start: 3, dur: 3 },
      { id: trimmed!.id, start: 6, dur: 2 },
    ]);
    expect(result.document.automation[0]!.points).toEqual([
      { at: 0, val: 0.7 },
    ]);
    expect(result.affected).toMatchObject({
      trimmedNoteIds: [trimmed!.id],
      removedAutomationPoints: 1,
    });
    expect(result.affected.removedNoteIds).toEqual(
      expect.arrayContaining([
        removed!.id,
        "00000000-0000-4000-8000-000000000052",
      ]),
    );
  });

  it("removeSection 级联 clips/notes/automation 并拒绝删除最后一段", () => {
    const document = getBuiltInDemo();
    const section = document.sections[0]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeSection",
        scope: { kind: "section", sectionId: section.id },
        args: {},
      },
    ];
    let result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "min_items" }],
    });

    const secondSectionId = "70000000-0000-4000-8000-000000000002";
    document.sections.push({ id: secondSectionId, name: "Tail", bars: 4 });
    result = applyOperationBatch(document, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.sections.map((item) => item.id)).toEqual([
      secondSectionId,
    ]);
    expect(result.document.clips).toEqual([]);
    expect(result.document.automation[0]!.points).toEqual([]);
    expect(result.affected.removedNoteIds).toHaveLength(12);
    expect(result.affected.removedAutomationPoints).toBe(2);
  });

  it("upsertAutomationPoints 合并同 lane 同 beat，并按全局 beat 排序", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "upsertAutomationPoints",
        scope: { kind: "track", trackId: lead.id },
        args: {
          param: "volume",
          points: [
            { at: 16, val: 0.9 },
            { at: 20, val: 0.3 },
            { at: 20, val: 0.4 },
          ],
        },
      },
    ];

    const result = applyOperationBatch(document, batch);

    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.automation[0]!.points).toEqual([
      { at: 0, val: 0.7 },
      { at: 16, val: 0.9 },
      { at: 20, val: 0.4 },
    ]);
    expect(result.affected.mergedAutomationPoints).toBe(2);
  });

  it("removeAutomationPoints 原子删除指定点并拒绝不存在或重复的 at", () => {
    const document = getBuiltInDemo();
    const lead = document.tracks[2]!;
    const batch = createBatch();
    batch.operations = [
      {
        ...batch.operations[0]!,
        type: "removeAutomationPoints",
        scope: { kind: "track", trackId: lead.id },
        args: { param: "volume", ats: [0, 16] },
      },
    ];

    let result = applyOperationBatch(document, batch);
    expect(result.applied).toBe(true);
    if (!result.applied) return;
    expect(result.document.automation[0]!.points).toEqual([]);
    expect(result.affected.removedAutomationPoints).toBe(2);

    batch.operations[0]!.args = { param: "volume", ats: [0, 0] };
    result = applyOperationBatch(document, batch);
    expect(result).toMatchObject({
      applied: false,
      errors: [{ code: "duplicate" }],
    });
  });
});
