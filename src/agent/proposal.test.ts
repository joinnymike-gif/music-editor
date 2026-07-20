import { describe, expect, it } from "vitest";
import { createProject } from "../doc/templates";
import { buildLocalNoteProposal, projectFingerprint } from "./proposal";

describe("buildLocalNoteProposal", () => {
  it("turns an untrusted notes response into a simulated replace batch", () => {
    const project = createProject("blank");
    const target = {
      trackId: project.tracks[0].id,
      sectionId: project.sections[0].id,
    };
    const result = buildLocalNoteProposal(project, target, "replace", {
      summary: "候选旋律",
      notes: [{ start: 0, dur: 1, pitch: 60, vel: 90 }],
    });

    expect(result).toMatchObject({
      ok: true,
      proposal: {
        noteCount: 1,
        batch: { source: "agent", operations: [{ type: "upsertClip" }] },
      },
    });
    if (result.ok)
      expect(result.proposal.simulatedDocument.clips[0].notes).toHaveLength(1);
  });

  it("rejects a candidate outside the selected section before any batch is exposed", () => {
    const project = createProject("blank");
    const result = buildLocalNoteProposal(
      project,
      { trackId: project.tracks[0].id, sectionId: project.sections[0].id },
      "replace",
      {
        summary: "越界候选",
        notes: [{ start: 31.5, dur: 1, pitch: 60, vel: 90 }],
      },
    );

    expect(result).toEqual({
      ok: false,
      message: "候选的第 1 个音符无效，未写入工程。",
    });
  });

  it("captures the exact source document fingerprint for a later accept check", () => {
    const project = createProject("blank");
    const result = buildLocalNoteProposal(
      project,
      { trackId: project.tracks[0].id, sectionId: project.sections[0].id },
      "replace",
      { summary: "候选", notes: [] },
    );

    if (!result.ok) throw new Error(result.message);
    expect(result.proposal.sourceDocumentFingerprint).toBe(
      projectFingerprint(project),
    );
    const edited = structuredClone(project);
    edited.meta.tempo = 121;
    expect(result.proposal.sourceDocumentFingerprint).not.toBe(
      projectFingerprint(edited),
    );
  });

  it("保留最长 300 字的候选摘要，同时将可撤销批次标题限制为 120 字", () => {
    const project = createProject("blank");
    const result = buildLocalNoteProposal(
      project,
      { trackId: project.tracks[0].id, sectionId: project.sections[0].id },
      "replace",
      { summary: "很长的候选说明".repeat(35), notes: [] },
    );

    expect(result.ok).toBe(true);
    if (!result.ok) throw new Error(result.message);
    expect(result.proposal.summary.length).toBeGreaterThan(120);
    expect(result.proposal.batch.label.length).toBeLessThanOrEqual(120);
    expect(result.proposal.batch.label).toMatch(/^AI 候选：.*…$/);
  });
});
