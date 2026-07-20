import { describe, expect, it } from "vitest";
import { resolveTutorial } from "./content";

describe("Demo 教程", () => {
  it("说明播放、循环、完整音阶键盘映射、手工修改和音频失败恢复", () => {
    const tutorial = resolveTutorial({ route: "demo" });

    expect(tutorial.contentVersion).toBe(20);
    expect(tutorial.steps.map((step) => step.anchor)).toEqual([
      "transport-controls",
      "keyboard-map",
      "quick-mix-editor",
      "undo-redo-controls",
      "file-actions",
    ]);
    expect(tutorial.commonMistake).toContain("输出设备");
    expect(tutorial.recovery).toContain("音频不可用");
    expect(tutorial.steps[1]?.instruction).toContain("Q、W、E、R、T、Y、U");
    expect(tutorial.steps[1]?.instruction).toContain("Z/X");
    expect(tutorial.steps[1]?.instruction).toContain("页面上的对应白色键");
    expect(tutorial.steps[1]?.expectedResult).toContain("反复切换八度后");
    expect(tutorial.steps[1]?.expectedResult).toContain("不会写入工程");
    expect(tutorial.steps[2]?.instruction).toContain("先校验再整体应用");
    expect(tutorial.steps[2]?.expectedResult).toContain("导出 MIDI/WAV");
    expect(tutorial.steps[3]?.instruction).toContain("重做记录");
    expect(tutorial.steps[4]?.instruction).toContain("另存为");
    expect(tutorial.steps[4]?.instruction).toContain("导出 MIDI");
    expect(tutorial.steps[4]?.instruction).toContain("导出 WAV");
  });
});

describe("欢迎页教程", () => {
  it("说明空白工程、内置模板和 Demo 的入口", () => {
    const tutorial = resolveTutorial({ route: "welcome" });

    expect(tutorial.contentVersion).toBe(20);
    expect(tutorial.steps.map((step) => step.anchor)).toContain(
      "project-start",
    );
    expect(tutorial.steps.at(-2)?.instruction).toContain("内置模板");
    expect(tutorial.steps.at(-1)?.anchor).toBe("recovery-actions");
  });
});

describe("新手创作旅程教程", () => {
  it("说明从热身到本机参考、逐段扩展和导出的完整闭环", () => {
    const tutorial = resolveTutorial({ route: "journey" });

    expect(tutorial.steps).toHaveLength(4);
    expect(
      tutorial.steps.every((step) => step.anchor === "creative-journey"),
    ).toBe(true);
    expect(tutorial.steps[0]?.instruction).toContain("Q、W、E、R、T");
    expect(tutorial.steps[2]?.expectedResult).toContain(
      "原始音频和路径不会发送给 AI",
    );
    expect(tutorial.steps.at(-1)?.expectedResult).toContain("可编辑作品");
  });
});

describe("Piano Roll 教程", () => {
  it("说明创建片段、精确编辑、删除与撤销的闭环", () => {
    const tutorial = resolveTutorial({ route: "piano-roll" });

    expect(tutorial.contentVersion).toBe(20);
    expect(tutorial.steps.map((step) => step.anchor)).toEqual([
      "piano-roll-target",
      "keyboard-recording",
      "piano-roll-create",
      "piano-roll-add-note",
      "piano-roll-grid",
      "piano-roll-note-actions",
    ]);
    expect(tutorial.prerequisites).toContain("停止播放");
    expect(tutorial.steps[1]?.expectedResult).toContain("可撤销批次");
    expect(tutorial.steps[4]?.instruction).toContain("MIDI 音高");
    expect(tutorial.steps.at(-1)?.expectedResult).toContain("Demo 播放");
  });
});

describe("编排教程", () => {
  it("说明从真实轨道 × 段落网格进入目标片段", () => {
    const tutorial = resolveTutorial({ route: "arrangement" });

    expect(tutorial.contentVersion).toBe(20);
    expect(tutorial.steps.map((step) => step.anchor)).toEqual([
      "arrangement-grid",
      "arrangement-clip",
    ]);
    expect(tutorial.steps[0]?.expectedResult).toContain("Piano Roll");
    expect(tutorial.recovery).toContain("空白格");
  });
});

describe("AI Chat 教程", () => {
  it("说明钥匙串配置、最小发送范围与候选接受/拒绝", () => {
    const tutorial = resolveTutorial({ route: "chat" });

    expect(tutorial.contentVersion).toBe(20);
    expect(tutorial.steps.map((step) => step.anchor)).toEqual([
      "ai-status",
      "ai-local-key",
      "ai-scope",
      "ai-proposal",
    ]);
    expect(tutorial.steps[1]?.instruction).toContain("macOS 钥匙串");
    expect(tutorial.steps[1]?.expectedResult).toContain("Node 网关");
    expect(tutorial.steps[2]?.instruction).toContain("不会发送整个工程");
    expect(tutorial.steps[3]?.expectedResult).toContain("一次撤销");
    expect(tutorial.recovery).toContain("候选试听尚未实现");
  });
});
