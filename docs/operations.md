# 操作契约

所有写入工程的路径——OpenAI/Gemini、编排视图、Piano Roll、快捷键、导入——都必须经过本契约；任何 UI 或模型均不可直接改写文档。

## 统一结构

```ts
type Scope =
  | { kind: "whole" }
  | { kind: "section"; sectionId: UUID }
  | { kind: "track"; trackId: UUID }
  | { kind: "clip"; trackId: UUID; sectionId: UUID };

type Operation = {
  id: UUID;
  type: OperationType;
  scope: Scope;
  args: Record<string, unknown>;
};

type OperationBatch = {
  id: UUID;
  source: "manual" | "keyboard" | "agent" | "macro" | "import";
  label: string;
  operations: Operation[];
};
```

原语是确定性的纯函数：`apply(document, operation) -> Result<document, OperationError>`。`OperationError` 至少包含 `code`、`message`、`path` 与失败操作 ID。所有参数与引用先校验，再执行。

## 原语集合

结构：`addSection`、`removeSection`、`extendSection`、`shrinkSection`、`reorderSections`。轨道：`addTrack`、`removeTrack`、`setInstrument`。音符：`upsertClip`、`removeClip`、`replaceClipNotes`、`insertNotes`、`updateNotes`、`removeNotes`、`removeNotesInRange`、`transpose`、`quantize`、`setVelocity`、`halfTime`、`doubleTime`、`humanize`。工程：`setTempo`、`setKey`、`changeKey`。混音：`setVolume`、`mute`、`solo`。自动化：`upsertAutomationPoints`、`removeAutomationPoints`。

每个原语都要在实现前记录 args、目标选择规则、越界策略、受影响对象和至少三个测试用例。`removeSection` 与 `removeTrack` 必须级联删除失去引用的 clip/automation；该级联是同一原子操作的一部分。

`updateNotes` 和 `removeNotes` 只接受 note ID；不存在、重复或超出当前 scope 的 ID 使整个 batch 失败。`shrinkSection` 的参数必须包含新 bars 和 `overflow: "trim"`；提交前返回被截短/删除的 note ID 与被重排的 automation 数量，供 UI 与 AI Proposal 预览。

## P0 原语参数与边界

以下定义优先于任何 UI、Agent tool 或导入实现；未列出的参数一律拒绝，不进行静默修正。

| 原语                      | 必填 args                                                                      | 成功结果 / 失败规则                                                                                                                                                                                                                                         |
| ------------------------- | ------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `setKey`                  | `key`, `mode`                                                                  | **只**更新 `meta.key/mode` 和随调性变化的键盘映射，不移动现有 notes。用于重新解释调性或切换 mode。                                                                                                                                                          |
| `setTempo`                | `tempo`                                                                        | 仅 `whole` scope；`tempo` 必须是 40–240 的有限 BPM 数字。                                                                                                                                                                                                   |
| `setVolume`               | `volume`                                                                       | 仅 `track` scope；`volume` 必须在 0–1。                                                                                                                                                                                                                     |
| `mute` / `solo`           | `value`                                                                        | 仅 `track` scope；`value` 必须是布尔值。solo 的播放语义由工程 Schema/RenderPlan 统一解释。                                                                                                                                                                  |
| `transpose`               | `scope`, `semitones`（-24…24，非 0）                                           | 移动 scope 内非 drums notes 的 pitch；任一目标 pitch 不在 0–127 时整批失败，绝不 clamp。                                                                                                                                                                    |
| `changeKey`               | `key`, `mode`, `semitones`                                                     | `mode` 必须与原 mode 相同，`key` 必须等于旧 key 加 `semitones` 后的 pitch class；执行 `transpose(scope=whole)` 后执行 `setKey`。MVP 的“转调”语义宏只使用此操作。跨 major/minor 的改调只能使用 `setKey`，并在 UI 说明 notes 未转置。                         |
| `addSection`              | `sectionId`, `name`, `bars`, `afterSectionId`                                  | 仅 `whole` scope；sectionId 全局唯一。afterSectionId 为现有 section UUID 时插在其后；为 `null` 时追加。所有 automation 先保留 section 相对 beat 再重建全局 at。                                                                                             |
| `removeSection`           | 无                                                                             | 仅 `section` scope；不能删除最后一个 section。级联删除其 clips/notes，并删除属于该 section 的 automation 点，再以剩余 section 顺序重建全局 at。                                                                                                             |
| `extendSection`           | `bars`                                                                         | 仅 `section` scope；bars 必须大于当前值且不超过 64；automation 保持相对 beat。                                                                                                                                                                              |
| `shrinkSection`           | `bars`, `overflow: "trim"`                                                     | 仅 `section` scope；bars 必须缩短。起点超出新边界的 notes 删除，跨边界 notes 截短，超出新边界的 automation 点删除；返回受影响 note ID 与 automation 数。                                                                                                    |
| `reorderSections`         | `sectionIds[]`                                                                 | 仅 `whole` scope；必须恰好是现有 section ID 的无重复排列。clips 继续引用原 section，automation 按原 section 相对 beat 重新计算全局 at。                                                                                                                     |
| `addTrack`                | `trackId`, `name`, `role`, `instrument`, `volume`                              | 仅 `whole` scope；创建默认 `mute:false`、`solo:false` 的轨道。trackId 全局唯一，instrument 必须在工程引用的注册表版本存在且与 role/MIDI channel 兼容。                                                                                                      |
| `removeTrack`             | 无                                                                             | 仅 `track` scope；不能删除最后一条轨道，并在同一原子操作中级联删除该轨所有 clip、notes 与 automation lane。                                                                                                                                                 |
| `setInstrument`           | `instrument`                                                                   | 仅 `track` scope；新 instrument 必须在工程注册表版本存在并与该轨 role/MIDI channel 兼容。                                                                                                                                                                   |
| `upsertClip`              | `clipId`, `notes[]`                                                            | 仅 `clip` scope。scope 已有 clip 时 `clipId` 必须相同，且以全新 note ID 替换其 notes；scope 为空时以全新全局 `clipId` 创建。notes 按 Schema 排序。                                                                                                          |
| `removeClip`              | 无                                                                             | 仅 `clip` scope；删除该 clip，引用的 track/section 保留。                                                                                                                                                                                                   |
| `replaceClipNotes`        | `trackId`, `sectionId`, `notes[]`                                              | 替换该 clip 的全部 notes；每个新 note 都须包含调用方生成的全局唯一 `id`。旧 note ID 失效；任一 ID 重复、引用不存在或最终 clip 非法时整批失败。                                                                                                              |
| `insertNotes`             | `trackId`, `sectionId`, `notes[]`                                              | 插入带全局唯一 ID 的 notes；保留既有 notes 和 ID，随后按 Schema 排序。                                                                                                                                                                                      |
| `updateNotes`             | `changes[]`（每项含 `noteId` 与至少一个 `pitch/start/dur/vel`）                | 每个 ID 在 batch 内只能出现一次；先合并全部 changes 再校验最终 clip。不存在、重复、跨 scope 或越界均使整批失败。                                                                                                                                            |
| `removeNotes`             | `noteIds[]`                                                                    | 删除指定 notes；空数组、重复或不存在 ID 均失败。                                                                                                                                                                                                            |
| `removeNotesInRange`      | `trackId`, `sectionId`, `start`, `end`, `mode: "trimAndSplit"`, `splitNoteIds` | 处理 section 内与半开区间 `[start,end)` 相交的 notes；`start < end`。完全落入范围的 note 删除；仅一侧相交的 note 原地截短并保留原 ID；跨越整个范围的 note 保留左段原 ID，并以 `splitNoteIds[noteId]` 新建右段。缺少、重复或非全局唯一 split ID 时整批失败。 |
| `halfTime` / `doubleTime` | `scope`                                                                        | `halfTime` 将 start/dur 乘 2，`doubleTime` 将二者除 2；若任何结果超 section 或短于 0.25 beat，整批失败，不截断。                                                                                                                                            |
| `quantize`                | `grid`                                                                         | `grid` 仅可为 0.25、0.5 或 1 beat；按最近网格吸附 note 的 start，保持 dur。若任一吸附后超 section 则整批失败，成功后 notes 按 `start/pitch/dur` 排序。                                                                                                      |
| `setVelocity`             | `velocity`                                                                     | `velocity` 必须是 MIDI 1–127 的整数；把 scope 内全部音符设为该力度。                                                                                                                                                                                        |
| `humanize`                | `seed`, `timing`, `velocity`                                                   | `seed` 为 0–4294967295 整数；`timing` 为 0–0.25 beat，`velocity` 为 0–32。用固定伪随机序列偏移 start 和 vel，保持 dur；越出 section 或 MIDI 1–127 时整批失败，不 clamp。                                                                                    |
| `upsertAutomationPoints`  | `param`, `points[]`                                                            | 仅 `track` scope；param 为 `volume` 或 `filterCutoff`。point 的全局 `at` 与 `val` 必须合法；同 lane 同 at 按输入顺序后者覆盖前者，并返回合并计数。                                                                                                          |
| `removeAutomationPoints`  | `param`, `ats[]`                                                               | 仅 `track` scope；每个 at 必须存在于目标 lane，空数组、重复或不存在的 at 整批失败。                                                                                                                                                                         |

结构操作重排 automation 时，先按旧 section 边界把点转换为 `(sectionId, relativeBeat)`；删除 section 时删除该 section 的点，再按新顺序换回全局 `at`。同 lane 在同一 `at` 相撞时，保留原操作顺序最后写入的点，并在结果中返回 `mergedAutomationPoints` 数量。

键盘录制使用 `source: "keyboard"`。overdub 只执行 `insertNotes`；替换范围先执行 `removeNotesInRange` 再执行 `insertNotes`，二者必须在同一批中完成。试听事件不创建 Operation，也不影响撤销栈。

## 原子提交与撤销

1. UI 或 Agent 先生成一个候选 `OperationBatch`，并显示 label、目标与操作数。
2. Store 在提交前保存整个有效文档快照；按顺序模拟所有操作。
3. 任一操作失败或最终 Schema 校验失败时，返回错误且**不修改**当前文档、不产生 history 条目。
4. 全部成功才一次替换当前文档，并写入 `past`；新提交后清空 `future`。Undo/redo 均以整个 batch 为粒度。

MVP history 只保存在内存；保存工程时不把 API 凭据、完整聊天内容或密钥写入 JSON。是否持久化可审计操作历史属于后续明确需求。

## 模型与语义宏

模型只能输出符合 tool schema 的候选 `Operation`，或输出候选 notes。候选 notes 经过生成器约束、Schema 校验后，转换成 `replaceClipNotes`；不存在“模型直接写文档”的通道。候选组成的 `Proposal` 必须包含 scope、生成/替换策略（`replace | overdub`）、操作摘要、受影响对象、警告和可试听 RenderPlan；只有“接受”才提交该 batch。

`setEnergy`、延长/缩短段落、换鼓组和重写指定范围是命名语义宏。宏展开为可检查的原语 batch，展示预览后提交；第一版必须为每个宏固定明确的展开策略及回归 fixture。“稳定生效”定义为：固定评测输入得到合法 batch、作用域不越界、可撤销，且满足该宏列出的可度量变化。
