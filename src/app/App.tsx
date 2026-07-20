import {
  Component,
  type ErrorInfo,
  type FormEvent,
  type ReactNode,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import {
  DesktopAiClient,
  DesktopAiClientError,
  type DesktopAiStatus,
} from "../agent/desktopAiClient";
import {
  type GatewayModelProvider,
  type GatewayGenerationStrategy,
  type ProductAccount,
  type ProductSession,
  type ProductUsage,
  configuredGatewayUrl,
  GatewayClient,
  GatewayClientError,
} from "../agent/gatewayClient";
import {
  buildLocalNoteProposal,
  projectFingerprint,
  type LocalNoteProposal,
} from "../agent/proposal";
import { audioEngine } from "../audio/audioEngine";
import {
  compileM0PlaybackPlan,
  playbackPlanAudibilityIssue,
} from "../audio/playbackPlan";
import { qwertKeyToMidi } from "../audio/scale";
import { isInstrumentPlaybackAvailable } from "../audio/sampleBank";
import type { ProjectDocument } from "../doc/types";
import type { ProjectTemplate } from "../doc/templates";
import { exportMidiWithDialog } from "../export/tauriMidiFile";
import { exportWavWithDialog } from "../export/tauriWavFile";
import {
  instrumentName,
  instrumentsForRole,
  keyboardAuditionInstruments,
} from "../instruments/registry";
import {
  quantizeKeyboardRecording,
  recordingElapsedBeats,
  type CapturedKeyboardNote,
} from "../input/recording";
import {
  adjustKeyboardOctave,
  loadKeyboardOctave,
  saveKeyboardOctave,
} from "../input/keyboardPreferences";
import {
  openProjectWithDialog,
  saveProject,
  saveProjectAsWithDialog,
} from "../lifecycle/tauriProjectFile";
import {
  CreativeJourneyScreen,
  type JourneyAiRequest,
} from "../journey/CreativeJourney";
import {
  createCreativeJourney,
  loadCreativeJourney,
  reconcileCreativeJourneyProject,
  saveCreativeJourney,
} from "../journey/progress";
import {
  buildWorkshopLengthAdjustment,
  createTenSecondWorkshopProject,
} from "../journey/workshop";
import type {
  CreativeBrief,
  CreativeJourney,
  JourneyMood,
} from "../journey/types";
import {
  discardRecoverySnapshot,
  loadRecoverySnapshot,
  saveRecoverySnapshot,
  type RecoverySnapshot,
} from "../lifecycle/recovery";
import type { Operation, OperationBatch, OperationIssue } from "../ops/types";
import { useProjectStore } from "../store/projectStore";
import { resolveTutorial } from "../tutorial/content";
import {
  loadTutorialProgress,
  saveTutorialProgress,
} from "../tutorial/progress";
import { TutorialDrawer } from "../tutorial/TutorialDrawer";
import type { TutorialProgress, TutorialRoute } from "../tutorial/types";

const routes: Array<{ id: TutorialRoute; label: string }> = [
  { id: "welcome", label: "欢迎" },
  { id: "journey", label: "做首歌" },
  { id: "demo", label: "Demo" },
  { id: "arrangement", label: "编排" },
  { id: "piano-roll", label: "Piano Roll" },
  { id: "chat", label: "AI Chat" },
];

type PianoRollTarget = { trackId: string; sectionId: string };

type ActiveAudition = {
  midi: number;
  instrumentId: string;
};

const visualScaleKeys = [
  { key: "q", label: "Q", degree: "do" },
  { key: "w", label: "W", degree: "re" },
  { key: "e", label: "E", degree: "mi" },
  { key: "r", label: "R", degree: "fa" },
  { key: "t", label: "T", degree: "sol" },
  { key: "y", label: "Y", degree: "la" },
  { key: "u", label: "U", degree: "ti" },
] as const;
const playheadUpdateIntervalMs = 100;

type RecordingSession = {
  target: PianoRollTarget;
  instrumentId: string;
  tempo: number;
  startedAtMs: number;
  activeKeys: Map<string, { midi: number; start: number }>;
  captured: CapturedKeyboardNote[];
};

export function App() {
  const [route, setRoute] = useState<TutorialRoute>("welcome");
  const [isTutorialOpen, setTutorialOpen] = useState(true);
  const [progress, setProgress] = useState<TutorialProgress>(() =>
    loadTutorialProgress(),
  );
  const [isPlaying, setPlaying] = useState(false);
  const [isAudioStarting, setAudioStarting] = useState(false);
  const [loopEnabled, setLoopEnabled] = useState(true);
  const [playheadBeat, setPlayheadBeat] = useState(0);
  const [lastScaleDegree, setLastScaleDegree] = useState<string>("尚未试听");
  const [keyboardOctave, setKeyboardOctave] = useState(() =>
    loadKeyboardOctave(window.localStorage),
  );
  const [keyboardInstrumentId, setKeyboardInstrumentId] =
    useState("acoustic_piano");
  const [audioError, setAudioError] = useState<string | null>(null);
  const [operationError, setOperationError] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [isFileWorking, setFileWorking] = useState(false);
  const [exportMessage, setExportMessage] = useState<string | null>(null);
  const [recoverySnapshot, setRecoverySnapshot] =
    useState<RecoverySnapshot | null>(() => loadRecoverySnapshot());
  const [pianoRollTarget, setPianoRollTarget] =
    useState<PianoRollTarget | null>(null);
  const [recordingTarget, setRecordingTarget] =
    useState<PianoRollTarget | null>(null);
  const [recordedNoteCount, setRecordedNoteCount] = useState(0);
  const [recordingMessage, setRecordingMessage] = useState<string | null>(null);
  const [journey, setJourney] = useState<CreativeJourney>(() =>
    loadCreativeJourney(),
  );
  const [journeyAiRequest, setJourneyAiRequest] =
    useState<JourneyAiRequest | null>(null);
  const project = useProjectStore((state) => state.document);
  const applyOperations = useProjectStore((state) => state.applyOperations);
  const createNewProject = useProjectStore((state) => state.createNewProject);
  const replaceWithNewProject = useProjectStore(
    (state) => state.replaceWithNewProject,
  );
  const filePath = useProjectStore((state) => state.filePath);
  const isDirty = useProjectStore((state) => state.isDirty);
  const lastSavedAt = useProjectStore((state) => state.lastSavedAt);
  const markSaved = useProjectStore((state) => state.markSaved);
  const openSavedProject = useProjectStore((state) => state.openSavedProject);
  const restoreRecoveredProject = useProjectStore(
    (state) => state.restoreRecoveredProject,
  );
  const undo = useProjectStore((state) => state.undo);
  const redo = useProjectStore((state) => state.redo);
  const canUndo = useProjectStore((state) => state.past.length > 0);
  const canRedo = useProjectStore((state) => state.future.length > 0);
  const activeAuditionNotes = useRef(new Map<string, ActiveAudition>());
  const recordingRef = useRef<RecordingSession | null>(null);

  const releaseAudition = useCallback((sourceKey: string) => {
    const activeNote = activeAuditionNotes.current.get(sourceKey);
    if (!activeNote) return undefined;
    activeAuditionNotes.current.delete(sourceKey);
    audioEngine.auditionNoteOff(activeNote.instrumentId, activeNote.midi);
    return activeNote;
  }, []);

  const stopAllAuditions = useCallback(() => {
    activeAuditionNotes.current.clear();
    audioEngine.allNotesOff();
  }, []);

  const startAudition = useCallback(
    ({
      sourceKey,
      midi,
      instrumentId,
      degree,
    }: {
      sourceKey: string;
      midi: number;
      instrumentId: string;
      degree: string;
    }) => {
      if (activeAuditionNotes.current.has(sourceKey)) return false;
      const duplicate = Array.from(activeAuditionNotes.current.values()).some(
        (active) =>
          active.midi === midi && active.instrumentId === instrumentId,
      );
      if (duplicate) return false;
      activeAuditionNotes.current.set(sourceKey, {
        midi,
        instrumentId,
      });
      setLastScaleDegree(degree);
      setAudioError(null);
      void audioEngine
        .auditionNoteOn(instrumentId, midi)
        .catch((error: unknown) => {
          const active = activeAuditionNotes.current.get(sourceKey);
          if (active?.midi === midi && active.instrumentId === instrumentId) {
            releaseAudition(sourceKey);
          }
          setAudioError(
            error instanceof Error
              ? error.message
              : "无法初始化音频。请再次点击播放或按键重试。",
          );
        });
      return true;
    },
    [releaseAudition],
  );

  const changeKeyboardOctave = useCallback(
    (amount: -1 | 1) => {
      stopAllAuditions();
      const nextOctave = adjustKeyboardOctave(keyboardOctave, amount);
      setKeyboardOctave(nextOctave);
      setLastScaleDegree(`默认八度：C${nextOctave}`);
    },
    [keyboardOctave, stopAllAuditions],
  );

  const changeKeyboardInstrument = useCallback(
    (instrumentId: string) => {
      stopAllAuditions();
      setKeyboardInstrumentId(instrumentId);
      setLastScaleDegree(`试听音色：${instrumentName(instrumentId)}`);
    },
    [stopAllAuditions],
  );

  const tapScaleKey = useCallback(
    async (key: string): Promise<void> => {
      const midi = qwertKeyToMidi(
        key,
        project.meta.key,
        project.meta.mode,
        keyboardOctave,
      );
      const degree = (
        {
          q: "do",
          w: "re",
          e: "mi",
          r: "fa",
          t: "sol",
          y: "la",
          u: "ti",
        } as Record<string, string>
      )[key];
      if (midi === undefined || !degree) {
        throw new Error("这个按键没有可试听的音阶映射。");
      }
      setLastScaleDegree(degree);
      setAudioError(null);
      // 页面白键是独立的一次性试听：不与实体键的 note-on/note-off
      // 状态共用，因此切换八度或晚到的 keyup 都不能取消这次点击。
      try {
        const didStart = await audioEngine.auditionNote(
          keyboardInstrumentId,
          midi,
        );
        if (!didStart) {
          throw new Error("试听请求被新的操作取消，请再次点击按键。");
        }
      } catch (error) {
        const message =
          error instanceof Error
            ? error.message
            : "无法初始化音频。请再次点击播放或按键重试。";
        setAudioError(message);
        throw new Error(message, { cause: error });
      }
    },
    [keyboardInstrumentId, keyboardOctave, project.meta.key, project.meta.mode],
  );

  const tutorial = useMemo(() => resolveTutorial({ route }), [route]);

  useEffect(() => {
    saveTutorialProgress(progress);
  }, [progress]);

  useEffect(() => {
    saveKeyboardOctave(keyboardOctave, window.localStorage);
  }, [keyboardOctave]);

  useEffect(() => {
    const midi = qwertKeyToMidi(
      "q",
      project.meta.key,
      project.meta.mode,
      keyboardOctave,
    );
    if (midi === undefined) return;
    // This is intentionally non-blocking: decoding can happen while the
    // context is suspended, so the next user press can start immediately.
    void audioEngine
      .prewarmAuditionNote(keyboardInstrumentId, midi)
      .catch(() => undefined);
  }, [
    keyboardInstrumentId,
    keyboardOctave,
    project.meta.key,
    project.meta.mode,
  ]);

  useEffect(() => {
    saveCreativeJourney(journey);
  }, [journey]);

  useEffect(() => {
    const reconciled = reconcileCreativeJourneyProject(journey, project.id);
    if (reconciled !== journey) {
      setJourney(reconciled);
      setJourneyAiRequest(null);
    }
  }, [journey, project.id]);

  useEffect(() => {
    if (!isDirty) {
      if (!recoverySnapshot) discardRecoverySnapshot();
      return;
    }
    const timer = window.setTimeout(() => {
      saveRecoverySnapshot({
        document: project,
        filePath,
        lastSavedAt,
        capturedAt: new Date().toISOString(),
      });
    }, 1_200);
    return () => window.clearTimeout(timer);
  }, [filePath, isDirty, lastSavedAt, project, recoverySnapshot]);

  useEffect(() => {
    const keyMap: Record<string, string> = {
      q: "do",
      w: "re",
      e: "mi",
      r: "fa",
      t: "sol",
      y: "la",
      u: "ti",
      i: "高音 do",
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      const target = event.target;
      if (
        target instanceof HTMLElement &&
        target.matches("input, textarea, [contenteditable='true']")
      ) {
        return;
      }
      const pressedKey = event.key.toLowerCase();
      const session = recordingRef.current;
      const isRecordingHere =
        route === "piano-roll" && session !== null && recordingTarget !== null;
      if (
        (route === "demo" || isRecordingHere) &&
        (pressedKey === "z" || pressedKey === "x")
      ) {
        event.preventDefault();
        if (!event.repeat) {
          changeKeyboardOctave(pressedKey === "z" ? -1 : 1);
        }
        return;
      }
      const degree = keyMap[pressedKey];
      const midi = qwertKeyToMidi(
        pressedKey === "i" ? "q" : pressedKey,
        project.meta.key,
        project.meta.mode,
        pressedKey === "i" || event.shiftKey
          ? keyboardOctave + 1
          : keyboardOctave,
      );
      if (
        (route === "demo" || isRecordingHere) &&
        degree &&
        midi !== undefined &&
        !event.repeat &&
        !activeAuditionNotes.current.has(pressedKey)
      ) {
        event.preventDefault();
        const instrumentId = isRecordingHere
          ? session.instrumentId
          : keyboardInstrumentId;
        const didStart = startAudition({
          sourceKey: pressedKey,
          midi,
          instrumentId,
          degree,
        });
        if (session && didStart) {
          session.activeKeys.set(pressedKey, {
            midi,
            start: recordingElapsedBeats(
              session.startedAtMs,
              performance.now(),
              session.tempo,
            ),
          });
        }
      }
    };
    const handleKeyUp = (event: KeyboardEvent) => {
      const pressedKey = event.key.toLowerCase();
      const activeNote = releaseAudition(pressedKey);
      if (!activeNote) return;
      const session = recordingRef.current;
      const recorded = session?.activeKeys.get(pressedKey);
      if (session && recorded) {
        session.activeKeys.delete(pressedKey);
        session.captured.push({
          midi: recorded.midi,
          start: recorded.start,
          duration:
            recordingElapsedBeats(
              session.startedAtMs,
              performance.now(),
              session.tempo,
            ) - recorded.start,
        });
        setRecordedNoteCount(session.captured.length);
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    window.addEventListener("keyup", handleKeyUp);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
      window.removeEventListener("keyup", handleKeyUp);
    };
  }, [
    keyboardOctave,
    keyboardInstrumentId,
    changeKeyboardOctave,
    project.meta.key,
    project.meta.mode,
    releaseAudition,
    recordingTarget,
    route,
    startAudition,
  ]);

  useEffect(() => {
    const stopForLostFocus = () => {
      const session = recordingRef.current;
      if (session) {
        const now = recordingElapsedBeats(
          session.startedAtMs,
          performance.now(),
          session.tempo,
        );
        session.activeKeys.forEach((note) => {
          session.captured.push({
            midi: note.midi,
            start: note.start,
            duration: now - note.start,
          });
        });
        session.activeKeys.clear();
        setRecordedNoteCount(session.captured.length);
      }
      stopAllAuditions();
      audioEngine.stop();
      setAudioStarting(false);
      setPlaying(false);
      setPlayheadBeat(0);
    };
    const stopWhenHidden = () => {
      if (document.visibilityState === "hidden") stopForLostFocus();
    };
    window.addEventListener("blur", stopForLostFocus);
    document.addEventListener("visibilitychange", stopWhenHidden);
    return () => {
      window.removeEventListener("blur", stopForLostFocus);
      document.removeEventListener("visibilitychange", stopWhenHidden);
      audioEngine.dispose();
    };
  }, [stopAllAuditions]);

  useEffect(() => {
    if (!isPlaying) return;
    const updatePlayhead = () => {
      const snapshot = audioEngine.getPlaybackSnapshot();
      if (snapshot.error) {
        setAudioError(snapshot.error);
        setPlaying(false);
        return;
      }
      setPlayheadBeat((current) =>
        Math.abs(current - snapshot.beat) >= 0.01 ? snapshot.beat : current,
      );
      if (!snapshot.isPlaying) {
        setPlaying(false);
      }
    };
    updatePlayhead();
    const timer = window.setInterval(updatePlayhead, playheadUpdateIntervalMs);
    return () => window.clearInterval(timer);
  }, [isPlaying]);

  const togglePlayback = async () => {
    if (isAudioStarting) return;
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再开始播放。");
      return;
    }
    setAudioError(null);
    if (isPlaying) {
      audioEngine.stop();
      setPlaying(false);
      setPlayheadBeat(0);
      return;
    }
    const result = compileM0PlaybackPlan(project);
    if (!result.ok) {
      setAudioError(
        result.errors
          .map((error) => `${error.path}：${error.message}`)
          .join("；"),
      );
      return;
    }
    const audibilityIssue = playbackPlanAudibilityIssue(result.plan);
    if (audibilityIssue) {
      setAudioError(audibilityIssue);
      return;
    }
    try {
      setAudioStarting(true);
      const didStart = await audioEngine.play(result.plan, loopEnabled);
      if (!didStart) {
        setAudioError("播放请求已被取消，请再次点击播放。");
        return;
      }
      setPlayheadBeat(0);
      setPlaying(true);
    } catch (error) {
      setAudioError(
        error instanceof Error
          ? error.message
          : "无法初始化音频。请检查系统输出设备后重试。",
      );
    } finally {
      setAudioStarting(false);
    }
  };

  const updateLoopEnabled = (enabled: boolean) => {
    setLoopEnabled(enabled);
    audioEngine.setLoopEnabled(enabled);
  };

  const submitOperations = (
    source: OperationBatch["source"],
    label: string,
    operations: Operation[],
  ): boolean => {
    if (isPlaying || isAudioStarting || recordingRef.current) {
      setOperationError(
        recordingRef.current
          ? "请先停止键盘录制，再修改工程。"
          : "请先停止播放，再修改工程。修改后请重新播放以试听新版本。",
      );
      return false;
    }
    const result = applyOperations({
      id: crypto.randomUUID(),
      source,
      label,
      operations,
    });
    if (result.applied) {
      setOperationError(null);
      return true;
    }
    setOperationError(formatOperationErrors(result.errors));
    return false;
  };

  const submitEdit = (
    type: Operation["type"],
    scope: Operation["scope"],
    args: Record<string, unknown>,
    label: string,
  ) => {
    submitOperations("manual", label, [
      { id: crypto.randomUUID(), type, scope, args },
    ]);
  };

  const startKeyboardRecording = (target: PianoRollTarget) => {
    if (isPlaying || isAudioStarting) {
      setOperationError("请先停止播放，再开始键盘录制。");
      return;
    }
    if (recordingRef.current) return;
    const track = project.tracks.find((item) => item.id === target.trackId);
    const section = project.sections.find(
      (item) => item.id === target.sectionId,
    );
    if (!track || !section) {
      setOperationError("录制目标已不存在。请重新从编排页选择轨道和段落。");
      return;
    }
    if (track.role === "drums") {
      setOperationError("鼓轨不支持音阶键盘录制。请选择 melodic 轨道。");
      return;
    }
    recordingRef.current = {
      target,
      instrumentId: track.instrument,
      tempo: project.meta.tempo,
      startedAtMs: performance.now(),
      activeKeys: new Map(),
      captured: [],
    };
    setRecordingTarget(target);
    setRecordedNoteCount(0);
    setRecordingMessage(
      `正在录制 ${track.name} / ${section.name}。按 Q W E R T Y U（I 为高音 do）输入，完成后点击停止并写入工程。`,
    );
    setOperationError(null);
  };

  const stopKeyboardRecording = () => {
    const session = recordingRef.current;
    if (!session) return;
    const finishedAt = recordingElapsedBeats(
      session.startedAtMs,
      performance.now(),
      session.tempo,
    );
    session.activeKeys.forEach((note, key) => {
      session.captured.push({
        midi: note.midi,
        start: note.start,
        duration: finishedAt - note.start,
      });
      const active = activeAuditionNotes.current.get(key);
      if (active) {
        audioEngine.auditionNoteOff(active.instrumentId, active.midi);
        activeAuditionNotes.current.delete(key);
      }
    });
    session.activeKeys.clear();
    recordingRef.current = null;
    setRecordingTarget(null);
    setRecordedNoteCount(0);

    const section = project.sections.find(
      (item) => item.id === session.target.sectionId,
    );
    const track = project.tracks.find(
      (item) => item.id === session.target.trackId,
    );
    if (!section || !track) {
      setOperationError("录制目标已不存在，未写入任何音符。");
      return;
    }
    const quantized = quantizeKeyboardRecording(
      session.captured,
      section.bars * 4,
    );
    if (quantized.notes.length === 0) {
      setOperationError(
        "没有可写入的音符；请按住一个音阶按键至少一个 1/16 音符后再停止录制。",
      );
      return;
    }
    const scope: Extract<Operation["scope"], { kind: "clip" }> = {
      kind: "clip",
      trackId: track.id,
      sectionId: section.id,
    };
    const clip = project.clips.find(
      (item) => item.trackId === track.id && item.sectionId === section.id,
    );
    const operations: Operation[] = [];
    if (!clip) {
      operations.push({
        id: crypto.randomUUID(),
        type: "upsertClip",
        scope,
        args: { clipId: crypto.randomUUID(), notes: [] },
      });
    }
    operations.push({
      id: crypto.randomUUID(),
      type: "insertNotes",
      scope,
      args: {
        trackId: track.id,
        sectionId: section.id,
        notes: quantized.notes.map((note) => ({
          ...note,
          id: crypto.randomUUID(),
        })),
      },
    });
    if (
      submitOperations(
        "keyboard",
        `录制 ${track.name} / ${section.name}（${quantized.notes.length} 个音符）`,
        operations,
      )
    ) {
      setRecordingMessage(
        `已写入 ${quantized.notes.length} 个量化音符${quantized.droppedCount ? `；已丢弃 ${quantized.droppedCount} 个越界或无效音符` : ""}。可在 Demo 页一次撤销整个录制。`,
      );
    }
  };

  const restoreHistory = (direction: "undo" | "redo") => {
    if (isPlaying || isAudioStarting || recordingRef.current) {
      setOperationError(
        recordingRef.current
          ? "请先停止键盘录制，再撤销或重做。"
          : "请先停止播放，再撤销或重做。修改后请重新播放以试听新版本。",
      );
      return;
    }
    const didRestore = direction === "undo" ? undo() : redo();
    if (didRestore) setOperationError(null);
  };

  const selectRoute = (next: TutorialRoute) => {
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再离开 Piano Roll。");
      return;
    }
    setRoute(next);
    setTutorialOpen(false);
  };

  const startNewProject = (template: ProjectTemplate) => {
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再创建新工程。");
      return;
    }
    audioEngine.stop();
    activeAuditionNotes.current.clear();
    setPlaying(false);
    setAudioStarting(false);
    setPlayheadBeat(0);
    createNewProject(template);
    setJourney(createCreativeJourney());
    setJourneyAiRequest(null);
    setPianoRollTarget(null);
    discardRecoverySnapshot();
    setRecoverySnapshot(null);
    selectRoute("demo");
  };

  const startCreativeWorkshop = (mood: JourneyMood) => {
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再开始创作任务。");
      return;
    }
    audioEngine.stop();
    activeAuditionNotes.current.clear();
    setPlaying(false);
    setAudioStarting(false);
    setPlayheadBeat(0);
    const document = createTenSecondWorkshopProject(mood);
    replaceWithNewProject(document);
    setJourney({
      ...createCreativeJourney(),
      projectId: document.id,
      seedSectionId: document.sections[0]?.id ?? null,
      stage: "audio-seeds",
      brief: { ...createCreativeJourney().brief, mood },
    });
    setJourneyAiRequest(null);
    setPianoRollTarget(null);
    discardRecoverySnapshot();
    setRecoverySnapshot(null);
    selectRoute("journey");
  };

  const applyWorkshopLength = (length: CreativeBrief["length"]): boolean => {
    const batch = buildWorkshopLengthAdjustment(project, length);
    if (!batch) return true;
    return submitOperations(batch.source, batch.label, batch.operations);
  };

  const handleSave = async (saveAs: boolean) => {
    if (isFileWorking) return;
    try {
      setFileWorking(true);
      setFileError(null);
      const saved = await (saveAs
        ? saveProjectAsWithDialog(project, filePath)
        : saveProject(project, filePath));
      if (saved) markSaved(saved.document, saved.path);
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "保存工程失败。请检查目标位置后重试。",
      );
    } finally {
      setFileWorking(false);
    }
  };

  const handleOpen = async () => {
    if (isFileWorking) return;
    if (
      isDirty &&
      !window.confirm(
        "当前工程尚未保存。继续打开会丢失未保存的修改，是否继续？",
      )
    )
      return;
    try {
      setFileWorking(true);
      setFileError(null);
      const opened = await openProjectWithDialog();
      if (opened) {
        audioEngine.stop();
        activeAuditionNotes.current.clear();
        setPlaying(false);
        setAudioStarting(false);
        setPlayheadBeat(0);
        openSavedProject(opened.document, opened.path);
        setPianoRollTarget(null);
        discardRecoverySnapshot();
        setRecoverySnapshot(null);
        setRoute("demo");
        setTutorialOpen(false);
      }
    } catch (error) {
      setFileError(
        error instanceof Error
          ? error.message
          : "打开工程失败。请检查文件后重试。",
      );
    } finally {
      setFileWorking(false);
    }
  };

  const handleMidiExport = async () => {
    if (isFileWorking) return;
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再导出 MIDI。");
      return;
    }
    try {
      setFileWorking(true);
      setFileError(null);
      setExportMessage(null);
      const path = await exportMidiWithDialog(project);
      if (path) setExportMessage(`MIDI 已导出：${path}`);
    } catch (error) {
      setFileError(
        error instanceof Error
          ? `MIDI 导出失败：${error.message}`
          : "MIDI 导出失败。请检查目标位置后重试。",
      );
    } finally {
      setFileWorking(false);
    }
  };

  const handleWavExport = async () => {
    if (isFileWorking) return;
    if (recordingRef.current) {
      setOperationError("请先停止键盘录制，再导出 WAV。");
      return;
    }
    try {
      setFileWorking(true);
      setFileError(null);
      setExportMessage(null);
      const path = await exportWavWithDialog(project);
      if (path) setExportMessage(`WAV 已导出：${path}`);
    } catch (error) {
      setFileError(
        error instanceof Error
          ? `WAV 导出失败：${error.message}`
          : "WAV 导出失败。请检查目标位置后重试。",
      );
    } finally {
      setFileWorking(false);
    }
  };

  const restoreRecovery = () => {
    if (!recoverySnapshot) return;
    restoreRecoveredProject(
      recoverySnapshot.document,
      recoverySnapshot.filePath,
      recoverySnapshot.lastSavedAt,
    );
    setPianoRollTarget(null);
    setRecoverySnapshot(null);
    selectRoute("demo");
  };

  const discardRecovery = () => {
    discardRecoverySnapshot();
    setRecoverySnapshot(null);
  };

  return (
    <AppErrorBoundary>
      <div className="app-shell">
        <header className="app-header">
          <div className="brand" aria-label="AI Music IDE">
            <span className="brand-mark">♫</span>
            <span>
              AI Music IDE <small>本地编辑 · MIDI / WAV 导出</small>
            </span>
          </div>
          <div className="header-actions" data-tutorial="file-actions">
            <button
              type="button"
              onClick={() => void handleOpen()}
              disabled={isFileWorking}
            >
              打开工程
            </button>
            <button
              type="button"
              onClick={() => void handleSave(false)}
              disabled={isFileWorking}
            >
              保存工程
            </button>
            <button
              type="button"
              onClick={() => void handleSave(true)}
              disabled={isFileWorking}
            >
              另存为
            </button>
            <button
              type="button"
              onClick={() => void handleMidiExport()}
              disabled={isFileWorking}
            >
              导出 MIDI
            </button>
            <button
              type="button"
              onClick={() => void handleWavExport()}
              disabled={isFileWorking}
            >
              导出 WAV
            </button>
            <button
              data-tutorial="tutorial-trigger"
              className="tutorial-trigger"
              type="button"
              onClick={() => setTutorialOpen(true)}
            >
              当前页面教程
            </button>
          </div>
        </header>
        <nav className="route-nav" aria-label="原型页面">
          {routes.map((item) => (
            <button
              key={item.id}
              type="button"
              aria-current={route === item.id ? "page" : undefined}
              onClick={() => selectRoute(item.id)}
            >
              {item.label}
            </button>
          ))}
        </nav>
        <main className="app-content">
          {route === "welcome" && (
            <Welcome
              onStartDemo={() => selectRoute("demo")}
              onStartJourney={() => selectRoute("journey")}
              onCreateProject={startNewProject}
              recoverySnapshot={recoverySnapshot}
              onRestoreRecovery={restoreRecovery}
              onDiscardRecovery={discardRecovery}
            />
          )}
          {route === "journey" && (
            <CreativeJourneyScreen
              project={project}
              journey={journey}
              onJourneyChange={setJourney}
              onCreateWorkshop={startCreativeWorkshop}
              onApplyLength={applyWorkshopLength}
              onTapScaleKey={tapScaleKey}
              audioError={audioError}
              onSubmitOperations={(batch) =>
                submitOperations(batch.source, batch.label, batch.operations)
              }
              onOpenAi={(request) => {
                setJourneyAiRequest(request);
                selectRoute("chat");
              }}
              onOpenManualEdit={(target) => {
                setPianoRollTarget(target);
                selectRoute("piano-roll");
              }}
              onOpenExport={() => selectRoute("demo")}
            />
          )}
          {route === "demo" && (
            <Demo
              project={project}
              isPlaying={isPlaying}
              isAudioStarting={isAudioStarting}
              onTogglePlayback={togglePlayback}
              lastScaleDegree={lastScaleDegree}
              keyboardOctave={keyboardOctave}
              onChangeKeyboardOctave={changeKeyboardOctave}
              keyboardInstrumentId={keyboardInstrumentId}
              onChangeKeyboardInstrument={changeKeyboardInstrument}
              onTapScaleKey={tapScaleKey}
              audioError={audioError}
              loopEnabled={loopEnabled}
              onLoopChange={updateLoopEnabled}
              playheadBeat={playheadBeat}
              onSubmitEdit={submitEdit}
              operationError={operationError}
              canUndo={canUndo}
              canRedo={canRedo}
              onUndo={() => restoreHistory("undo")}
              onRedo={() => restoreHistory("redo")}
              filePath={filePath}
              isDirty={isDirty}
              lastSavedAt={lastSavedAt}
              fileError={fileError}
              exportMessage={exportMessage}
            />
          )}
          {route === "arrangement" && (
            <Arrangement
              project={project}
              onEditClip={(target) => {
                setPianoRollTarget(target);
                selectRoute("piano-roll");
              }}
              onChangeInstrument={(trackId, instrumentId) =>
                submitEdit(
                  "setInstrument",
                  { kind: "track", trackId },
                  { instrument: instrumentId },
                  `将 ${project.tracks.find((track) => track.id === trackId)?.name ?? "轨道"} 更换为 ${instrumentName(instrumentId)}`,
                )
              }
            />
          )}
          {route === "piano-roll" && (
            <PianoRoll
              project={project}
              target={pianoRollTarget}
              onTargetChange={(target) => {
                activeAuditionNotes.current.clear();
                audioEngine.allNotesOff();
                setPianoRollTarget(target);
              }}
              recordingTarget={recordingTarget}
              recordedNoteCount={recordedNoteCount}
              recordingMessage={recordingMessage}
              onStartRecording={startKeyboardRecording}
              onStopRecording={stopKeyboardRecording}
              keyboardOctave={keyboardOctave}
              onSubmitEdit={submitEdit}
              operationError={operationError}
            />
          )}
          {route === "chat" && (
            <Chat
              project={project}
              journeyRequest={journeyAiRequest}
              onJourneyProposalAccepted={(sectionId) => {
                setJourney((current) => ({
                  ...current,
                  completedSectionIds: current.completedSectionIds.includes(
                    sectionId,
                  )
                    ? current.completedSectionIds
                    : [...current.completedSectionIds, sectionId],
                  stage: "extend",
                }));
                setJourneyAiRequest(null);
              }}
              onAcceptProposal={(batch) =>
                submitOperations(batch.source, batch.label, batch.operations)
              }
            />
          )}
        </main>
        <TutorialDrawer
          isOpen={isTutorialOpen}
          tutorial={tutorial}
          progress={progress}
          onProgressChange={setProgress}
          onClose={() => setTutorialOpen(false)}
        />
      </div>
    </AppErrorBoundary>
  );
}

class AppErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false };

  static getDerivedStateFromError(): { hasError: boolean } {
    return { hasError: true };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    // 开发诊断只记录错误类型和组件堆栈；不得将工程内容、提示词或密钥写入日志。
    console.error("ui_error", {
      name: error.name,
      componentStack: info.componentStack,
    });
  }

  render(): ReactNode {
    if (this.state.hasError) {
      return (
        <main className="fatal-error" role="alert">
          <h1>页面暂时无法显示</h1>
          <p>
            当前工程不会被教程修改。请刷新后重试；若问题持续，请记录出现页面和操作步骤。
          </p>
        </main>
      );
    }
    return this.props.children;
  }
}

function Welcome({
  onStartDemo,
  onStartJourney,
  onCreateProject,
  recoverySnapshot,
  onRestoreRecovery,
  onDiscardRecovery,
}: {
  onStartDemo: () => void;
  onStartJourney: () => void;
  onCreateProject: (template: ProjectTemplate) => void;
  recoverySnapshot: RecoverySnapshot | null;
  onRestoreRecovery: () => void;
  onDiscardRecovery: () => void;
}) {
  return (
    <section className="welcome-card" data-tutorial="project-summary">
      <p className="eyebrow">离线优先 · 教程优先</p>
      <h1>从一个可试听的音乐工程开始</h1>
      <p>
        此原型先验证新手引导：任何页面都能调出当前教程，不会中断你的编辑状态。
      </p>
      {recoverySnapshot && (
        <section className="recovery-card" data-tutorial="recovery-actions">
          <strong>发现未保存的本地恢复副本</strong>
          <p>
            {recoverySnapshot.document.name} · 捕获于{" "}
            {formatTimestamp(recoverySnapshot.capturedAt)}
          </p>
          <div className="project-start-actions">
            <button
              type="button"
              className="primary-button"
              onClick={onRestoreRecovery}
            >
              恢复并继续编辑
            </button>
            <button type="button" onClick={onDiscardRecovery}>
              丢弃恢复副本
            </button>
          </div>
        </section>
      )}
      <div className="project-facts">
        <span>8 小节 Demo</span>
        <span>120 BPM</span>
        <span>C minor</span>
      </div>
      <div className="project-start-actions" data-tutorial="project-start">
        <button
          className="primary-button"
          type="button"
          onClick={onStartJourney}
        >
          新手：从 10 秒做首歌
        </button>
        <button type="button" onClick={() => onCreateProject("blank")}>
          新建空白工程
        </button>
        <button type="button" onClick={() => onCreateProject("lofi")}>
          Lo-fi 模板
        </button>
        <button type="button" onClick={() => onCreateProject("electronic")}>
          Electronic 模板
        </button>
        <button
          type="button"
          onClick={() => onCreateProject("popInstrumental")}
        >
          Pop 模板
        </button>
        <button type="button" onClick={onStartDemo}>
          打开内置 Demo
        </button>
      </div>
    </section>
  );
}

function Demo({
  project,
  isPlaying,
  isAudioStarting,
  onTogglePlayback,
  lastScaleDegree,
  keyboardOctave,
  onChangeKeyboardOctave,
  keyboardInstrumentId,
  onChangeKeyboardInstrument,
  onTapScaleKey,
  audioError,
  loopEnabled,
  onLoopChange,
  playheadBeat,
  onSubmitEdit,
  operationError,
  canUndo,
  canRedo,
  onUndo,
  onRedo,
  filePath,
  isDirty,
  lastSavedAt,
  fileError,
  exportMessage,
}: {
  project: ProjectDocument;
  isPlaying: boolean;
  isAudioStarting: boolean;
  onTogglePlayback: () => void;
  lastScaleDegree: string;
  keyboardOctave: number;
  onChangeKeyboardOctave: (amount: -1 | 1) => void;
  keyboardInstrumentId: string;
  onChangeKeyboardInstrument: (instrumentId: string) => void;
  onTapScaleKey: (key: string) => void;
  audioError: string | null;
  loopEnabled: boolean;
  onLoopChange: (enabled: boolean) => void;
  playheadBeat: number;
  onSubmitEdit: (
    type: Operation["type"],
    scope: Operation["scope"],
    args: Record<string, unknown>,
    label: string,
  ) => void;
  operationError: string | null;
  canUndo: boolean;
  canRedo: boolean;
  onUndo: () => void;
  onRedo: () => void;
  filePath: string | null;
  isDirty: boolean;
  lastSavedAt: string | null;
  fileError: string | null;
  exportMessage: string | null;
}) {
  const totalBars = project.sections.reduce(
    (sum, section) => sum + section.bars,
    0,
  );
  const selectedKeyboardInstrument = keyboardAuditionInstruments().find(
    (instrument) => instrument.id === keyboardInstrumentId,
  );
  const keyboardInstrumentAvailable =
    selectedKeyboardInstrument !== undefined &&
    isInstrumentPlaybackAvailable(selectedKeyboardInstrument.id);
  return (
    <section className="page-grid">
      <div className="panel" data-tutorial="transport-controls">
        <p className="eyebrow">Transport</p>
        <h1>{project.name}</h1>
        <p>
          {totalBars} 小节 · {project.meta.tempo} BPM · {project.meta.key}{" "}
          {project.meta.mode}
        </p>
        <p className="file-status" aria-live="polite">
          {isDirty
            ? "未保存的修改"
            : filePath
              ? `已保存 · ${filePath}${lastSavedAt ? ` · ${formatSavedAt(lastSavedAt)}` : ""}`
              : "内置工程（尚未保存为文件）"}
        </p>
        <div className="transport-row">
          <button
            className="primary-button"
            type="button"
            onClick={onTogglePlayback}
            disabled={isAudioStarting}
          >
            {isAudioStarting ? "准备音频…" : isPlaying ? "停止" : "播放"}
          </button>
          <span aria-live="polite">
            {isAudioStarting
              ? "正在初始化音频…"
              : isPlaying
                ? `正在播放 · ${formatPlayhead(playheadBeat)}`
                : "已停止 · 1.1.0"}
          </span>
          <label>
            <input
              type="checkbox"
              checked={loopEnabled}
              onChange={(event) => onLoopChange(event.target.checked)}
            />{" "}
            循环
          </label>
        </div>
        <progress
          className="playhead-progress"
          aria-label="当前播放位置"
          max={project.sections.reduce(
            (sum, section) => sum + section.bars * 4,
            0,
          )}
          value={playheadBeat}
        />
        {audioError && (
          <p className="audio-error" role="alert">
            音频不可用：{audioError}
          </p>
        )}
        {fileError && (
          <p className="audio-error" role="alert">
            文件操作失败：{fileError}
          </p>
        )}
        {exportMessage && (
          <p className="file-status" role="status">
            {exportMessage}
          </p>
        )}
      </div>
      <div className="panel" data-tutorial="keyboard-map">
        <p className="eyebrow">电脑键盘试听</p>
        <h2>Q W E R T Y U → do re mi fa sol la ti</h2>
        <label className="keyboard-instrument-select">
          试听乐器
          <select
            aria-label="电脑键盘试听乐器"
            value={keyboardInstrumentId}
            onChange={(event) => onChangeKeyboardInstrument(event.target.value)}
          >
            {keyboardAuditionInstruments().map((instrument) => (
              <option
                key={instrument.id}
                value={instrument.id}
                disabled={!isInstrumentPlaybackAvailable(instrument.id)}
              >
                {instrument.name}
                {instrument.id === "square_lead"
                  ? "（电子合成）"
                  : !isInstrumentPlaybackAvailable(instrument.id)
                    ? "（未附真实采样，已禁用）"
                    : ""}
              </option>
            ))}
          </select>
        </label>
        {!keyboardInstrumentAvailable && (
          <p className="audio-error" role="alert">
            这个乐器没有可用的真实采样，已禁用试听。请选择其他乐器。
          </p>
        )}
        <div
          className="keyboard-keys"
          aria-label="Q W E R T Y U 映射 do re mi fa sol la ti"
        >
          {visualScaleKeys.map((item) => (
            <button
              key={item.key}
              className="keyboard-key"
              type="button"
              aria-label={`试听 ${item.degree}（${item.label}）`}
              disabled={!keyboardInstrumentAvailable}
              onClick={() => onTapScaleKey(item.key)}
            >
              {item.label}
              <small>{item.degree}</small>
            </button>
          ))}
        </div>
        <div className="keyboard-octave-controls" aria-label="默认八度控制">
          <button
            type="button"
            aria-label="降低默认八度"
            onClick={() => onChangeKeyboardOctave(-1)}
          >
            Z · 降低
          </button>
          <strong aria-live="polite">当前 C{keyboardOctave}</strong>
          <button
            type="button"
            aria-label="升高默认八度"
            onClick={() => onChangeKeyboardOctave(1)}
          >
            X · 升高
          </button>
        </div>
        <p>Z / X 也可切换默认八度；I 或 Shift+按键试听高八度。</p>
        <p aria-live="polite">最近试听：{lastScaleDegree}</p>
      </div>
      <div className="panel demo-tracks" aria-label="内置 demo 的轨道">
        <p className="eyebrow">工程文档</p>
        <h2>
          {project.tracks.length} 条轨道，{totalBars} 小节
        </h2>
        <ul>
          {project.tracks.map((track) => (
            <li key={track.id}>
              <strong>{track.name}</strong>
              <span>
                {track.role} · {track.instrument}
              </span>
              <span>
                音量 {Math.round(track.vol * 100)}% ·
                {track.mute ? " 静音" : " 未静音"} ·
                {track.solo ? " 独奏" : " 非独奏"}
              </span>
            </li>
          ))}
        </ul>
        <p>
          工程先经 Schema
          校验，再由注册表指定的实录采样或明确标注的合成主音播放。以下控件只会通过
          OperationBatch 修改当前内存工程；可保存为工程 JSON、导出
          MIDI/WAV，并按批次撤销或重做。
        </p>
      </div>
      <section className="panel demo-editor" data-tutorial="quick-mix-editor">
        <p className="eyebrow">M1 手工修改（内存工程）</p>
        <h2>先修改，再重新试听</h2>
        <div className="history-controls" data-tutorial="undo-redo-controls">
          <button type="button" onClick={onUndo} disabled={!canUndo}>
            撤销
          </button>
          <button type="button" onClick={onRedo} disabled={!canRedo}>
            重做
          </button>
          <span aria-live="polite">
            {canUndo || canRedo ? "可按批次撤销或重做" : "尚无可撤销的修改"}
          </span>
        </div>
        <div className="editor-controls">
          <div>
            <span>速度：{project.meta.tempo} BPM</span>
            <button
              type="button"
              onClick={() =>
                onSubmitEdit(
                  "setTempo",
                  { kind: "whole" },
                  { tempo: Math.max(40, project.meta.tempo - 10) },
                  "降低速度",
                )
              }
              disabled={project.meta.tempo <= 40}
            >
              -10 BPM
            </button>
            <button
              type="button"
              onClick={() =>
                onSubmitEdit(
                  "setTempo",
                  { kind: "whole" },
                  { tempo: Math.min(240, project.meta.tempo + 10) },
                  "提高速度",
                )
              }
              disabled={project.meta.tempo >= 240}
            >
              +10 BPM
            </button>
          </div>
          <label>
            调性
            <select
              value={project.meta.key}
              onChange={(event) =>
                onSubmitEdit(
                  "setKey",
                  { kind: "whole" },
                  { key: event.target.value, mode: project.meta.mode },
                  "设置调性",
                )
              }
            >
              {[
                "C",
                "C#",
                "D",
                "D#",
                "E",
                "F",
                "F#",
                "G",
                "G#",
                "A",
                "A#",
                "B",
              ].map((key) => (
                <option key={key}>{key}</option>
              ))}
            </select>
            <select
              aria-label="调式"
              value={project.meta.mode}
              onChange={(event) =>
                onSubmitEdit(
                  "setKey",
                  { kind: "whole" },
                  { key: project.meta.key, mode: event.target.value },
                  "设置调式",
                )
              }
            >
              <option value="minor">minor</option>
              <option value="major">major</option>
            </select>
          </label>
          <div>
            <span>全曲移调（不改变调性标签）</span>
            <button
              type="button"
              onClick={() =>
                onSubmitEdit(
                  "transpose",
                  { kind: "whole" },
                  { semitones: -1 },
                  "全曲降低半音",
                )
              }
            >
              −1 半音
            </button>
            <button
              type="button"
              onClick={() =>
                onSubmitEdit(
                  "transpose",
                  { kind: "whole" },
                  { semitones: 1 },
                  "全曲升高半音",
                )
              }
            >
              +1 半音
            </button>
          </div>
        </div>
        <div className="track-mix-controls">
          {project.tracks.map((track) => (
            <div key={track.id} className="track-mix-row">
              <strong>{track.name}</strong>
              <button
                type="button"
                onClick={() =>
                  onSubmitEdit(
                    "setVolume",
                    { kind: "track", trackId: track.id },
                    {
                      volume: Math.max(0, Number((track.vol - 0.1).toFixed(2))),
                    },
                    `降低 ${track.name} 音量`,
                  )
                }
                disabled={track.vol <= 0}
              >
                音量 −
              </button>
              <span>{Math.round(track.vol * 100)}%</span>
              <button
                type="button"
                onClick={() =>
                  onSubmitEdit(
                    "setVolume",
                    { kind: "track", trackId: track.id },
                    {
                      volume: Math.min(1, Number((track.vol + 0.1).toFixed(2))),
                    },
                    `提高 ${track.name} 音量`,
                  )
                }
                disabled={track.vol >= 1}
              >
                音量 +
              </button>
              <button
                type="button"
                aria-pressed={track.mute}
                onClick={() =>
                  onSubmitEdit(
                    "mute",
                    { kind: "track", trackId: track.id },
                    { value: !track.mute },
                    `${track.mute ? "取消静音" : "静音"} ${track.name}`,
                  )
                }
              >
                {track.mute ? "取消静音" : "静音"}
              </button>
              <button
                type="button"
                aria-pressed={track.solo}
                onClick={() =>
                  onSubmitEdit(
                    "solo",
                    { kind: "track", trackId: track.id },
                    { value: !track.solo },
                    `${track.solo ? "取消独奏" : "独奏"} ${track.name}`,
                  )
                }
              >
                {track.solo ? "取消独奏" : "独奏"}
              </button>
            </div>
          ))}
        </div>
        {operationError && (
          <p className="audio-error" role="alert">
            修改未应用：{operationError}
          </p>
        )}
      </section>
    </section>
  );
}

function formatPlayhead(beat: number): string {
  const bar = Math.floor(beat / 4) + 1;
  const beatInBar = Math.floor(beat % 4) + 1;
  const sixteenth = Math.floor((beat % 1) * 4) + 1;
  return `${bar}.${beatInBar}.${sixteenth}`;
}

function formatOperationErrors(errors: OperationIssue[]): string {
  return errors.map((error) => error.message).join("；");
}

function formatSavedAt(value: string): string {
  return `保存于 ${formatTimestamp(value)}`;
}

function formatTimestamp(value: string): string {
  const timestamp = new Date(value);
  if (Number.isNaN(timestamp.getTime())) return "时间未知";
  return timestamp.toLocaleString();
}

function Arrangement({
  project,
  onEditClip,
  onChangeInstrument,
}: {
  project: ProjectDocument;
  onEditClip: (target: PianoRollTarget) => void;
  onChangeInstrument: (trackId: string, instrumentId: string) => void;
}) {
  return (
    <section className="panel">
      <p className="eyebrow">Arrangement</p>
      <h1>编排与范围</h1>
      <p className="arrangement-intro">
        为每条轨道指定乐器，或选择一个轨道与段落打开对应的 Piano
        Roll。空白位置也可先创建片段。
      </p>
      <div className="arrangement-instrument-controls" aria-label="轨道乐器">
        {project.tracks.map((track) => {
          const candidates = instrumentsForRole(track.role);
          const hasAvailableCandidate = candidates.some((instrument) =>
            isInstrumentPlaybackAvailable(instrument.id),
          );
          return (
            <label key={`${track.id}-instrument`}>
              {track.name}（{track.role}）
              <select
                aria-label={`${track.name} 乐器`}
                value={track.instrument}
                onChange={(event) =>
                  onChangeInstrument(track.id, event.target.value)
                }
              >
                {candidates.map((instrument) => (
                  <option
                    key={instrument.id}
                    value={instrument.id}
                    disabled={!isInstrumentPlaybackAvailable(instrument.id)}
                  >
                    {instrument.name}
                    {instrument.id === "square_lead"
                      ? "（电子合成）"
                      : !isInstrumentPlaybackAvailable(instrument.id)
                        ? "（未附真实采样，已禁用）"
                        : ""}
                  </option>
                ))}
              </select>
              {!hasAvailableCandidate && (
                <small className="audio-error">
                  这个角色尚无真实采样，不能试听、播放或导出。
                </small>
              )}
            </label>
          );
        })}
      </div>
      <div
        className="arrangement-grid"
        data-tutorial="arrangement-grid"
        style={{
          gridTemplateColumns: `minmax(110px, auto) repeat(${project.sections.length}, minmax(140px, 1fr))`,
        }}
      >
        <span className="arrangement-corner">轨道 / 段落</span>
        {project.sections.map((section) => (
          <strong key={section.id} className="arrangement-section-heading">
            {section.name}
            <small>{section.bars} 小节</small>
          </strong>
        ))}
        {project.tracks.flatMap((track) => [
          <strong key={`${track.id}-label`} className="arrangement-track-label">
            {track.name}
            <small>
              {track.role} · {instrumentName(track.instrument)}
            </small>
          </strong>,
          ...project.sections.map((section) => {
            const clip = project.clips.find(
              (item) =>
                item.trackId === track.id && item.sectionId === section.id,
            );
            const target = { trackId: track.id, sectionId: section.id };
            return (
              <button
                key={`${track.id}-${section.id}`}
                type="button"
                className={clip ? "arrangement-clip" : "arrangement-empty"}
                data-tutorial={clip ? "arrangement-clip" : undefined}
                aria-label={`${clip ? "编辑" : "创建"} ${track.name} 的 ${section.name} 片段${clip ? `（${clip.notes.length} 个音符）` : ""}`}
                onClick={() => onEditClip(target)}
              >
                <span>{clip ? "编辑片段" : "创建片段"}</span>
                <small>
                  {clip ? `${clip.notes.length} 个音符` : "空白位置"}
                </small>
              </button>
            );
          }),
        ])}
      </div>
      <p className="arrangement-help">
        当前版本按单个轨道 ×
        段落编辑；全局、轨道和段落范围的批量操作会在后续编排工具中提供。
      </p>
    </section>
  );
}

function PianoRoll({
  project,
  target,
  onTargetChange,
  recordingTarget,
  recordedNoteCount,
  recordingMessage,
  onStartRecording,
  onStopRecording,
  keyboardOctave,
  onSubmitEdit,
  operationError,
}: {
  project: ProjectDocument;
  target: PianoRollTarget | null;
  onTargetChange: (target: PianoRollTarget) => void;
  recordingTarget: PianoRollTarget | null;
  recordedNoteCount: number;
  recordingMessage: string | null;
  onStartRecording: (target: PianoRollTarget) => void;
  onStopRecording: () => void;
  keyboardOctave: number;
  onSubmitEdit: (
    type: Operation["type"],
    scope: Operation["scope"],
    args: Record<string, unknown>,
    label: string,
  ) => void;
  operationError: string | null;
}) {
  const defaultTrack =
    project.tracks.find((track) => track.role !== "drums") ?? project.tracks[0];
  const selectedTrack =
    project.tracks.find((track) => track.id === target?.trackId) ??
    defaultTrack;
  const defaultSection = project.sections[0];
  const selectedSection =
    project.sections.find((section) => section.id === target?.sectionId) ??
    defaultSection;

  if (!selectedTrack || !selectedSection) {
    return (
      <section className="panel">
        <p className="eyebrow">Manual edit</p>
        <h1>Piano Roll</h1>
        <p>当前工程没有可编辑的轨道或片段。</p>
      </section>
    );
  }

  const scope: Extract<Operation["scope"], { kind: "clip" }> = {
    kind: "clip",
    trackId: selectedTrack.id,
    sectionId: selectedSection.id,
  };
  const isRecording =
    recordingTarget?.trackId === scope.trackId &&
    recordingTarget?.sectionId === scope.sectionId;
  const isRecordingElsewhere = recordingTarget !== null && !isRecording;
  const canRecord = selectedTrack.role !== "drums";
  const clip = project.clips.find(
    (item) =>
      item.trackId === selectedTrack.id &&
      item.sectionId === selectedSection.id,
  );
  const sectionBeats = selectedSection.bars * 4;
  const latestEnd = Math.max(
    0,
    ...(clip?.notes.map((note) => note.start + note.dur) ?? []),
  );
  const nextStart = Math.min(
    Math.max(0, Math.round(latestEnd * 4) / 4),
    sectionBeats - 1,
  );

  return (
    <section className="panel">
      <p className="eyebrow">Manual edit</p>
      <h1>Piano Roll</h1>
      <p className="piano-roll-intro">
        这里的修改会写入当前工程。停止播放后编辑，再回到 Demo 重新播放试听。
      </p>
      <div className="piano-roll-controls" data-tutorial="piano-roll-target">
        <label>
          轨道
          <select
            value={selectedTrack.id}
            disabled={recordingTarget !== null}
            onChange={(event) =>
              onTargetChange({
                trackId: event.target.value,
                sectionId: selectedSection.id,
              })
            }
          >
            {project.tracks.map((track) => (
              <option key={track.id} value={track.id}>
                {track.name}（{track.role}）
              </option>
            ))}
          </select>
        </label>
        <label>
          段落
          <select
            value={selectedSection.id}
            disabled={recordingTarget !== null}
            onChange={(event) =>
              onTargetChange({
                trackId: selectedTrack.id,
                sectionId: event.target.value,
              })
            }
          >
            {project.sections.map((section) => (
              <option key={section.id} value={section.id}>
                {section.name}（{section.bars} 小节）
              </option>
            ))}
          </select>
        </label>
        <span>{clip ? `${clip.notes.length} 个音符` : "尚无片段"}</span>
      </div>
      <div className="recording-controls" data-tutorial="keyboard-recording">
        <div>
          <strong>电脑键盘录制</strong>
          <p>
            Q W E R T Y U 对应当前调性的 do re mi fa sol la ti；Z / X
            切换默认八度（当前 C{keyboardOctave}），I 或 Shift+按键为高八度。
          </p>
        </div>
        {isRecording ? (
          <button
            type="button"
            className="recording-stop"
            onClick={onStopRecording}
          >
            停止录制并写入（已收集 {recordedNoteCount} 个音符）
          </button>
        ) : (
          <button
            type="button"
            className="primary-button"
            disabled={!canRecord || isRecordingElsewhere}
            onClick={() => onStartRecording(scope)}
          >
            {canRecord ? "开始键盘录制" : "鼓轨不支持音阶录制"}
          </button>
        )}
      </div>
      {recordingMessage && (
        <p className="recording-message">{recordingMessage}</p>
      )}
      {!clip ? (
        <div className="piano-roll-empty" data-tutorial="piano-roll-create">
          <p>这个轨道在当前段落还没有片段。</p>
          <button
            type="button"
            className="primary-button"
            disabled={recordingTarget !== null}
            onClick={() =>
              onSubmitEdit(
                "upsertClip",
                scope,
                { clipId: crypto.randomUUID(), notes: [] },
                `创建 ${selectedTrack.name} 的 ${selectedSection.name} 片段`,
              )
            }
          >
            创建空片段
          </button>
        </div>
      ) : (
        <>
          <div
            className="piano-roll-actions"
            data-tutorial="piano-roll-add-note"
          >
            <button
              type="button"
              className="primary-button"
              disabled={recordingTarget !== null}
              onClick={() =>
                onSubmitEdit(
                  "insertNotes",
                  scope,
                  {
                    trackId: selectedTrack.id,
                    sectionId: selectedSection.id,
                    notes: [
                      {
                        id: crypto.randomUUID(),
                        start: nextStart,
                        dur: 1,
                        pitch: 60,
                        vel: 96,
                      },
                    ],
                  },
                  `在 ${selectedTrack.name} 添加音符`,
                )
              }
            >
              添加音符（C4）
            </button>
            <span>新音符从第 {nextStart + 1} 拍开始，时值 1 拍。</span>
          </div>
          <div className="piano-roll" data-tutorial="piano-roll-grid">
            <div className="piano-roll-heading" aria-hidden="true">
              <span>音高</span>
              <span>开始</span>
              <span>时值</span>
              <span>力度</span>
              <span>操作</span>
            </div>
            {clip.notes.length === 0 ? (
              <p className="piano-roll-no-notes">
                片段为空，请添加第一个音符。
              </p>
            ) : (
              clip.notes.map((note) => (
                <NoteEditor
                  key={note.id}
                  note={note}
                  sectionBeats={sectionBeats}
                  scope={scope}
                  disabled={recordingTarget !== null}
                  onSubmitEdit={onSubmitEdit}
                />
              ))
            )}
          </div>
        </>
      )}
      {operationError && <p className="audio-error">{operationError}</p>}
      <p className="piano-roll-help">
        每一次“更新”或“删除”都是一个可撤销批次；输入值必须留在当前段落内。
      </p>
    </section>
  );
}

function NoteEditor({
  note,
  sectionBeats,
  scope,
  disabled,
  onSubmitEdit,
}: {
  note: ProjectDocument["clips"][number]["notes"][number];
  sectionBeats: number;
  scope: Extract<Operation["scope"], { kind: "clip" }>;
  disabled: boolean;
  onSubmitEdit: (
    type: Operation["type"],
    scope: Operation["scope"],
    args: Record<string, unknown>,
    label: string,
  ) => void;
}) {
  const noteName = midiNoteName(note.pitch);

  const updateNote = (form: HTMLFormElement) => {
    const values = new FormData(form);
    onSubmitEdit(
      "updateNotes",
      scope,
      {
        changes: [
          {
            noteId: note.id,
            pitch: Number(values.get("pitch")),
            start: Number(values.get("start")),
            dur: Number(values.get("dur")),
            vel: Number(values.get("vel")),
          },
        ],
      },
      `更新 ${noteName} 音符`,
    );
  };

  return (
    <form
      className="piano-roll-note"
      onSubmit={(event) => {
        event.preventDefault();
        updateNote(event.currentTarget);
      }}
    >
      <label>
        <span className="sr-only">音高</span>
        <input
          aria-label={`${noteName} 音高（MIDI）`}
          name="pitch"
          type="number"
          min="0"
          max="127"
          step="1"
          defaultValue={note.pitch}
          disabled={disabled}
        />
        <small>{noteName}</small>
      </label>
      <label>
        <span className="sr-only">开始拍</span>
        <input
          aria-label={`${noteName} 开始拍`}
          name="start"
          type="number"
          min="0"
          max={Math.max(0, sectionBeats - note.dur)}
          step="0.25"
          defaultValue={note.start}
          disabled={disabled}
        />
      </label>
      <label>
        <span className="sr-only">时值（拍）</span>
        <input
          aria-label={`${noteName} 时值（拍）`}
          name="dur"
          type="number"
          min="0.25"
          max={sectionBeats}
          step="0.25"
          defaultValue={note.dur}
          disabled={disabled}
        />
      </label>
      <label>
        <span className="sr-only">力度</span>
        <input
          aria-label={`${noteName} 力度`}
          name="vel"
          type="number"
          min="1"
          max="127"
          step="1"
          defaultValue={note.vel}
          disabled={disabled}
        />
      </label>
      <div
        className="piano-roll-note-actions"
        data-tutorial="piano-roll-note-actions"
      >
        <button type="submit" disabled={disabled}>
          更新
        </button>
        <button
          type="button"
          disabled={disabled}
          onClick={() =>
            onSubmitEdit(
              "removeNotes",
              scope,
              { noteIds: [note.id] },
              `删除 ${noteName} 音符`,
            )
          }
        >
          删除
        </button>
      </div>
    </form>
  );
}

function midiNoteName(pitch: number) {
  const noteNames = [
    "C",
    "C#",
    "D",
    "D#",
    "E",
    "F",
    "F#",
    "G",
    "G#",
    "A",
    "A#",
    "B",
  ];
  return `${noteNames[pitch % 12]}${Math.floor(pitch / 12) - 1}`;
}

/** @deprecated Transitional desktop migration reference; the app renders Chat below. */
// eslint-disable-next-line @typescript-eslint/no-unused-vars -- retained only for legacy gateway protocol comparison.
function LegacyGatewayChat({
  project,
  onAcceptProposal,
}: {
  project: ProjectDocument;
  onAcceptProposal: (batch: OperationBatch) => boolean;
}) {
  const gatewayUrl = configuredGatewayUrl();
  const [accountMode, setAccountMode] = useState<"login" | "register">("login");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [account, setAccount] = useState<ProductAccount | null>(null);
  const [session, setSession] = useState<ProductSession | null>(null);
  const [usage, setUsage] = useState<ProductUsage | null>(null);
  const [sessionExpiresAtMs, setSessionExpiresAtMs] = useState<number | null>(
    null,
  );
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] =
    useState<GatewayGenerationStrategy>("replace");
  const [provider, setProvider] = useState<GatewayModelProvider>("openai");
  const [selectedTarget, setSelectedTarget] = useState<PianoRollTarget>(() => ({
    trackId: project.tracks[0]?.id ?? "",
    sectionId: project.sections[0]?.id ?? "",
  }));
  const [proposal, setProposal] = useState<LocalNoteProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setWorking] = useState(false);
  const requestController = useRef<AbortController | null>(null);

  const selectedTrack =
    project.tracks.find((track) => track.id === selectedTarget.trackId) ??
    project.tracks[0];
  const selectedSection =
    project.sections.find(
      (section) => section.id === selectedTarget.sectionId,
    ) ?? project.sections[0];
  const selectedClip =
    selectedTrack && selectedSection
      ? project.clips.find(
          (clip) =>
            clip.trackId === selectedTrack.id &&
            clip.sectionId === selectedSection.id,
        )
      : undefined;

  useEffect(() => {
    if (!session || !sessionExpiresAtMs) return;
    const remainingMs = sessionExpiresAtMs - Date.now();
    if (remainingMs <= 0) {
      setAccount(null);
      setSession(null);
      setSessionExpiresAtMs(null);
      setUsage(null);
      setProposal(null);
      setMessage("本机 AI 会话已到期。请重新登录；当前工程没有被修改。");
      return;
    }
    const timer = window.setTimeout(() => {
      setAccount(null);
      setSession(null);
      setSessionExpiresAtMs(null);
      setUsage(null);
      setProposal(null);
      setMessage("本机 AI 会话已到期。请重新登录；当前工程没有被修改。");
    }, remainingMs);
    return () => window.clearTimeout(timer);
  }, [session, sessionExpiresAtMs]);

  useEffect(() => {
    if (!session || !gatewayUrl) {
      setUsage(null);
      return;
    }
    let cancelled = false;
    void new GatewayClient(gatewayUrl)
      .getUsage(session.accessToken)
      .then((nextUsage) => {
        if (!cancelled) setUsage(nextUsage);
      })
      .catch(() => {
        if (!cancelled) setUsage(null);
      });
    return () => {
      cancelled = true;
    };
  }, [gatewayUrl, session]);

  const requireGateway = (): GatewayClient | null => {
    if (gatewayUrl) return new GatewayClient(gatewayUrl);
    setError(
      "本机 AI 网关尚未配置。请先在 gateway/.env.local 保存 API Key 并启动网关；当前工程不会被修改。",
    );
    return null;
  };

  const handleAccountSubmit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const client = requireGateway();
    if (!client || isWorking) return;
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      if (accountMode === "register") {
        await client.register(email, password);
        setAccountMode("login");
        setPassword("");
        setMessage(
          "本地网关账户已创建，请使用同一邮箱登录。登录会话只保留在本次运行内存中。",
        );
      } else {
        const result = await client.login(email, password);
        setAccount(result.account);
        setSession(result.session);
        setUsage(null);
        setSessionExpiresAtMs(
          Date.now() + result.session.expiresInSeconds * 1_000,
        );
        setPassword("");
        setMessage("已连接本机 AI 网关。请选择服务商后确认范围与数据说明。");
      }
    } catch (cause) {
      if (
        cause instanceof GatewayClientError &&
        (cause.code === "invalid_session" ||
          cause.code === "authentication_required")
      ) {
        setAccount(null);
        setSession(null);
        setSessionExpiresAtMs(null);
        setUsage(null);
        setProposal(null);
      }
      setError(formatGatewayError(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleGenerate = async () => {
    const client = requireGateway();
    if (
      !client ||
      !session ||
      !selectedTrack ||
      !selectedSection ||
      isWorking
    ) {
      if (!session) setError("请先登录本地网关账户，再请求 AI 候选。");
      return;
    }
    if (!prompt.trim()) {
      setError("请输入希望生成或修改的音乐描述。");
      return;
    }
    const controller = new AbortController();
    requestController.current = controller;
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      setProposal(null);
      const remoteProposal = await client.generateNotes(
        session.accessToken,
        {
          provider,
          prompt: prompt.trim(),
          strategy,
          scope: {
            trackId: selectedTrack.id,
            sectionId: selectedSection.id,
            sectionBeats: selectedSection.bars * 4,
            role: selectedTrack.role,
            tempo: project.meta.tempo,
            key: project.meta.key,
            mode: project.meta.mode,
          },
          contextNotes: (selectedClip?.notes ?? [])
            .slice(0, 120)
            .map(({ start, dur, pitch, vel }) => ({ start, dur, pitch, vel })),
        },
        controller.signal,
      );
      const local = buildLocalNoteProposal(
        project,
        { trackId: selectedTrack.id, sectionId: selectedSection.id },
        strategy,
        remoteProposal,
      );
      if (!local.ok) {
        setError(local.message);
        return;
      }
      setProposal(local.proposal);
      void client
        .getUsage(session.accessToken)
        .then((nextUsage) => setUsage(nextUsage))
        .catch(() => undefined);
      setMessage(
        "候选已通过本地工程校验，尚未写入工程。请查看范围后接受或拒绝。",
      );
    } catch (cause) {
      setError(formatGatewayError(cause));
    } finally {
      requestController.current = null;
      setWorking(false);
    }
  };

  const handleCancelGeneration = () => requestController.current?.abort();

  const handleDisconnect = async () => {
    requestController.current?.abort();
    const client = gatewayUrl ? new GatewayClient(gatewayUrl) : null;
    const token = session?.accessToken;
    setAccount(null);
    setSession(null);
    setSessionExpiresAtMs(null);
    setUsage(null);
    setProposal(null);
    setMessage("已在此设备断开本机 AI 会话；当前工程没有被修改。");
    if (client && token) {
      try {
        await client.logout(token);
      } catch {
        setMessage(
          "本地会话已断开；网关登出确认失败，请下次登录时检查账户状态。",
        );
      }
    }
  };

  const handleAcceptProposal = () => {
    if (!proposal) return;
    if (proposal.sourceDocumentFingerprint !== projectFingerprint(project)) {
      setProposal(null);
      setError(
        "工程已在生成候选后发生变化。为避免覆盖新修改，请重新生成候选。",
      );
      return;
    }
    if (onAcceptProposal(proposal.batch)) {
      setMessage(
        "已将 AI 候选作为一个可撤销批次写入工程。请回到 Demo 重新播放试听。",
      );
      setProposal(null);
    }
  };

  if (!selectedTrack || !selectedSection) {
    return (
      <section className="panel">
        <p className="eyebrow">Optional cloud feature</p>
        <h1>AI Chat</h1>
        <p>当前工程没有可供 AI 生成的轨道或段落。请先新建工程或选择模板。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="eyebrow">Optional local API feature</p>
      <h1>AI Chat</h1>
      <div className="ai-status" data-tutorial="ai-status">
        <strong>
          {session && account ? `已连接 · ${account.email}` : "未连接"}
        </strong>
        <p>
          开发期由仅监听本机的 AI 网关生成候选。你可选择 OpenAI 或 Gemini；对应
          API Key 只由网关从本地配置文件读取，
          不会出现在应用、工程、日志或浏览器请求中。
        </p>
        <label className="ai-provider-select">
          AI 服务商
          <select
            aria-label="AI 服务商"
            value={provider}
            disabled={isWorking}
            onChange={(event) => {
              setProvider(event.target.value as GatewayModelProvider);
              setProposal(null);
              setError(null);
            }}
          >
            <option value="openai">OpenAI</option>
            <option value="gemini">Gemini</option>
          </select>
        </label>
      </div>
      <p className="ai-notice" data-tutorial="ai-local-key">
        首次使用：将所选服务商的个人 Key（<code>OPENAI_API_KEY</code> 或{" "}
        <code>GEMINI_API_KEY</code>
        ）保存到 <code>gateway/.env.local</code>
        ，并启动本机网关。不要在此页面、工程文件或提示词中粘贴 Key。
      </p>
      {!gatewayUrl && (
        <p className="ai-notice" role="status">
          此开发包尚未设置 <code>VITE_GATEWAY_URL</code>
          ，因此生成保持关闭；请按本地网关说明配置并启动服务。手工编辑与导出不受影响。
        </p>
      )}
      {!session ? (
        <form
          className="ai-account-form"
          onSubmit={(event) => void handleAccountSubmit(event)}
        >
          <h2>
            {accountMode === "login" ? "登录本地网关账户" : "创建本地网关账户"}
          </h2>
          <p>
            此临时账户只用于本机网关会话与调用次数限制，数据会在网关重启后清空。
          </p>
          <label>
            邮箱
            <input
              type="email"
              autoComplete="email"
              value={email}
              onChange={(event) => setEmail(event.target.value)}
              required
              disabled={isWorking || !gatewayUrl}
            />
          </label>
          <label>
            密码
            <input
              type="password"
              autoComplete={
                accountMode === "login" ? "current-password" : "new-password"
              }
              minLength={12}
              value={password}
              onChange={(event) => setPassword(event.target.value)}
              required
              disabled={isWorking || !gatewayUrl}
            />
          </label>
          <div className="ai-actions">
            <button
              className="primary-button"
              type="submit"
              disabled={isWorking || !gatewayUrl}
            >
              {isWorking
                ? "正在处理…"
                : accountMode === "login"
                  ? "登录并连接"
                  : "创建账户"}
            </button>
            <button
              type="button"
              disabled={isWorking}
              onClick={() => {
                setAccountMode((mode) =>
                  mode === "login" ? "register" : "login",
                );
                setError(null);
                setMessage(null);
              }}
            >
              {accountMode === "login" ? "创建账户" : "返回登录"}
            </button>
          </div>
        </form>
      ) : (
        <div className="ai-generation" data-tutorial="ai-scope">
          <h2>生成候选</h2>
          <p>
            只会发送下方选定的轨道 × 段落、全局 tempo/key/mode 和此片段最多 120
            个音符；不会发送整个工程或本地路径。
          </p>
          {usage && (
            <p className="ai-usage" role="status">
              当前本地额度：今日 {usage.dailyUsed}/{usage.dailyLimit} 次 ·
              本分钟 {usage.minuteUsed}/{usage.minuteLimit} 次
            </p>
          )}
          <div className="ai-scope-controls">
            <label>
              轨道
              <select
                value={selectedTrack.id}
                disabled={isWorking}
                onChange={(event) =>
                  setSelectedTarget((target) => ({
                    ...target,
                    trackId: event.target.value,
                  }))
                }
              >
                {project.tracks.map((track) => (
                  <option key={track.id} value={track.id}>
                    {track.name}（{track.role}）
                  </option>
                ))}
              </select>
            </label>
            <label>
              段落
              <select
                value={selectedSection.id}
                disabled={isWorking}
                onChange={(event) =>
                  setSelectedTarget((target) => ({
                    ...target,
                    sectionId: event.target.value,
                  }))
                }
              >
                {project.sections.map((section) => (
                  <option key={section.id} value={section.id}>
                    {section.name}（{section.bars} 小节）
                  </option>
                ))}
              </select>
            </label>
            <label>
              策略
              <select
                value={strategy}
                disabled={isWorking}
                onChange={(event) =>
                  setStrategy(event.target.value as GatewayGenerationStrategy)
                }
              >
                <option value="replace">替换当前片段</option>
                <option value="overdub">叠加到当前片段</option>
              </select>
            </label>
          </div>
          <label className="ai-prompt">
            想要的音乐变化
            <textarea
              value={prompt}
              maxLength={1600}
              disabled={isWorking}
              onChange={(event) => setPrompt(event.target.value)}
              placeholder="例如：写一条温暖、上行的 4 小节旋律"
            />
          </label>
          <div className="ai-actions">
            <button
              className="primary-button"
              type="button"
              onClick={() => void handleGenerate()}
              disabled={isWorking}
            >
              {isWorking ? "正在生成…" : "生成候选"}
            </button>
            {isWorking && (
              <button type="button" onClick={handleCancelGeneration}>
                取消请求
              </button>
            )}
            <button
              type="button"
              onClick={() => void handleDisconnect()}
              disabled={isWorking}
            >
              断开连接
            </button>
          </div>
        </div>
      )}
      {proposal && (
        <section className="ai-proposal" data-tutorial="ai-proposal">
          <p className="eyebrow">候选（尚未写入工程）</p>
          <h2>{proposal.summary}</h2>
          <p>
            {selectedTrack.name} / {selectedSection.name} ·{" "}
            {proposal.strategy === "replace" ? "替换" : "叠加"} ·{" "}
            {proposal.noteCount} 个音符
          </p>
          <p>
            候选已在当前工程副本上完成原语和 Schema 校验。试听预览仍在后续
            RenderPlan 工作项中；现在接受会写入一个可撤销批次。
          </p>
          <div className="ai-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleAcceptProposal}
            >
              接受并写入工程
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              拒绝候选
            </button>
          </div>
        </section>
      )}
      {message && (
        <p className="ai-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="audio-error" role="alert">
          AI 操作未完成：{error}
        </p>
      )}
    </section>
  );
}

function formatGatewayError(cause: unknown): string {
  if (cause instanceof GatewayClientError) {
    return `${cause.message}${cause.retryAfterSeconds ? `（建议 ${cause.retryAfterSeconds} 秒后重试）` : ""}${cause.requestId ? ` · 请求 ID：${cause.requestId}` : ""}`;
  }
  if (cause instanceof Error) return cause.message;
  return "AI 服务暂时不可用，请稍后重试或继续手工编辑。";
}

/** The production desktop path: no browser server, local HTTP gateway, or account form. */
function Chat({
  project,
  journeyRequest,
  onJourneyProposalAccepted,
  onAcceptProposal,
}: {
  project: ProjectDocument;
  journeyRequest: JourneyAiRequest | null;
  onJourneyProposalAccepted: (sectionId: string) => void;
  onAcceptProposal: (batch: OperationBatch) => boolean;
}) {
  const client = useMemo(() => new DesktopAiClient(), []);
  const [nativeStatus, setNativeStatus] = useState<DesktopAiStatus | null>(
    null,
  );
  const [provider, setProvider] = useState<GatewayModelProvider>("gemini");
  const [apiKey, setApiKey] = useState("");
  const [prompt, setPrompt] = useState("");
  const [strategy, setStrategy] =
    useState<GatewayGenerationStrategy>("replace");
  const [selectedTarget, setSelectedTarget] = useState<PianoRollTarget>(() => ({
    trackId: project.tracks[0]?.id ?? "",
    sectionId: project.sections[0]?.id ?? "",
  }));
  const [proposal, setProposal] = useState<LocalNoteProposal | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isWorking, setWorking] = useState(false);

  const selectedTrack =
    project.tracks.find((track) => track.id === selectedTarget.trackId) ??
    project.tracks[0];
  const selectedSection =
    project.sections.find(
      (section) => section.id === selectedTarget.sectionId,
    ) ?? project.sections[0];
  const selectedClip =
    selectedTrack && selectedSection
      ? project.clips.find(
          (clip) =>
            clip.trackId === selectedTrack.id &&
            clip.sectionId === selectedSection.id,
        )
      : undefined;
  const providerConfigured = Boolean(
    nativeStatus?.providers.find((item) => item.provider === provider)
      ?.configured,
  );
  const providerName = provider === "gemini" ? "Gemini" : "OpenAI";

  const refreshStatus = async () => {
    const status = await client.getStatus();
    setNativeStatus(status);
    return status;
  };

  useEffect(() => {
    let cancelled = false;
    void refreshStatus().catch((cause) => {
      if (!cancelled) setError(formatDesktopAiError(cause));
    });
    return () => {
      cancelled = true;
    };
  }, [client]);

  useEffect(() => {
    if (!journeyRequest) return;
    setSelectedTarget(journeyRequest.target);
    setPrompt(journeyRequest.prompt);
    setStrategy("replace");
    setProposal(null);
    setError(null);
    setMessage(
      "已带入创作任务的下一段。请先配置 Key、生成候选并确认后再写入工程。",
    );
  }, [journeyRequest]);

  const handleSaveKey = async () => {
    if (isWorking) return;
    if (!apiKey.trim()) {
      setError("请输入 API Key；它会直接保存到 macOS 钥匙串，不会写入工程。");
      return;
    }
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      setNativeStatus(await client.saveKey(provider, apiKey));
      setApiKey("");
      setMessage(`${providerName} API Key 已保存到 macOS 钥匙串。`);
    } catch (cause) {
      setError(formatDesktopAiError(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleRemoveKey = async () => {
    if (
      isWorking ||
      !window.confirm(`确定从 macOS 钥匙串删除 ${providerName} API Key 吗？`)
    ) {
      return;
    }
    try {
      setWorking(true);
      setError(null);
      setProposal(null);
      setNativeStatus(await client.removeKey(provider));
      setMessage(`${providerName} API Key 已从此 Mac 的钥匙串删除。`);
    } catch (cause) {
      setError(formatDesktopAiError(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleGenerate = async () => {
    if (!selectedTrack || !selectedSection || isWorking) return;
    if (!providerConfigured) {
      setError(`请先在此页面保存 ${providerName} API Key。`);
      return;
    }
    if (!prompt.trim()) {
      setError("请输入希望生成或修改的音乐描述。");
      return;
    }
    try {
      setWorking(true);
      setError(null);
      setMessage(null);
      setProposal(null);
      const remoteProposal = await client.generateNotes({
        provider,
        prompt: prompt.trim(),
        strategy,
        scope: {
          trackId: selectedTrack.id,
          sectionId: selectedSection.id,
          sectionBeats: selectedSection.bars * 4,
          role: selectedTrack.role,
          tempo: project.meta.tempo,
          key: project.meta.key,
          mode: project.meta.mode,
        },
        contextNotes: (selectedClip?.notes ?? [])
          .slice(0, 120)
          .map(({ start, dur, pitch, vel }) => ({ start, dur, pitch, vel })),
      });
      const local = buildLocalNoteProposal(
        project,
        { trackId: selectedTrack.id, sectionId: selectedSection.id },
        strategy,
        remoteProposal,
      );
      if (!local.ok) {
        setError(local.message);
        return;
      }
      setProposal(local.proposal);
      setMessage(
        "候选已通过原生侧和本地工程校验，尚未写入工程。请查看范围后接受或拒绝。",
      );
    } catch (cause) {
      setError(formatDesktopAiError(cause));
    } finally {
      setWorking(false);
    }
  };

  const handleAcceptProposal = () => {
    if (!proposal) return;
    if (proposal.sourceDocumentFingerprint !== projectFingerprint(project)) {
      setProposal(null);
      setError(
        "工程已在生成候选后发生变化。为避免覆盖新修改，请重新生成候选。",
      );
      return;
    }
    if (onAcceptProposal(proposal.batch)) {
      setMessage(
        "已将 AI 候选作为一个可撤销批次写入工程。请回到 Demo 重新播放试听。",
      );
      if (
        journeyRequest &&
        journeyRequest.target.trackId === selectedTrack.id &&
        journeyRequest.target.sectionId === selectedSection.id
      ) {
        onJourneyProposalAccepted(selectedSection.id);
      }
      setProposal(null);
    } else {
      setError(
        "候选未能写入工程。请先停止播放或录制后重试；若仍失败，请保留当前页面并将错误提示发送给我们。",
      );
    }
  };

  if (!selectedTrack || !selectedSection) {
    return (
      <section className="panel">
        <p className="eyebrow">Optional desktop AI feature</p>
        <h1>AI Chat</h1>
        <p>当前工程没有可供 AI 生成的轨道或段落。请先新建工程或选择模板。</p>
      </section>
    );
  }

  return (
    <section className="panel">
      <p className="eyebrow">Native macOS AI feature</p>
      <h1>AI Chat</h1>
      {journeyRequest && (
        <p className="journey-note" role="status">
          创作任务正在扩展“{selectedSection.name}”。本次请求只包含当前段落所需的
          MIDI 上下文与已确认的文字方向；不会发送参考音频原文件或路径。
        </p>
      )}
      <div className="ai-status" data-tutorial="ai-status">
        <strong>
          {nativeStatus ? "桌面原生 AI 已就绪" : "正在检查 macOS 钥匙串…"}
        </strong>
        <p>
          OpenAI 与 Gemini 请求直接由 AI Music IDE 的原生进程发出。Key 仅保存在
          macOS 钥匙串；首次解锁后仅在本次应用会话的原生内存保留 12
          小时，退出应用即清除， 无需浏览器、Node 网关、本地端口或临时账户。
        </p>
        <label className="ai-provider-select">
          AI 服务商
          <select
            aria-label="AI 服务商"
            value={provider}
            disabled={isWorking}
            onChange={(event) => {
              setProvider(event.target.value as GatewayModelProvider);
              setProposal(null);
              setError(null);
            }}
          >
            <option value="gemini">Gemini</option>
            <option value="openai">OpenAI</option>
          </select>
        </label>
      </div>
      <section className="ai-account-form" data-tutorial="ai-local-key">
        <h2>{providerName} 本机配置</h2>
        <p>
          {providerConfigured
            ? `${providerName} Key 已保存在 macOS 钥匙串。可输入新 Key 覆盖，或将其删除。`
            : `尚未配置 ${providerName} Key。输入后只会交给 macOS 钥匙串保存。`}
        </p>
        <label>
          {providerConfigured ? "更新 API Key（可选）" : "API Key"}
          <input
            type="password"
            autoComplete="off"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={isWorking}
            placeholder={
              providerConfigured ? "输入新 Key 以覆盖" : "粘贴 API Key"
            }
          />
        </label>
        <div className="ai-actions">
          <button
            className="primary-button"
            type="button"
            disabled={isWorking || !apiKey.trim()}
            onClick={() => void handleSaveKey()}
          >
            {isWorking ? "正在保存…" : "保存到 macOS 钥匙串"}
          </button>
          {providerConfigured && (
            <button
              type="button"
              disabled={isWorking}
              onClick={() => void handleRemoveKey()}
            >
              删除本机 Key
            </button>
          )}
        </div>
      </section>
      <div className="ai-generation" data-tutorial="ai-scope">
        <h2>生成候选</h2>
        <p>
          只会发送下方选定的轨道 × 段落、全局 tempo/key/mode 和此片段最多 120
          个音符；不会发送整个工程、本地路径或凭据。
        </p>
        {!providerConfigured && (
          <p className="ai-notice" role="status">
            先完成 {providerName} 的本机 Key
            配置，生成按钮才会启用。手工编辑与导出不受影响。
          </p>
        )}
        <div className="ai-scope-controls">
          <label>
            轨道
            <select
              value={selectedTrack.id}
              disabled={isWorking}
              onChange={(event) =>
                setSelectedTarget((target) => ({
                  ...target,
                  trackId: event.target.value,
                }))
              }
            >
              {project.tracks.map((track) => (
                <option key={track.id} value={track.id}>
                  {track.name}（{track.role}）
                </option>
              ))}
            </select>
          </label>
          <label>
            段落
            <select
              value={selectedSection.id}
              disabled={isWorking}
              onChange={(event) =>
                setSelectedTarget((target) => ({
                  ...target,
                  sectionId: event.target.value,
                }))
              }
            >
              {project.sections.map((section) => (
                <option key={section.id} value={section.id}>
                  {section.name}（{section.bars} 小节）
                </option>
              ))}
            </select>
          </label>
          <label>
            策略
            <select
              value={strategy}
              disabled={isWorking}
              onChange={(event) =>
                setStrategy(event.target.value as GatewayGenerationStrategy)
              }
            >
              <option value="replace">替换当前片段</option>
              <option value="overdub">叠加到当前片段</option>
            </select>
          </label>
        </div>
        <label className="ai-prompt">
          想要的音乐变化
          <textarea
            value={prompt}
            maxLength={1600}
            disabled={isWorking}
            onChange={(event) => setPrompt(event.target.value)}
            placeholder="例如：写一条温暖、上行的 4 小节旋律"
          />
        </label>
        <div className="ai-actions">
          <button
            className="primary-button"
            type="button"
            onClick={() => void handleGenerate()}
            disabled={isWorking || !providerConfigured}
          >
            {isWorking ? "正在生成…" : "生成候选"}
          </button>
        </div>
      </div>
      {proposal && (
        <section className="ai-proposal" data-tutorial="ai-proposal">
          <p className="eyebrow">候选（尚未写入工程）</p>
          <h2>{proposal.summary}</h2>
          <p>
            {selectedTrack.name} / {selectedSection.name} ·{" "}
            {proposal.strategy === "replace" ? "替换" : "叠加"} ·{" "}
            {proposal.noteCount} 个音符
          </p>
          <p>
            候选已在当前工程副本上完成原语和 Schema 校验。试听预览仍在后续
            RenderPlan 工作项中；现在接受会写入一个可撤销批次。
          </p>
          <div className="ai-actions">
            <button
              className="primary-button"
              type="button"
              onClick={handleAcceptProposal}
            >
              接受并写入工程
            </button>
            <button type="button" onClick={() => setProposal(null)}>
              拒绝候选
            </button>
          </div>
        </section>
      )}
      {message && (
        <p className="ai-notice" role="status">
          {message}
        </p>
      )}
      {error && (
        <p className="audio-error" role="alert">
          AI 操作未完成：{error}
        </p>
      )}
    </section>
  );
}

function formatDesktopAiError(cause: unknown): string {
  if (cause instanceof DesktopAiClientError) return cause.message;
  if (cause instanceof Error) return cause.message;
  return "桌面 AI 服务暂时不可用，请稍后重试或继续手工编辑。";
}
