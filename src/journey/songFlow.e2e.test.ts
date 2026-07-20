import { existsSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLocalNoteProposal } from "../agent/proposal";
import { compileM0PlaybackPlan } from "../audio/playbackPlan";
import { createMidiFile } from "../export/midi";
import { createWavFile } from "../export/wav";
import { applyOperationBatch } from "../ops/apply";
import type { OperationBatch } from "../ops/types";
import { createCreativeJourney } from "./progress";
import {
  buildJourneyAiPrompt,
  buildLocalSectionExtension,
  createTenSecondWorkshopProject,
} from "./workshop";
import type { JourneyEnergy, JourneyMood, JourneyStyle } from "./types";

const exportedWorkshopWav = "/private/tmp/ai-music-ide-workshop-e2e.wav";
const exportedLocalOnlyWav = "/private/tmp/ai-music-ide-local-manual-e2e.wav";

function apply(
  project: ReturnType<typeof createTenSecondWorkshopProject>,
  batch: OperationBatch,
) {
  const result = applyOperationBatch(project, batch);
  expect(result.applied).toBe(true);
  if (!result.applied)
    throw new Error(result.errors.map((error) => error.message).join("；"));
  return result.document;
}

describe("做首歌闭环（本地端到端）", () => {
  it("每一种感觉、风格、发展方向都能形成安全的 AI 指令，不含参考文件路径", () => {
    const moods: JourneyMood[] = ["relaxed", "bright", "powerful"];
    const styles: JourneyStyle[] = ["lofi", "pop", "electronic", "game"];
    const energies: JourneyEnergy[] = ["steady", "build", "contrast"];

    for (const mood of moods) {
      const project = createTenSecondWorkshopProject(mood);
      for (const style of styles) {
        for (const energy of energies) {
          const brief = createCreativeJourney().brief;
          brief.mood = mood;
          brief.style = style;
          brief.energy = energy;
          const prompt = buildJourneyAiPrompt(
            project,
            project.sections[1]!.id,
            brief,
          );
          expect(prompt).toContain(
            "只为当前选定轨道和段落生成可编辑 MIDI 音符",
          );
          expect(prompt).toContain("没有外部音频参考");
          expect(prompt).not.toContain("/");
        }
      }
    }
  });

  it("完全不调用 AI 时，本机扩展和 Piano Roll 微调也能导出可听到的真实 WAV", async () => {
    let project = createTenSecondWorkshopProject("relaxed");
    const brief = createCreativeJourney().brief;
    brief.mood = "relaxed";
    brief.style = "lofi";
    brief.energy = "steady";

    // The entire arrangement comes from the local deterministic extension.
    // No AI proposal is constructed, requested or accepted in this path.
    for (const section of project.sections.slice(1)) {
      const batch = buildLocalSectionExtension(project, section.id, brief);
      expect(batch).not.toBeNull();
      project = apply(project, batch!);
    }

    const lead = project.tracks.find((track) => track.role === "lead")!;
    const targetSection = project.sections[2]!;
    const localManualBatch: OperationBatch = {
      id: "30000000-0000-4000-8000-000000000001",
      source: "manual",
      label: "Piano Roll 本地微调收束音",
      operations: [
        {
          id: "30000000-0000-4000-8000-000000000002",
          type: "insertNotes",
          scope: {
            kind: "clip",
            trackId: lead.id,
            sectionId: targetSection.id,
          },
          args: {
            trackId: lead.id,
            sectionId: targetSection.id,
            notes: [
              {
                id: "30000000-0000-4000-8000-000000000003",
                start: 14,
                dur: 1.5,
                pitch: 72,
                vel: 94,
              },
            ],
          },
        },
      ],
    };
    project = apply(project, localManualBatch);

    const plan = compileM0PlaybackPlan(project);
    expect(plan.ok).toBe(true);
    if (!plan.ok)
      throw new Error(plan.errors.map((error) => error.message).join("；"));
    expect(plan.plan.events.length).toBeGreaterThan(100);

    const wav = await createWavFile(project);
    const samples = new Int16Array(wav.buffer.slice(44));
    expect(samples.some((sample) => sample > 0)).toBe(true);
    expect(samples.some((sample) => sample < 0)).toBe(true);
    expect(
      samples.reduce((peak, sample) => Math.max(peak, Math.abs(sample)), 0),
    ).toBeGreaterThan(24_000);
    writeFileSync(exportedLocalOnlyWav, wav);
    expect(existsSync(exportedLocalOnlyWav)).toBe(true);
  }, 30_000);

  it("从 10 秒开场经本机扩展、AI 候选接受和手工微调，导出非静音 MIDI/WAV", async () => {
    let project = createTenSecondWorkshopProject("bright");
    const brief = createCreativeJourney().brief;
    brief.mood = "bright";
    brief.style = "electronic";
    brief.energy = "build";
    brief.motifPolicy = "occasional";

    // 本机扩展的每一段均写入三个可编辑轨道，覆盖“不使用 AI”的主路径。
    for (const section of project.sections.slice(1)) {
      const batch = buildLocalSectionExtension(project, section.id, brief);
      expect(batch).not.toBeNull();
      project = apply(project, batch!);
    }
    expect(project.clips).toHaveLength(
      project.sections.length * project.tracks.length,
    );

    // AI 只产生候选；本地校验和显式接受后才会写入工程。
    const lead = project.tracks.find((track) => track.role === "lead")!;
    const targetSection = project.sections[2]!;
    const candidate = buildLocalNoteProposal(
      project,
      { trackId: lead.id, sectionId: targetSection.id },
      "replace",
      {
        summary: "让中段旋律更明亮地上行",
        notes: [
          { start: 0, dur: 1, pitch: 72, vel: 92 },
          { start: 2, dur: 1, pitch: 76, vel: 96 },
        ],
      },
    );
    expect(candidate.ok).toBe(true);
    if (!candidate.ok) throw new Error(candidate.message);
    project = apply(project, candidate.proposal.batch);

    // 手工修改与 AI 候选一样走受校验、可撤销的 operation batch。
    const manualBatch: OperationBatch = {
      id: "20000000-0000-4000-8000-000000000001",
      source: "manual",
      label: "手工加一个收束音",
      operations: [
        {
          id: "20000000-0000-4000-8000-000000000002",
          type: "insertNotes",
          scope: {
            kind: "clip",
            trackId: lead.id,
            sectionId: project.sections[4]!.id,
          },
          args: {
            trackId: lead.id,
            sectionId: project.sections[4]!.id,
            notes: [
              {
                id: "20000000-0000-4000-8000-000000000003",
                start: 0,
                dur: 2,
                pitch: 72,
                vel: 88,
              },
            ],
          },
        },
      ],
    };
    project = apply(project, manualBatch);

    const plan = compileM0PlaybackPlan(project);
    expect(plan.ok).toBe(true);
    if (!plan.ok)
      throw new Error(plan.errors.map((error) => error.message).join("；"));
    expect(plan.plan.events.length).toBeGreaterThan(100);

    const midi = createMidiFile(project);
    expect(asciiAt(midi, 0, 4)).toBe("MThd");
    expect(midi.length).toBeGreaterThan(200);

    const wav = await createWavFile(project);
    expect(asciiAt(wav, 0, 4)).toBe("RIFF");
    expect(asciiAt(wav, 8, 4)).toBe("WAVE");
    const samples = new Int16Array(wav.buffer.slice(44));
    const peak = samples.reduce(
      (current, sample) => Math.max(current, Math.abs(sample)),
      0,
    );
    expect(peak).toBeGreaterThan(0);
    writeFileSync(exportedWorkshopWav, wav);
    expect(existsSync(exportedWorkshopWav)).toBe(true);
  }, 30_000);
});

function asciiAt(bytes: Uint8Array, start: number, length: number): string {
  return new TextDecoder().decode(bytes.slice(start, start + length));
}
