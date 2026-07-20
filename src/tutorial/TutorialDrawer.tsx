import { useEffect, useMemo, useState } from "react";
import { entryForTutorial, updateTutorialProgress } from "./progress";
import type { TutorialDefinition, TutorialProgress } from "./types";

interface TutorialDrawerProps {
  isOpen: boolean;
  tutorial: TutorialDefinition;
  progress: TutorialProgress;
  onProgressChange: (next: TutorialProgress) => void;
  onClose: () => void;
}

export function TutorialDrawer({
  isOpen,
  tutorial,
  progress,
  onProgressChange,
  onClose,
}: TutorialDrawerProps) {
  const entry = useMemo(
    () => entryForTutorial(progress, tutorial),
    [progress, tutorial],
  );
  const [anchorAvailable, setAnchorAvailable] = useState(true);
  const step = tutorial.steps[entry.stepIndex] ?? tutorial.steps[0];

  useEffect(() => {
    if (!isOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    if (!isOpen || !step?.anchor) {
      setAnchorAvailable(true);
      return;
    }
    const target = document.querySelector<HTMLElement>(
      `[data-tutorial="${step.anchor}"]`,
    );
    if (!target) {
      setAnchorAvailable(false);
      return;
    }
    setAnchorAvailable(true);
    target.classList.add("tutorial-anchor-highlight");
    return () => target.classList.remove("tutorial-anchor-highlight");
  }, [isOpen, step?.anchor]);

  if (!isOpen || !step) return null;

  const change = (
    status: "in_progress" | "completed" | "skipped",
    stepIndex: number,
  ) => {
    onProgressChange(
      updateTutorialProgress(progress, tutorial, status, stepIndex),
    );
  };
  const isFirst = entry.stepIndex === 0;
  const isLast = entry.stepIndex === tutorial.steps.length - 1;

  return (
    <aside
      className="tutorial-drawer"
      aria-label="当前页面教程"
      aria-live="polite"
    >
      <div className="tutorial-drawer__header">
        <div>
          <p className="eyebrow">当前页面教程</p>
          <h2>{tutorial.title}</h2>
        </div>
        <button
          className="icon-button"
          type="button"
          onClick={onClose}
          aria-label="关闭当前页面教程"
        >
          ×
        </button>
      </div>

      <p className="tutorial-goal">
        <strong>目标：</strong>
        {tutorial.goal}
      </p>
      <p>
        <strong>前置条件：</strong>
        {tutorial.prerequisites}
      </p>
      <p className="step-count">
        第 {entry.stepIndex + 1} / {tutorial.steps.length} 步
      </p>
      <section
        className="tutorial-step"
        aria-describedby="tutorial-step-description"
      >
        <h3>{step.title}</h3>
        <p id="tutorial-step-description">{step.instruction}</p>
        <p>
          <strong>预期结果：</strong>
          {step.expectedResult}
        </p>
        <p className="sr-only">高亮元素说明：{step.accessibilityText}</p>
        {!anchorAvailable && (
          <p className="tutorial-fallback" role="status">
            当前目标暂未显示。请阅读本步骤文字说明，或在页面准备好后选择“重试定位”。
          </p>
        )}
      </section>
      <section className="tutorial-warning" aria-label="常见错误与恢复方式">
        <h3>常见错误</h3>
        <p>{tutorial.commonMistake}</p>
        <p>
          <strong>恢复：</strong>
          {tutorial.recovery}
        </p>
      </section>
      <div className="tutorial-actions">
        <button
          type="button"
          onClick={() =>
            change("in_progress", Math.max(0, entry.stepIndex - 1))
          }
          disabled={isFirst}
        >
          上一步
        </button>
        <button
          type="button"
          onClick={() =>
            change(
              isLast ? "completed" : "in_progress",
              isLast ? entry.stepIndex : entry.stepIndex + 1,
            )
          }
        >
          {isLast ? "完成" : "下一步"}
        </button>
        <button
          type="button"
          onClick={() =>
            setAnchorAvailable(
              Boolean(
                document.querySelector(`[data-tutorial="${step.anchor}"]`),
              ),
            )
          }
        >
          重试定位
        </button>
        <button
          type="button"
          onClick={() => change("skipped", entry.stepIndex)}
        >
          跳过
        </button>
        <button type="button" onClick={() => change("in_progress", 0)}>
          重新开始
        </button>
      </div>
    </aside>
  );
}
