import { existsSync, mkdirSync, statSync, writeFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { buildLocalNoteProposal } from "../agent/proposal";
import { compileM0PlaybackPlan } from "../audio/playbackPlan";
import { createWavFile } from "../export/wav";
import { applyOperationBatch } from "../ops/apply";
import type { ProjectDocument } from "../doc/types";
import { createCreativeJourney } from "./progress";
import {
  buildJourneyAiPrompt,
  buildLocalSectionExtension,
  createTenSecondWorkshopProject,
} from "./workshop";
import type { AudioSeed } from "./types";

const geminiApiKey = process.env.MUSIC_TASK_GEMINI_KEY;
const referencePath = "/Users/mydoczhang/Downloads/昼下がりの憂鬱.mp3";
const outputDirectory =
  "/Users/mydoczhang/GithubProject/music-editor/deliverables";
const outputPath = `${outputDirectory}/gemini-afternoon-piano-guitar.wav`;

const live = geminiApiKey ? describe : describe.skip;

live("Gemini 真实做首歌流程", () => {
  it("以本机参考摘要为方向，仅用钢琴与原声吉他生成、接受 AI 候选并导出可播放 WAV", async () => {
    expect(existsSync(referencePath)).toBe(true);
    const referenceSize = statSync(referencePath).size;
    expect(referenceSize).toBeGreaterThan(0);

    let project = restrictToPianoAndGuitar(
      createTenSecondWorkshopProject("relaxed"),
    );
    const brief = createCreativeJourney().brief;
    brief.mood = "relaxed";
    brief.style = "lofi";
    brief.energy = "contrast";
    brief.motifPolicy = "occasional";
    brief.length = "60s";
    brief.userCorrection =
      "以安静、温暖、略带午后忧郁的器乐氛围为方向；不要复制参考的旋律、歌词、音色或结构。仅使用钢琴和原声吉他：钢琴做稀疏和声，原声吉他演奏 AI 生成的原创主旋律。前半舒缓，后半轻微推进，保持原创。";
    brief.audioSeeds = [referenceAudioSeed(referenceSize)];

    for (const section of project.sections.slice(1)) {
      const lead = project.tracks.find((track) => track.role === "lead");
      if (!lead) throw new Error("工坊工程缺少主旋律轨道。");
      const prompt = buildJourneyAiPrompt(project, section.id, brief);
      const candidate = await requestValidatedGeminiCandidate({
        project,
        target: { trackId: lead.id, sectionId: section.id },
        prompt,
        sectionBeats: section.bars * 4,
      });

      const accepted = applyOperationBatch(project, candidate.proposal.batch);
      expect(accepted.applied).toBe(true);
      if (!accepted.applied)
        throw new Error(
          accepted.errors.map((error) => error.message).join("；"),
        );
      project = accepted.document;

      const accompaniment = buildLocalSectionExtension(
        project,
        section.id,
        brief,
      );
      expect(accompaniment).not.toBeNull();
      const extended = applyOperationBatch(project, accompaniment!);
      expect(extended.applied).toBe(true);
      if (!extended.applied)
        throw new Error(
          extended.errors.map((error) => error.message).join("；"),
        );
      project = extended.document;
    }

    const plan = compileM0PlaybackPlan(project);
    expect(plan.ok).toBe(true);
    if (!plan.ok)
      throw new Error(plan.errors.map((error) => error.message).join("；"));
    expect(plan.plan.events.length).toBeGreaterThan(60);
    expect(
      new Set(plan.plan.events.map((event) => event.instrument.id)),
    ).toEqual(new Set(["acoustic_piano", "acoustic_guitar"]));

    const wav = await createWavFile(project);
    const samples = new Int16Array(wav.buffer.slice(44));
    expect(samples.some((sample) => sample !== 0)).toBe(true);
    mkdirSync(outputDirectory, { recursive: true });
    writeFileSync(outputPath, wav);
    expect(statSync(outputPath).size).toBeGreaterThan(44);
  }, 120_000);
});

function referenceAudioSeed(byteLength: number): AudioSeed {
  return {
    id: "80000000-0000-4000-8000-000000000001",
    fileName: "昼下がりの憂鬱.mp3",
    localPath: referencePath,
    byteLength,
    contentHash: `local-reference-${byteLength}`,
    purpose: "mood",
    weight: 5,
    selectedRangeLabel: "整段约 3 分 40 秒",
    analysis: {
      durationSeconds: 219.9,
      energy: "balanced",
      brightness: "warm",
      energyArc: "steady",
      summary:
        "昼下がりの憂鬱.mp3：约 3 分 40 秒，整体能量平衡、偏温暖，呈现安静的午后忧郁感。此摘要仅作整体感觉参考，不包含或要求复制旋律、歌词、音色或结构。",
    },
  };
}

function restrictToPianoAndGuitar(project: ProjectDocument): ProjectDocument {
  const piano = project.tracks.find((track) => track.role === "harmony");
  const guitar = project.tracks.find((track) => track.role === "lead");
  if (!piano || !guitar) throw new Error("工坊工程缺少钢琴或旋律轨道。 ");
  piano.name = "午后钢琴";
  piano.instrument = "acoustic_piano";
  guitar.name = "原声吉他旋律";
  guitar.instrument = "acoustic_guitar";
  project.tracks = [piano, guitar];
  const allowedTrackIds = new Set(project.tracks.map((track) => track.id));
  project.clips = project.clips.filter((clip) =>
    allowedTrackIds.has(clip.trackId),
  );
  project.automation = project.automation.filter((lane) =>
    allowedTrackIds.has(lane.trackId),
  );
  project.name = "午后忧郁：钢琴与吉他";
  return project;
}

async function requestGeminiNotes({
  prompt,
  sectionBeats,
  contextNotes,
}: {
  prompt: string;
  sectionBeats: number;
  contextNotes: Array<{
    start: number;
    dur: number;
    pitch: number;
    vel: number;
  }>;
}) {
  const response = await fetch(
    "https://generativelanguage.googleapis.com/v1beta/interactions",
    {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-goog-api-key": geminiApiKey!,
      },
      body: JSON.stringify({
        model: "gemini-flash-lite-latest",
        store: false,
        system_instruction: `You create a small MIDI-note proposal for a music editor. Return only JSON. Keep summary concise (at most 120 characters). Generate 4–16 original sparse lead notes. Do not copy any reference melody, lyrics, audio, timbre, or structure. Every note must satisfy start >= 0, dur >= 0.0625, and start + dur <= sectionBeats. Notes must stay inside the selected section. Selected scope: ${JSON.stringify({ sectionBeats, role: "lead", tempo: 120, key: "C", mode: "major", strategy: "replace", contextNotes })}`,
        input: prompt,
        response_format: {
          type: "text",
          mime_type: "application/json",
          schema: {
            type: "object",
            required: ["summary", "notes"],
            properties: {
              summary: { type: "string", minLength: 1, maxLength: 300 },
              notes: {
                type: "array",
                maxItems: 64,
                items: {
                  type: "object",
                  required: ["start", "dur", "pitch", "vel"],
                  properties: {
                    start: { type: "number" },
                    dur: { type: "number" },
                    pitch: { type: "integer", minimum: 0, maximum: 127 },
                    vel: { type: "integer", minimum: 1, maximum: 127 },
                  },
                },
              },
            },
          },
        },
        generation_config: { max_output_tokens: 800 },
      }),
    },
  );
  if (!response.ok)
    throw new Error(`Gemini 请求失败（HTTP ${response.status}）。`);
  const body = (await response.json()) as {
    output_text?: unknown;
    steps?: Array<{
      type?: unknown;
      content?: Array<{ type?: unknown; text?: unknown }>;
    }>;
  };
  const text =
    typeof body.output_text === "string"
      ? body.output_text
      : body.steps
          ?.find((step) => step.type === "model_output")
          ?.content?.find(
            (content) =>
              content.type === "text" && typeof content.text === "string",
          )?.text;
  if (typeof text !== "string")
    throw new Error("Gemini 未返回可解析的候选文本。");
  return JSON.parse(text) as {
    summary: string;
    notes: Array<{ start: number; dur: number; pitch: number; vel: number }>;
  };
}

async function requestValidatedGeminiCandidate({
  project,
  target,
  prompt,
  sectionBeats,
}: {
  project: ProjectDocument;
  target: { trackId: string; sectionId: string };
  prompt: string;
  sectionBeats: number;
}) {
  let lastMessage = "Gemini 未返回可写入的候选。";
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    const remoteProposal = await requestGeminiNotes({
      prompt:
        attempt === 1
          ? prompt
          : `${prompt}\n上一个候选没有通过本地节拍边界校验。请重新生成，确保每个音符 start + dur 不超过 ${sectionBeats}。`,
      sectionBeats,
      contextNotes: [],
    });
    const candidate = buildLocalNoteProposal(
      project,
      target,
      "replace",
      remoteProposal,
    );
    if (candidate.ok) return candidate;
    lastMessage = candidate.message;
  }
  throw new Error(`Gemini 连续 3 次返回无效候选：${lastMessage}`);
}
