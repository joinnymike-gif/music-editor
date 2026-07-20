# 输出与工程生命周期契约

本文件定义 MVP 的可交付闭环：用户可从空白/模板或已获授权的 AI Proposal 开始，试听并编辑音乐，保存/恢复工程，最终导出 WAV 与 MIDI。它不包含人声、真实录音、云端工程存储或专业母带。

## 发布门槛与两条起点

所有用户都必须有无需联网的手工路径；AI 路径只有在 [AI 接入契约](ai-contract.md) 的发布门槛通过后才显示。

| 起点 | 创建结果 | 可用条件 |
|---|---|---|
| 空白工程 | 一个 8 小节、4/4 的 section，一个 lead 轨，无 notes | 始终可用 |
| 内置模板 | `lofi`、`electronic`、`popInstrumental` 的段落、轨道、音色与基础节奏 | 始终可用，资源已打包 |
| AI 生成 | 与用户选定 scope 对应的本地 `Proposal` | OAuth/授权、网关、预算与限额均已验证 |

空白工程不是“没有有效文档”：它必须满足 Schema 的非空 section/track 约束。所有起点使用同一 `createProject(template)` 工厂，生成 versioned `ProjectDocument`，不为 AI 建立另一份中间工程。

## 工程保存、dirty 与恢复

- 每个成功 OperationBatch 后工程变为 `dirty`。用户显式“保存/另存”为可移动的 `.json` 工程；文件名、路径和上次保存时刻可见。
- 本地恢复副本在成功 batch 后以最多 2 秒 debounce 写入应用数据目录；它不替代用户保存的 `.json`，不包含 API 凭据、聊天内容、未接受 Proposal 或教程进度。
- 启动时检测到恢复副本且它比上次保存新时，用户可选择恢复、丢弃或另存；退出含未保存变更时提供保存、放弃、取消三项。
- 打开工程先校验 Schema/版本并迁移；失败时以只读诊断方式打开，允许导出原始备份，绝不覆盖原文件。

## 时间线、播放与录制

`playheadBeat`、loop 范围、选中范围、录制 arm、录制模式和 count-in 是本地会话状态，不写入工程 JSON；其音符结果必须通过 OperationBatch 写入工程。

- 播放范围为 `wholeProject | selectedSection | selectedRange`；循环范围在 UI 明确显示，导出默认是 `wholeProject`，可显式选择 section/range 作为“片段导出”。
- 键盘录制从可见 playhead 开始；提供可关闭的一小节 count-in 与 4/4 metronome。暂停/继续保持 playhead，停止结束当前录制 batch。
- `shrinkSection` 只能以 `overflow: "trim"` 执行：预览并截短越界音符、删除完全越界音符；section 的增删/缩短/重排会按原 section 相对 beat 重排 automation。
- Piano Roll 的选择、拖动、改时值/力度和删除都以稳定 note ID 定位。任何 AI 或量化操作改变 notes 的顺序都不能改变其 ID。

## AI Proposal 提交

AI 只能提出草稿，不能直接更改工程：

```ts
type Proposal = {
  id: UUID;
  scope: Scope;
  strategy: "replace" | "overdub";
  summary: string;
  warnings: string[];
  batch: OperationBatch;
  preview: RenderPlan;
};
```

候选 batch 必须在当前有效工程的深拷贝上按顺序模拟；仅当模拟结果通过 Schema、音源预检和 scope 校验时，才从该候选工程生成 `preview`。用户可试听 preview、阅读受影响轨道/section 与删除警告，然后选择接受、拒绝或在相同 scope 下重试。接受按同一完整 batch 原子提交并可 Undo；拒绝、关闭、超时或重试都不得变更工程。部分接受不属于 MVP，避免产生难以解释的混合状态。

## 渲染与导出

### 共用 RenderPlan 与导出预检

有效工程先被编译为确定性的 `RenderPlan`；实时试听和离线渲染必须消费同一份 plan。它涵盖播放顺序、section 边界、tempo、notes、音源、mute/solo、音量和受支持 automation，防止“听到的”和“导出的”不一致。

```ts
type RenderPlan = {
  version: "1.0";
  sourceDocumentHash: string; // canonical JSON + 指定 instrumentRegistryVersion 的 SHA-256
  planHash: string;
  scope: { kind: "wholeProject" | "section" | "range"; from: Beat; to: Beat };
  contextFrom: Beat;          // 片段 WAV 预渲染起点，<= scope.from
  registry: Array<{
    trackId: UUID; instrumentId: string; registryVersion: string;
    assetSha256: string; midi: MidiMapping; automation: AutomationCapabilities;
  }>;
  events: ScheduledNote[];
  automation: ScheduledAutomation[];
};
```

`sourceDocumentHash` 在 Proposal 模拟、实时试听和导出前均重新计算；解析出的注册表条目、范围、events 与 automation 按 canonical 顺序参与 `planHash`。实时/离线引擎若收到未知版本、哈希不匹配或不完整 plan 必须拒绝执行。Proposal 接受后从已提交文档重新编译，所得 `sourceDocumentHash` 和 `planHash` 必须与已试听候选一致，否则 UI 要求重新试听。

导出前执行 preflight：Schema 有效、所有音源资产可加载、目标范围非空、automation 支持情况、预计时长、输出文件可写与峰值削波风险。前五项的阻塞错误禁止导出；不支持的 automation 和削波为明确警告，用户可返回修复或确认继续。MVP 不自动母带/归一化音频。

### WAV

- 默认导出全曲；可明确选择 section/range 作为片段 WAV。
- 格式固定为 stereo PCM WAV、44.1 kHz、16-bit，末尾保留 2 秒 release tail。文件名默认 `<project-name>-<scope>.wav`，由用户选择输出位置。
- UI 显示编译、渲染、写盘三个阶段的进度。用户取消时关闭并删除临时文件，不覆盖已存在的完成文件；失败保留工程并显示可重试原因。

### 片段范围边界

- 所有 section/range 导出先归一为工程全局 beat 区间 `[from, to)`。WAV 文件在 `from` 开始，在 `to` 后保留 2 秒 release tail；MIDI 不附加 tail。
- WAV 为保持片段起点的真实声音，从影响 `from` 的最早 note-on 和 automation 上下文开始离线预渲染，再丢弃 `from` 之前的帧。跨越 `from` 的长音在文件起点继续发声，跨越 `to` 的长音在 tail 中自然释放。
- automation 在 `from` 用前后点线性插值得到初始值，并将该值在输出时间 0 写入；区间内的点按相对时间重排。无法插值的 lane 按其参数类型报告阻塞错误，不可静默忽略。

### MIDI

- 导出 SMF Type 1，PPQN 480，默认全曲，也可显式导出 section/range。
- 写入 tempo 与 4/4 time-signature meta event；每个 Project track 对应一个 MIDI track；drums 使用 channel 10，其余轨道通过版本化 instrument→Program Change 映射表指定 program。
- `volume` 导出为 CC7，`filterCutoff` 仅在有明确 CC74 映射时导出；其他不可映射 automation 作为预检警告并省略，不能静默伪造。
- section/range MIDI 导出把 `from` 重定位为 beat 0：与范围相交的 note 被裁剪到 `[from, to)`，跨越起点的 note 从 0 开始、保留剩余时值；automation 在 tick 0 写入插值后的初始 CC，再写入范围内重定位后的点。

## 端到端验收

1. 手工路径：新建空白工程 → 键盘录制 → Piano Roll 修改指定 note → 保存 → 重启恢复 → 导出 WAV 与 MIDI。
2. 模板路径：创建内置模板 → 调整 section/track → 播放全曲与选段 → 导出片段 WAV 和全曲 MIDI。
3. AI 路径（仅在门槛通过时）：创建工程 → 生成 Proposal → 试听/接受或重试 → 局部 AI 重写 + 手工修改 → 导出 WAV 与 MIDI。
4. 在独立播放器验证 WAV 能播放；在独立 MIDI 工具验证 MIDI 可打开，且其时长、tempo、轨道数和音符数量与工程/RendPlan 相符。
5. 验证取消导出、缺失音源、损坏工程、网络失败、未保存退出与恢复均不会损坏已保存工程；每一步可从当前页面教程完成。
