import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getTutorialById } from "./content";
import { emptyTutorialProgress } from "./progress";
import { TutorialDrawer } from "./TutorialDrawer";
import type { TutorialDefinition } from "./types";

const welcomeTutorial = getTutorialById("welcome-basics");
if (!welcomeTutorial) throw new Error("缺少欢迎教程 fixture。");
const tutorial: TutorialDefinition = welcomeTutorial;

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function renderDrawer(anchor = true) {
  container = document.createElement("div");
  document.body.append(container);
  if (anchor) {
    const target = document.createElement("button");
    target.dataset.tutorial = "project-summary";
    document.body.append(target);
  }
  root = createRoot(container);
  const onClose = vi.fn();
  const onProgressChange = vi.fn();
  act(() => {
    root?.render(
      <TutorialDrawer
        isOpen
        tutorial={tutorial}
        progress={emptyTutorialProgress()}
        onClose={onClose}
        onProgressChange={onProgressChange}
      />,
    );
  });
  return { onClose, onProgressChange };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
  document
    .querySelectorAll("[data-tutorial]")
    .forEach((element) => element.remove());
});

describe("TutorialDrawer", () => {
  it("显示目标、预期结果、错误恢复与完整控制项", () => {
    renderDrawer();

    expect(container?.textContent).toContain("目标：");
    expect(container?.textContent).toContain("预期结果：");
    expect(container?.textContent).toContain("常见错误");
    expect(container?.textContent).toContain("重新开始");
    expect(
      document
        .querySelector("[data-tutorial='project-summary']")
        ?.classList.contains("tutorial-anchor-highlight"),
    ).toBe(true);
  });

  it("锚点缺失时提供文字降级", () => {
    renderDrawer(false);

    expect(container?.textContent).toContain("当前目标暂未显示");
  });

  it("按 Esc 关闭且不改写编辑状态", () => {
    const { onClose, onProgressChange } = renderDrawer();

    act(() =>
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "Escape" })),
    );

    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onProgressChange).not.toHaveBeenCalled();
  });
});
