# 电脑键盘输入契约

电脑键盘是乐器输入，不是浏览器快捷键的替代。它让用户不借助 MIDI 硬件也能直接试听和录入完全自定义的音符；录入结果与 Piano Roll、AI 操作使用同一份工程文档。

## MVP 映射

默认使用当前工程的 `key` 和 `mode`，基准为 C4：

| 按键 | 音阶级数 | C major 示例 | C minor 示例 |
|---|---:|---|---|
| `Q W E R T Y U` | do re mi fa sol la ti | C D E F G A B | C D E♭ F G A♭ B♭ |
| `I` | 高八度 do | C5 | C5 |
| `Shift` + 上述按键 | 高一个八度 | 例如 Shift+Q = C5 | 例如 Shift+Q = C5 |
| `Z` / `X` | 默认八度 -1 / +1 | C3 / C5 起始 | C3 / C5 起始 |

- 映射随 `setKey` 或 `mode` 立即变化，按键代表音阶级数，而不是固定音高。
- MVP 只为 `bass | harmony | lead | pad | fx` 等 melodic 轨道开放此模式；drums 不进行音阶映射。鼓垫键盘另立需求。
- 默认八度是本地用户偏好，范围 C1–C7；不随工程保存或同步。自定义按键布局与微分音不属于 MVP。

## 试听

- 有焦点的非文本编辑区域中，`keydown` 触发 note-on，`keyup` 触发 note-off；重复 keydown 必须去重。
- 当文本输入框、可编辑控件、快捷键设置界面或模态框获得焦点时，键盘演奏停用，不能抢占用户打字。
- 窗口失焦、页面隐藏、切换轨道/工程、停止 transport 或出现异常时，必须发出所有已按下音符的 note-off，避免卡音。
- 页面白键是一次性短音试听，与实体键的 note-on/note-off 状态隔离；它使用注册表的波形与默认增益，不改工程 JSON、不产生历史记录。
- 短音试听使用有界原生 Web Audio 声音集合，最多 24 个并发节点；达到上限时回收最早节点并保证最新一次点击仍会触发。不得用会在待释放声音满载时丢弃新音符的共享 `PolySynth`。

## 录制到工程

1. 用户在 Arrangement 中选择一个 melodic track 和一个 section，开启“录制”并选择 `overdub` 或 `替换选区`；没有有效目标时不允许录制。录制从可见 playhead 开始，MVP 提供可关闭的一小节 count-in 与 4/4 metronome。
2. 音符按实际 keydown/keyup 记录，使用 transport 的相对 section beat；MVP 默认量化到 1/16 note（0.25 beat），最短时值也是 0.25 beat。暂停/继续保持 playhead，不隐式重置录制范围。
3. 超出 section 边界的音符被截断到边界；零长度结果丢弃并显示原因。录制时力度固定为 100，后续可由 Piano Roll 编辑。
4. 停止录制时，按 [Schema 规格](schema.md) 校验、排序并提交单个 `OperationBatch`：overdub 为 `insertNotes`；替换选区为 `removeNotesInRange(mode=trimAndSplit)` + `insertNotes`，因此选区外的长音会被保留。任何校验失败都不写入工程。
5. 用户可用一次 Undo 撤销整个录制；AI 后续收到的是提交后的文档，而不是键盘事件日志。

## 验收

1. C major 的 lead 轨上，按 `Q W E R T` 依次听到 C D E F G；切换到 C minor 后依次听到 C D E♭ F G。
2. 文本输入框中输入 `qwert` 不产生声音；窗口失焦时没有卡音。
3. 在 120 BPM、4/4 的 8 小节 section 录入 `Q W E R T`，所得 notes 均在 section 内、以 0.25 beat 网格量化且可播放。
4. overdub 保留原 notes；替换选区仅替换目标时间范围；两种录制均能通过一次 Undo 恢复到录制前。
