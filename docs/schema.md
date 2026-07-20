# Schema 规格（v1.0）

本文件是工程 JSON 的唯一数据契约。TypeScript 类型、运行时校验和示例 fixture 必须由此同步实现；实现不以 README 示例推断数据语义。

## 版本与工程级字段

```ts
type ProjectDocument = {
  schemaVersion: "1.0";
  id: UUID;
  name: string;
  createdAt: ISO8601;
  updatedAt: ISO8601;
  meta: Meta;
  sections: Section[];
  tracks: Track[];
  clips: Clip[];
  automation: AutomationLane[];
};
```

- 新建工程始终写入 `schemaVersion: "1.0"`；打开文件先检查版本，再运行显式迁移。不能迁移的文件只读打开，并提示用户导出备份。
- `id` 为 UUID；所有 section、track、clip 和 note 的 ID 在工程内唯一且不可因重命名、排序或量化变化。
- `name` 为 1–100 个字符；时间字段采用 ISO-8601 UTC 字符串。保存成功才更新 `updatedAt`。
- `meta.instrumentRegistryVersion` 必填，引用随应用发布的 [乐器注册表](instrument-registry.md) 版本；打开旧工程时必须解析该版本或提供明确的迁移/缺失资产诊断，不能静默换音色。

## M0 时间与结构约束

- M0 只支持全局 `tempo` 40–240 BPM、`key` 为 12 个半音名之一、`mode` 为 `major | minor`、`timeSig: [4, 4]`。变拍号、变速与调性事件不进入 v1.0。
- `sections` 非空、按播放顺序排列；每项的 `bars` 为 1–64 的整数。section 名可重复，ID 不可重复。
- `tracks` 非空；`role` 限 `drums | bass | harmony | lead | pad | fx`，`instrument` 是受支持音源的稳定 ID，`vol` 在 0–1，`mute` 为布尔值，`solo` 默认 `false`。
- 当一个或多个轨道 solo 时，播放引擎只播放未 mute 的 solo 轨；否则播放所有未 mute 轨。

## Clip 与音符

- clip 的键是 `(trackId, sectionId)`；每个键至多有一个 clip，且 clip 本身有稳定 UUID。引用不存在的轨道或段落一律非法。
- 每个 note 具有稳定 UUID；Piano Roll、键盘录制和 AI 通过 note ID 更新或删除单个音符，不能以数组下标作为持久引用。
- `notes` 可为空；`start` 和 `dur` 均以 **section 内相对 beat** 表示。4/4 下，一个 `bars: 8` 的 section 长度为 32 beat。
- `pitch` 是 0–127 整数，`vel` 是 1–127 整数；`start >= 0`、`dur > 0`、`start + dur <= sectionBeats`。同一 pitch 重叠在 v1.0 合法，由播放引擎按音源能力处理。
- notes 必须按 `start`、`pitch`、`dur` 稳定排序；校验器不静默修正输入，调用方须经原语显式规范化。
- 电脑键盘的按键布局、默认八度、量化和录制模式是本地用户偏好，不写入 `ProjectDocument`；录制完成后只有符合本节约束的 notes 写入工程。

## Automation

- lane 唯一键为 `(trackId, param)`；`param` 在 v1.0 仅限 `volume | filterCutoff`。
- `points[].at` 是从工程起点算起的**全局 beat**，非 bar；其范围为 `0..projectBeats`，按 `at` 严格递增。
- `volume.val` 为 0–1；`filterCutoff.val` 为归一化 0–1。未被当前音源支持的 lane 可以保存，但播放端须明确忽略并显示能力提示。
- section 增删、缩短或重排时，automation 点随其原 section 的相对 beat 一起重排；操作结果仍须满足全局 beat 严格递增约束。

## 校验结果

运行时校验返回带路径的错误列表，不抛给 UI。`valid` 文档才可保存、播放或作为 AI 的输入；模型候选若无效，整批操作不提交。

## 示例与迁移

`docs/02-technical.md` 的 JSON 只是阅读示例。实现时须提供一个完整 `valid-project-v1.json`、每条约束至少一个无效 fixture，以及从未来旧版本到当前版本的纯函数迁移表。
