import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getBuiltInDemo } from "../doc/demo";
import { createCreativeJourney } from "./progress";
import { CreativeJourneyScreen } from "./CreativeJourney";

let container: HTMLDivElement | undefined;
let root: Root | undefined;

function renderJourney(journey = createCreativeJourney()) {
  container = document.createElement("div");
  document.body.append(container);
  root = createRoot(container);
  const onTapScaleKey = vi.fn<(key: string) => Promise<void>>(() =>
    Promise.resolve(),
  );
  const onJourneyChange = vi.fn();
  act(() => {
    root?.render(
      <CreativeJourneyScreen
        project={getBuiltInDemo()}
        journey={journey}
        onJourneyChange={onJourneyChange}
        onCreateWorkshop={vi.fn()}
        onApplyLength={() => true}
        onTapScaleKey={onTapScaleKey}
        audioError={null}
        onSubmitOperations={() => true}
        onOpenAi={vi.fn()}
        onOpenManualEdit={vi.fn()}
        onOpenExport={vi.fn()}
      />,
    );
  });
  return { onJourneyChange, onTapScaleKey };
}

afterEach(() => {
  act(() => root?.unmount());
  root = undefined;
  container?.remove();
  container = undefined;
});

describe("新手创作旅程键盘热身", () => {
  it("用实体 QWERT 触发真实试听完成后才更新任务进度", async () => {
    const { onTapScaleKey } = renderJourney();

    for (const key of ["q", "w", "e", "r", "t"]) {
      await act(async () => {
        window.dispatchEvent(new KeyboardEvent("keydown", { key }));
        await Promise.resolve();
      });
    }

    expect(onTapScaleKey.mock.calls.map(([key]) => key)).toEqual([
      "q",
      "w",
      "e",
      "r",
      "t",
    ]);
    expect(container?.textContent).toContain(
      "完成！你刚刚用音阶做出了一句上行旋律。",
    );
    expect(
      Array.from(
        container?.querySelectorAll(".journey-keys button") ?? [],
      ).every((button) => button.classList.contains("is-complete")),
    ).toBe(true);
  });

  it("忽略长按重复事件和文本输入内的按键", async () => {
    const { onTapScaleKey } = renderJourney();
    const input = document.createElement("input");
    document.body.append(input);

    await act(async () => {
      input.dispatchEvent(
        new KeyboardEvent("keydown", { key: "q", bubbles: true }),
      );
      window.dispatchEvent(
        new KeyboardEvent("keydown", { key: "q", repeat: true }),
      );
      window.dispatchEvent(new KeyboardEvent("keydown", { key: "q" }));
      await Promise.resolve();
    });

    expect(onTapScaleKey).toHaveBeenCalledTimes(1);
    input.remove();
  });

  it("试听失败时不伪造完成进度，并在当前页面展示原因", async () => {
    const failure = vi.fn<(key: string) => Promise<void>>(async () => {
      throw new Error("真实钢琴采样无法读取");
    });
    renderJourney();
    act(() => {
      root?.render(
        <CreativeJourneyScreen
          project={getBuiltInDemo()}
          journey={createCreativeJourney()}
          onJourneyChange={vi.fn()}
          onCreateWorkshop={vi.fn()}
          onApplyLength={() => true}
          onTapScaleKey={failure}
          audioError="真实钢琴采样无法读取"
          onSubmitOperations={() => true}
          onOpenAi={vi.fn()}
          onOpenManualEdit={vi.fn()}
          onOpenExport={vi.fn()}
        />,
      );
    });

    await act(async () => {
      (
        container?.querySelector(".journey-keys button") as HTMLButtonElement
      ).click();
      await Promise.resolve();
    });

    expect(failure).toHaveBeenCalledWith("q");
    expect(container?.textContent).toContain(
      "未能试听 Q：真实钢琴采样无法读取",
    );
    expect(container?.textContent).toContain(
      "音频不可用：真实钢琴采样无法读取",
    );
    expect(container?.textContent).toContain("进度 0/5");
  });

  it("任意非首步都可返回上一步，同时保留已填写的创作方向", () => {
    const journey = createCreativeJourney();
    journey.stage = "brief";
    journey.brief.userCorrection = "鼓点不要太密";
    const { onJourneyChange } = renderJourney(journey);

    act(() =>
      (
        container?.querySelector(
          ".journey-back-row button",
        ) as HTMLButtonElement
      ).click(),
    );

    expect(onJourneyChange).toHaveBeenCalledWith(
      expect.objectContaining({
        stage: "audio-seeds",
        brief: expect.objectContaining({ userCorrection: "鼓点不要太密" }),
      }),
    );
  });
});
