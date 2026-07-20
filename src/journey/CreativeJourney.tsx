import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ProjectDocument } from "../doc/types";
import type { OperationBatch } from "../ops/types";
import {
  chooseAudioSeedCandidates,
  createAudioSeedFromCandidate,
  maxSelectedAudioSeedSeconds,
  previewAudioSeedCandidate,
  updateAudioSeed,
  type PendingAudioSeed,
} from "./audioSeed";
import {
  buildJourneyAiPrompt,
  buildLocalSectionExtension,
  createSongPlan,
  workshopLengthSeconds,
} from "./workshop";
import type {
  CreativeBrief,
  CreativeJourney,
  JourneyMood,
  JourneyStage,
  SeedPurpose,
} from "./types";

type PianoRollTarget = { trackId: string; sectionId: string };

export interface JourneyAiRequest {
  target: PianoRollTarget;
  prompt: string;
}

const rhythmPattern = ["q", "w", "e", "r", "t"] as const;

const stages: Array<{ id: JourneyStage; label: string }> = [
  { id: "rhythm", label: "热身" },
  { id: "workshop", label: "10 秒" },
  { id: "audio-seeds", label: "参考" },
  { id: "brief", label: "方向" },
  { id: "plan", label: "路线" },
  { id: "extend", label: "扩展" },
  { id: "manual-edit", label: "微调" },
  { id: "export", label: "导出" },
];

const previousStage: Partial<Record<JourneyStage, JourneyStage>> = {
  workshop: "rhythm",
  "audio-seeds": "workshop",
  brief: "audio-seeds",
  plan: "brief",
  extend: "plan",
  "manual-edit": "extend",
  export: "manual-edit",
  completed: "export",
};

export function CreativeJourneyScreen({
  project,
  journey,
  onJourneyChange,
  onCreateWorkshop,
  onApplyLength,
  onTapScaleKey,
  audioError,
  onSubmitOperations,
  onOpenAi,
  onOpenManualEdit,
  onOpenExport,
}: {
  project: ProjectDocument;
  journey: CreativeJourney;
  onJourneyChange: (journey: CreativeJourney) => void;
  onCreateWorkshop: (mood: JourneyMood) => void;
  onApplyLength: (length: CreativeBrief["length"]) => boolean;
  /** Resolves only after the user gesture has actually scheduled a note. */
  onTapScaleKey: (key: string) => Promise<void>;
  /** Audio failures must be visible in the current learning step, not only Demo. */
  audioError: string | null;
  onSubmitOperations: (batch: OperationBatch) => boolean;
  onOpenAi: (request: JourneyAiRequest) => void;
  onOpenManualEdit: (target: PianoRollTarget) => void;
  onOpenExport: () => void;
}) {
  const [rhythmIndex, setRhythmIndex] = useState(0);
  const [audioConsent, setAudioConsent] = useState(false);
  const [isImporting, setImporting] = useState(false);
  const [pendingAudioSeeds, setPendingAudioSeeds] = useState<
    PendingAudioSeed[]
  >([]);
  const [previewingSeedId, setPreviewingSeedId] = useState<string | null>(null);
  const [isRhythmAuditioning, setRhythmAuditioning] = useState(false);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const previewStopRef = useRef<(() => void) | null>(null);
  const previewTokenRef = useRef<string | null>(null);
  const plan = useMemo(() => createSongPlan(project), [project]);
  const nextPlanStep = plan.find(
    (step) =>
      step.id !== journey.seedSectionId &&
      !journey.completedSectionIds.includes(step.id),
  );

  const update = (updates: Partial<CreativeJourney>) => {
    onJourneyChange({ ...journey, ...updates });
  };
  const updateBrief = (updates: Partial<CreativeBrief>) => {
    update({ brief: { ...journey.brief, ...updates } });
  };
  const advance = (stage: JourneyStage) => {
    setError(null);
    setMessage(null);
    update({ stage });
  };
  const goBack = () => {
    const previous = previousStage[journey.stage];
    if (previous) advance(previous);
  };
  const handleRhythmKey = useCallback(
    async (key: string) => {
      if (isRhythmAuditioning) return;
      setRhythmAuditioning(true);
      try {
        // Do not mark a learner's key as complete until Web Audio has accepted
        // the note. Previously this was fire-and-forget: failures were silent
        // on this page while the yellow progress state implied it had played.
        await onTapScaleKey(key);
      } catch (cause) {
        setError(
          cause instanceof Error
            ? `未能试听 ${key.toUpperCase()}：${cause.message}`
            : `未能试听 ${key.toUpperCase()}，请检查系统输出设备后重试。`,
        );
        return;
      } finally {
        setRhythmAuditioning(false);
      }
      const expected = rhythmPattern[rhythmIndex];
      if (key !== expected) {
        setRhythmIndex(0);
        setMessage("没关系，从 do 开始再试一次：Q W E R T。");
        return;
      }
      const following = rhythmIndex + 1;
      if (following === rhythmPattern.length) {
        setRhythmIndex(following);
        setMessage("完成！你刚刚用音阶做出了一句上行旋律。");
        return;
      }
      setRhythmIndex(following);
      setMessage(`很好，下一键是 ${rhythmPattern[following]!.toUpperCase()}。`);
    },
    [isRhythmAuditioning, onTapScaleKey, rhythmIndex],
  );

  useEffect(() => {
    if (journey.stage !== "rhythm") return;
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        event.repeat ||
        event.metaKey ||
        event.ctrlKey ||
        event.altKey ||
        (target instanceof HTMLElement &&
          target.matches("input, textarea, select, [contenteditable='true']"))
      ) {
        return;
      }
      const key = event.key.toLowerCase();
      if (!rhythmPattern.includes(key as (typeof rhythmPattern)[number]))
        return;
      event.preventDefault();
      void handleRhythmKey(key);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [handleRhythmKey, journey.stage]);
  useEffect(
    () => () => {
      previewStopRef.current?.();
      previewStopRef.current = null;
      previewTokenRef.current = null;
    },
    [],
  );
  const handleChooseAudio = async () => {
    if (!audioConsent) {
      setError("请先确认：原始音频只留在本机，AI 只会看到你确认的文字摘要。");
      return;
    }
    try {
      setImporting(true);
      setError(null);
      const candidates = await chooseAudioSeedCandidates(
        journey.brief.audioSeeds.length,
      );
      if (candidates.length) {
        previewStopRef.current?.();
        previewStopRef.current = null;
        previewTokenRef.current = null;
        setPreviewingSeedId(null);
        setPendingAudioSeeds(candidates);
        setMessage(
          `已读取 ${candidates.length} 个本机文件。请在时间轴上选择要保留的片段，试听后再确认导入。`,
        );
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "导入音频参考失败，请重试。",
      );
    } finally {
      setImporting(false);
    }
  };
  const updatePendingAudioRange = (
    candidateId: string,
    endpoint: "start" | "end",
    value: number,
  ) => {
    setPendingAudioSeeds((current) =>
      current.map((candidate) => {
        if (candidate.id !== candidateId) return candidate;
        const duration = candidate.buffer.duration;
        const minimumClip = Math.min(1, duration);
        let startSeconds = candidate.startSeconds;
        let endSeconds = candidate.endSeconds;
        if (endpoint === "start") {
          startSeconds = Math.min(
            Math.max(0, value),
            Math.max(0, duration - minimumClip),
          );
          endSeconds = Math.min(
            duration,
            Math.max(
              startSeconds + minimumClip,
              Math.min(startSeconds + maxSelectedAudioSeedSeconds, endSeconds),
            ),
          );
        } else {
          endSeconds = Math.min(
            duration,
            Math.max(
              startSeconds + minimumClip,
              Math.min(value, startSeconds + maxSelectedAudioSeedSeconds),
            ),
          );
        }
        return { ...candidate, startSeconds, endSeconds };
      }),
    );
  };
  const handlePreview = async (candidate: PendingAudioSeed) => {
    if (previewingSeedId === candidate.id) {
      previewStopRef.current?.();
      previewStopRef.current = null;
      previewTokenRef.current = null;
      setPreviewingSeedId(null);
      return;
    }
    previewStopRef.current?.();
    const token = crypto.randomUUID();
    previewTokenRef.current = token;
    setPreviewingSeedId(candidate.id);
    try {
      const stop = await previewAudioSeedCandidate(candidate, () => {
        if (previewTokenRef.current !== token) return;
        previewStopRef.current = null;
        previewTokenRef.current = null;
        setPreviewingSeedId(null);
      });
      if (previewTokenRef.current !== token) {
        stop();
        return;
      }
      previewStopRef.current = stop;
    } catch (cause) {
      if (previewTokenRef.current === token) {
        previewTokenRef.current = null;
        previewStopRef.current = null;
        setPreviewingSeedId(null);
      }
      setError(
        cause instanceof Error ? cause.message : "试听片段失败，请重试。",
      );
    }
  };
  const handleConfirmAudioImport = () => {
    if (!pendingAudioSeeds.length) return;
    try {
      const seeds = pendingAudioSeeds.map(createAudioSeedFromCandidate);
      previewStopRef.current?.();
      previewStopRef.current = null;
      previewTokenRef.current = null;
      setPreviewingSeedId(null);
      updateBrief({ audioSeeds: [...journey.brief.audioSeeds, ...seeds] });
      setPendingAudioSeeds([]);
      setError(null);
      setMessage(
        `已导入 ${seeds.length} 个所选片段，并仅在本机生成可检查的文字摘要。`,
      );
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "导入所选片段失败，请重试。",
      );
    }
  };
  const handleLocalExtension = () => {
    if (!nextPlanStep) {
      advance("manual-edit");
      return;
    }
    const batch = buildLocalSectionExtension(
      project,
      nextPlanStep.id,
      journey.brief,
    );
    if (!batch) {
      update({
        completedSectionIds: [...journey.completedSectionIds, nextPlanStep.id],
      });
      return;
    }
    if (onSubmitOperations(batch)) {
      update({
        completedSectionIds: [...journey.completedSectionIds, nextPlanStep.id],
      });
      setMessage(
        `已用本地引导扩展“${nextPlanStep.sectionName}”。它是一个可撤销的编辑批次。`,
      );
    }
  };
  const handleAiExtension = () => {
    if (!nextPlanStep) {
      advance("manual-edit");
      return;
    }
    const leadTrack = project.tracks.find((track) => track.role === "lead");
    if (!leadTrack) {
      setError("当前工程没有主旋律轨道，无法打开 AI 扩展。请先手工添加轨道。");
      return;
    }
    onOpenAi({
      target: { trackId: leadTrack.id, sectionId: nextPlanStep.id },
      prompt: buildJourneyAiPrompt(project, nextPlanStep.id, journey.brief),
    });
  };
  const handleBuildPlan = () => {
    if (onApplyLength(journey.brief.length)) advance("plan");
  };
  const leadTrack = project.tracks.find((track) => track.role === "lead");
  const manualSection =
    nextPlanStep?.id ?? journey.seedSectionId ?? project.sections[0]?.id;
  const activeIndex = stages.findIndex((item) => item.id === journey.stage);

  return (
    <section className="journey-page" data-tutorial="creative-journey">
      <header className="journey-header">
        <p className="eyebrow">新手创作旅程</p>
        <h1>从 10 秒灵感，做出你的第一首歌</h1>
        <p>
          每一步都只做一件小事。你始终可以回到编排、Piano Roll 或 AI Chat
          修改，任何 AI 结果都必须由你接受后才会写入工程。
        </p>
        <ol className="journey-progress" aria-label="创作进度">
          {stages.map((item, index) => (
            <li
              key={item.id}
              className={index <= activeIndex ? "is-active" : undefined}
            >
              {index + 1}. {item.label}
            </li>
          ))}
        </ol>
      </header>

      {previousStage[journey.stage] && (
        <div className="journey-back-row">
          <button type="button" onClick={goBack}>
            ← 返回上一步
          </button>
          <span>已填写的选择会保留，不会删除当前工程或已完成的段落。</span>
        </div>
      )}

      {journey.stage === "rhythm" && (
        <section className="panel journey-card">
          <p className="eyebrow">1 分钟热身</p>
          <h2>用 Q W E R T 做一句上行旋律</h2>
          <p>
            不需要懂乐理。do、re、mi、fa、sol
            就像一串由低到高的台阶；点击或按下正确按键，听见音高一点点上升即可。
          </p>
          <div className="journey-keys" aria-label="音阶热身按键">
            {rhythmPattern.map((key, index) => (
              <button
                key={key}
                className={index < rhythmIndex ? "is-complete" : undefined}
                type="button"
                onClick={() => void handleRhythmKey(key)}
                disabled={isRhythmAuditioning}
              >
                {key.toUpperCase()}
              </button>
            ))}
          </div>
          <p className="journey-status" role="status">
            {message ??
              `从 Q 开始。进度 ${Math.min(rhythmIndex, rhythmPattern.length)}/${rhythmPattern.length}`}
          </p>
          {audioError && (
            <p className="audio-error" role="alert">
              音频不可用：{audioError}
            </p>
          )}
          <button
            className="primary-button"
            type="button"
            disabled={rhythmIndex !== rhythmPattern.length}
            onClick={() => advance("workshop")}
          >
            我听懂了，开始做 10 秒音乐
          </button>
        </section>
      )}

      {journey.stage === "workshop" && (
        <section className="panel journey-card">
          <p className="eyebrow">第一个小作品</p>
          <h2>选择一个感觉，立即得到可编辑的 10 秒开场</h2>
          <p>
            这会新建“我的第一首歌”，包含鼓点、低音和旋律。之后的所有扩展都会从这段原创开场出发。
          </p>
          <div className="journey-choice-grid">
            {(
              [
                ["relaxed", "放松", "慢慢摇头，温暖地开始"],
                ["bright", "轻快", "明亮向上，像出门散步"],
                ["powerful", "有力量", "更有冲劲，适合推进"],
              ] as const
            ).map(([mood, title, description]) => (
              <button
                key={mood}
                type="button"
                className={
                  journey.brief.mood === mood ? "is-selected" : undefined
                }
                onClick={() => updateBrief({ mood })}
              >
                <strong>{title}</strong>
                <span>{description}</span>
              </button>
            ))}
          </div>
          <button
            className="primary-button"
            type="button"
            onClick={() => onCreateWorkshop(journey.brief.mood)}
          >
            创建我的 10 秒音乐
          </button>
        </section>
      )}

      {journey.stage === "audio-seeds" && (
        <section className="panel journey-card">
          <p className="eyebrow">可选：给音乐一个参考</p>
          <h2>导入 1–3 段音频，告诉我们你喜欢什么</h2>
          <p>
            支持 WAV、MP3、M4A、AIFF（每个源文件最多 40
            MB）。长音频也可以选择：先在时间轴保留不超过 45
            秒的片段，试听满意后再导入。应用只在本机截取并提取“节奏、能量、明暗”等摘要；原始音频、文件路径和内容不会发送给
            AI。
          </p>
          <label className="journey-consent">
            <input
              type="checkbox"
              checked={audioConsent}
              onChange={(event) => setAudioConsent(event.target.checked)}
            />
            我理解原始音频仅保留在这台 Mac；以后发送给 AI
            的仅是我确认过的文字摘要。
          </label>
          <div className="journey-actions">
            <button
              className="primary-button"
              type="button"
              disabled={
                isImporting ||
                journey.brief.audioSeeds.length + pendingAudioSeeds.length >= 3
              }
              onClick={() => void handleChooseAudio()}
            >
              {isImporting ? "正在读取本机音频…" : "选择音频文件"}
            </button>
            <button type="button" onClick={() => advance("brief")}>
              暂不导入，继续
            </button>
          </div>
          {pendingAudioSeeds.map((candidate) => {
            const clipDuration = candidate.endSeconds - candidate.startSeconds;
            const duration = candidate.buffer.duration;
            const minimumClip = Math.min(1, duration);
            return (
              <article className="audio-seed-selection" key={candidate.id}>
                <div>
                  <strong>{candidate.fileName}</strong>
                  <p>
                    原始时长 {formatTimeline(candidate.buffer.duration)}
                    。拖动两端或填写时间，保留 1–
                    {maxSelectedAudioSeedSeconds} 秒。
                  </p>
                </div>
                <div
                  className="audio-seed-timeline"
                  aria-label={`${candidate.fileName} 时间轴`}
                >
                  <div className="audio-seed-range-labels">
                    <span>开始 {formatTimeline(candidate.startSeconds)}</span>
                    <strong>保留 {formatTimeline(clipDuration)}</strong>
                    <span>结束 {formatTimeline(candidate.endSeconds)}</span>
                  </div>
                  <label>
                    片段开始
                    <input
                      aria-label={`${candidate.fileName} 片段开始`}
                      type="range"
                      min="0"
                      max={Math.max(0, duration - minimumClip)}
                      step="0.1"
                      value={candidate.startSeconds}
                      onChange={(event) =>
                        updatePendingAudioRange(
                          candidate.id,
                          "start",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    片段结束
                    <input
                      aria-label={`${candidate.fileName} 片段结束`}
                      type="range"
                      min={candidate.startSeconds + minimumClip}
                      max={Math.min(
                        duration,
                        candidate.startSeconds + maxSelectedAudioSeedSeconds,
                      )}
                      step="0.1"
                      value={candidate.endSeconds}
                      onChange={(event) =>
                        updatePendingAudioRange(
                          candidate.id,
                          "end",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                </div>
                <div className="audio-seed-time-inputs">
                  <label>
                    从（秒）
                    <input
                      aria-label={`${candidate.fileName} 从秒`}
                      type="number"
                      min="0"
                      max={Math.max(0, duration - minimumClip)}
                      step="0.1"
                      value={Number(candidate.startSeconds.toFixed(1))}
                      onChange={(event) =>
                        updatePendingAudioRange(
                          candidate.id,
                          "start",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <label>
                    到（秒）
                    <input
                      aria-label={`${candidate.fileName} 到秒`}
                      type="number"
                      min={candidate.startSeconds + minimumClip}
                      max={Math.min(
                        duration,
                        candidate.startSeconds + maxSelectedAudioSeedSeconds,
                      )}
                      step="0.1"
                      value={Number(candidate.endSeconds.toFixed(1))}
                      onChange={(event) =>
                        updatePendingAudioRange(
                          candidate.id,
                          "end",
                          Number(event.target.value),
                        )
                      }
                    />
                  </label>
                  <button
                    type="button"
                    onClick={() => void handlePreview(candidate)}
                  >
                    {previewingSeedId === candidate.id
                      ? "停止试听"
                      : "试听所选片段"}
                  </button>
                </div>
              </article>
            );
          })}
          {pendingAudioSeeds.length > 0 && (
            <div className="journey-actions">
              <button
                className="primary-button"
                type="button"
                onClick={handleConfirmAudioImport}
              >
                导入所选片段（仅本机处理）
              </button>
              <button
                type="button"
                onClick={() => {
                  previewStopRef.current?.();
                  previewStopRef.current = null;
                  previewTokenRef.current = null;
                  setPreviewingSeedId(null);
                  setPendingAudioSeeds([]);
                }}
              >
                取消本次选择
              </button>
            </div>
          )}
          {journey.brief.audioSeeds.map((seed) => (
            <article className="audio-seed-card" key={seed.id}>
              <strong>{seed.fileName}</strong>
              <p>
                已选 {seed.selectedRangeLabel}。{seed.analysis.summary}
              </p>
              <label>
                我想参考它的
                <select
                  value={seed.purpose}
                  onChange={(event) =>
                    updateBrief({
                      audioSeeds: journey.brief.audioSeeds.map((item) =>
                        item.id === seed.id
                          ? updateAudioSeed(item, {
                              purpose: event.target.value as SeedPurpose,
                            })
                          : item,
                      ),
                    })
                  }
                >
                  <option value="mood">整体感觉</option>
                  <option value="rhythm">节奏感觉</option>
                  <option value="timbre">声音感觉</option>
                  <option value="structure">结构感觉</option>
                </select>
              </label>
              <label>
                重要程度（1–5）
                <input
                  type="range"
                  min="1"
                  max="5"
                  value={seed.weight}
                  onChange={(event) =>
                    updateBrief({
                      audioSeeds: journey.brief.audioSeeds.map((item) =>
                        item.id === seed.id
                          ? updateAudioSeed(item, {
                              weight: Number(event.target.value),
                            })
                          : item,
                      ),
                    })
                  }
                />
                {seed.weight}
              </label>
              <button
                type="button"
                onClick={() =>
                  updateBrief({
                    audioSeeds: journey.brief.audioSeeds.filter(
                      (item) => item.id !== seed.id,
                    ),
                  })
                }
              >
                移除参考
              </button>
            </article>
          ))}
          {journey.brief.audioSeeds.length > 0 && (
            <button
              className="primary-button"
              type="button"
              onClick={() => advance("brief")}
            >
              确认这些参考，继续
            </button>
          )}
        </section>
      )}

      {journey.stage === "brief" && (
        <section className="panel journey-card">
          <p className="eyebrow">用日常语言定方向</p>
          <h2>回答几个问题，让扩展更像你想要的歌</h2>
          <div className="journey-form-grid">
            <ChoiceField
              label="风格"
              value={journey.brief.style}
              onChange={(style) =>
                updateBrief({ style: style as CreativeBrief["style"] })
              }
              options={[
                ["lofi", "Lo-fi"],
                ["pop", "流行"],
                ["electronic", "电子"],
                ["game", "游戏配乐"],
              ]}
            />
            <ChoiceField
              label="接下来怎么发展"
              value={journey.brief.energy}
              onChange={(energy) =>
                updateBrief({ energy: energy as CreativeBrief["energy"] })
              }
              options={[
                ["steady", "保持平稳"],
                ["build", "越来越热闹"],
                ["contrast", "中间变化一下"],
              ]}
            />
            <ChoiceField
              label="10 秒旋律要多常出现"
              value={journey.brief.motifPolicy}
              onChange={(motifPolicy) =>
                updateBrief({
                  motifPolicy: motifPolicy as CreativeBrief["motifPolicy"],
                })
              }
              options={[
                ["featured", "一直是主角"],
                ["occasional", "偶尔出现"],
                ["intro-only", "只当开场"],
              ]}
            />
            <ChoiceField
              label="成品长度"
              value={journey.brief.length}
              onChange={(length) =>
                updateBrief({ length: length as CreativeBrief["length"] })
              }
              options={[
                ["30s", "约 30 秒"],
                ["60s", "约 1 分钟"],
                ["120s", "约 2 分钟"],
              ]}
            />
          </div>
          <label className="journey-textarea">
            还有什么想补充？（可选）
            <textarea
              value={journey.brief.userCorrection}
              maxLength={280}
              onChange={(event) =>
                updateBrief({ userCorrection: event.target.value })
              }
              placeholder="例如：不要太伤感，鼓点不要太密。"
            />
          </label>
          <button
            className="primary-button"
            type="button"
            onClick={handleBuildPlan}
          >
            生成我的创作路线图
          </button>
        </section>
      )}

      {journey.stage === "plan" && (
        <section className="panel journey-card">
          <p className="eyebrow">你掌控的路线图</p>
          <h2>
            从 10 秒开场到约 {workshopLengthSeconds(journey.brief.length)}{" "}
            秒成品
          </h2>
          <ol className="song-plan">
            {plan.map((step) => (
              <li key={step.id}>
                <strong>{step.sectionName}</strong>
                <span aria-label={`能量 ${step.energyLevel}/5`}>
                  {"●".repeat(step.energyLevel)}
                  {"○".repeat(5 - step.energyLevel)}
                </span>
                <p>{step.description}</p>
              </li>
            ))}
          </ol>
          <p className="journey-note">
            本机引导会逐段建立可编辑 MIDI；如果配置了 Gemini 或
            OpenAI，也可以只为当前段落生成 AI 候选。
          </p>
          <button
            className="primary-button"
            type="button"
            onClick={() => advance("extend")}
          >
            开始逐段扩展
          </button>
        </section>
      )}

      {journey.stage === "extend" && (
        <section className="panel journey-card">
          <p className="eyebrow">逐段扩展，随时可撤销</p>
          {nextPlanStep ? (
            <>
              <h2>下一段：{nextPlanStep.sectionName}</h2>
              <p>{nextPlanStep.description}</p>
              <p>
                你可以先用本机引导生成一个可编辑的基础版本，再到 Piano Roll
                修改；或者使用 AI 生成候选，确认后才会写入工程。
              </p>
              <div className="journey-actions">
                <button
                  className="primary-button"
                  type="button"
                  onClick={handleLocalExtension}
                >
                  用本机引导扩展这一段
                </button>
                <button type="button" onClick={handleAiExtension}>
                  用 AI 生成候选
                </button>
              </div>
            </>
          ) : (
            <>
              <h2>所有段落都已完成</h2>
              <p>你已经拥有一首有开场、展开、变化、高潮和收束的可编辑作品。</p>
              <button
                className="primary-button"
                type="button"
                onClick={() => advance("manual-edit")}
              >
                去做最后微调
              </button>
            </>
          )}
        </section>
      )}

      {journey.stage === "manual-edit" && (
        <section className="panel journey-card">
          <p className="eyebrow">让它真正成为你的作品</p>
          <h2>最后改一个音符或一个片段</h2>
          <p>
            打开 Piano Roll
            后，可以点击格子新增、移动或删除音符。若暂时不想改，也可以直接导出；整个工程仍可随时回来继续编辑。
          </p>
          <div className="journey-actions">
            <button
              className="primary-button"
              type="button"
              disabled={!leadTrack || !manualSection}
              onClick={() =>
                leadTrack &&
                manualSection &&
                onOpenManualEdit({
                  trackId: leadTrack.id,
                  sectionId: manualSection,
                })
              }
            >
              打开 Piano Roll 微调
            </button>
            <button type="button" onClick={() => advance("export")}>
              我先不改，去导出
            </button>
          </div>
        </section>
      )}

      {(journey.stage === "export" || journey.stage === "completed") && (
        <section className="panel journey-card">
          <p className="eyebrow">完成第一首作品</p>
          <h2>试听、保存并导出</h2>
          <p>
            先到 Demo 点击播放。满意后用顶栏保存工程，并导出
            MIDI（可继续编辑）或 WAV（可直接分享）。
          </p>
          <div className="journey-actions">
            <button
              className="primary-button"
              type="button"
              onClick={onOpenExport}
            >
              去试听和导出
            </button>
            <button type="button" onClick={() => advance("completed")}>
              标记为已完成
            </button>
          </div>
        </section>
      )}

      {error && (
        <p className="audio-error" role="alert">
          {error}
        </p>
      )}
      {message && (
        <p className="journey-status" role="status">
          {message}
        </p>
      )}
    </section>
  );
}

function ChoiceField({
  label,
  value,
  options,
  onChange,
}: {
  label: string;
  value: string;
  options: Array<readonly [string, string]>;
  onChange: (value: string) => void;
}) {
  return (
    <label>
      {label}
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        {options.map(([option, title]) => (
          <option key={option} value={option}>
            {title}
          </option>
        ))}
      </select>
    </label>
  );
}

function formatTimeline(seconds: number): string {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, "0")}`;
}
