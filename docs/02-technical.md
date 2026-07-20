# 技术实现总图与开发追踪 — AI 音乐 IDE（MVP）

本文是技术实施的唯一追踪入口：它说明架构、依赖关系、发布门槛，并将所有需要解决的技术点拆成可勾选项。数据、操作、AI、导出等字段级规则以链接到的专项契约为准；不得在实现中自行发明第二套规则。

工程已进入 M0 开发中。本文件保留未完成技术项，并以复选框和可重复证据追踪当前实现状态。

## 使用规则：每解决一个技术点必须标注

- 每个条目都拥有稳定编号 `T-xxx`，后续开发只能把对应的 `- [ ]` 改为 `- [x]`，不可删除或合并条目来制造完成状态。
- 标记完成的前提是同时具备：实现已合入、自动化测试通过、对应验收场景通过、当前页面教程或错误说明已补齐（适用时）。
- 完成时在该条目末尾追加证据，格式为：`（证据：<测试命令/测试文件>；<验收记录或提交>）`。没有证据不得勾选。
- 一个条目后来失效、回归或依赖被替换时，必须恢复为 `- [ ]` 并说明原因；不能保留已完成状态。
- [全周期工作项](03-worklog.md) 的对应里程碑和本文件必须同步更新。技术项勾选并不自动代表里程碑完成，仍需达到该里程碑验收条件。

## 0. 产品边界、发布门槛与权威契约

### 产品边界

- 符号器乐工程是唯一真相；音频是由工程文档派生的渲染结果。
- MVP 仅支持桌面端、单用户、4/4、全局 tempo/key/mode、器乐符号编辑；不包含人声录制、MIDI 硬件、移动端、协作和专业母带。内置实录乐器采样只用于回放与导出。
- 用户必须能走完离线手工闭环：空白/模板工程 → 手工编辑 → 保存/恢复 → WAV/MIDI 导出。
- AI 是可选能力；本机 BYOK 由 macOS 原生侧直接调用服务商，产品代付模式则由同一原生侧调用产品服务。未通过相应发布门槛时，产品不得承诺或展示 AI 生成，而需保留完整手工路径。

完整产品范围和成功标准见 [产品文档](01-product.md)。

### 交付门槛

| 门槛          | 条件                                                                         | 失败时的产品行为                     |
| ------------- | ---------------------------------------------------------------------------- | ------------------------------------ |
| G0 教程优先   | M-1 教程骨架通过                                                             | 不进入任何音乐功能开发               |
| G1 手工闭环   | 新建/模板、编辑、保存恢复、WAV/MIDI 和 M6 手工路径通过                       | 不发布 MVP                           |
| G2 AI 闭环    | 原生 Keychain/服务商边界或产品账户、产品 API 计费/预算、限额和失败恢复均验证 | 隐藏 AI 入口与 AI 教程，保留手工路径 |
| G3 成品一致性 | 实时试听、Proposal 试听、WAV/MIDI 都来自有效 RenderPlan                      | 禁止导出或要求修复                   |

### 专项契约（字段和行为的权威来源）

| 领域                                       | 权威文档                                      |
| ------------------------------------------ | --------------------------------------------- |
| 工程 JSON、版本、约束                      | [Schema 规格](schema.md)                      |
| 原语、原子批、Undo、转调与范围编辑         | [操作契约](operations.md)                     |
| OpenAI/Gemini 选择、原生运行时、数据和失败 | [AI 接入契约](ai-contract.md)                 |
| QWERT 映射、试听和录制                     | [电脑键盘输入](keyboard-input.md)             |
| 工程起点、恢复、Proposal、RenderPlan、导出 | [输出与工程生命周期](output-and-lifecycle.md) |
| 音源资产、MIDI Program、许可与版本         | [乐器注册表](instrument-registry.md)          |
| 新手引导和当前页面教程                     | [教程系统](tutorial-system.md)                |
| 里程碑与最终端到端验收                     | [全周期工作项](03-worklog.md)                 |

## 1. 总体架构

```text
React / Tauri Desktop App
│
├─ App Shell + Tutorial Center ─────────────── 教程、路由、无障碍、页面锚点
├─ UI Views ────────────────────────────────── Chat / Arrangement / Piano Roll / Export
├─ Input ───────────────────────────────────── QWERT 试听与录制缓冲
├─ Store ───────────────────────────────────── 当前文档、Undo/Redo、会话状态、Proposal
│   └─ Operation Layer (pure doc → doc) ────── 校验、原子批、宏展开
├─ Document Layer ──────────────────────────── Schema、迁移、fixture、模板
├─ Instrument Registry ─────────────────────── 资产/许可/automation/MIDI 映射
├─ RenderPlan Compiler ─────────────────────── 实时试听、Proposal、离线 WAV、MIDI 的共同输入
├─ Audio Engine ────────────────────────────── Tone.js / Web Audio 调度与音源
├─ Persistence / Lifecycle ─────────────────── .json 保存、autosave、恢复、dirty
├─ Export ──────────────────────────────────── WAV 离线渲染、SMF Type 1、预检
└─ AI Provider Adapter (optional) ──────────── 本地 Proposal，不直接改文档
    └─ Tauri Native AI Runtime ──────────────── Keychain、HTTPS、OpenAI / Gemini API
```

### 核心数据流

1. 任何手工、键盘、导入或 AI 操作都生成 `OperationBatch`，而非直接修改 UI 状态。
2. Store 在有效文档快照上模拟批次；任一步或最终 Schema 校验失败，则当前文档不变。
3. 成功批次一次写入文档、更新 Undo/Redo、标记 dirty、触发恢复副本和受影响范围重排。
4. `RenderPlan` 从有效工程 + 指定乐器注册表编译；实时试听、Proposal preview、WAV 和 MIDI 导出共享其解析结果。
5. AI 仅产生候选 batch；候选先在深拷贝工程上模拟、校验和试听，用户接受后才按同一 batch 提交。

### 建议代码目录

```text
src/
  app/           App Shell、路由、全局错误边界
  doc/           类型、Schema 校验、迁移、fixture、模板工厂
  instruments/   注册表、资产解析、许可、MIDI 映射
  ops/           原语、批处理、Undo/Redo、语义宏
  store/         Zustand 文档/会话/Proposal 状态
  audio/         Tone.js、Transport、实时 RenderPlan 调度
  input/         QWERT 映射、试听、录制缓冲、节拍器
  lifecycle/     dirty、autosave、恢复、新建/打开/另存
  export/        preflight、离线 WAV、MIDI、临时文件清理
  agent/         WebView 到原生 Provider 的类型边界、Proposal 模拟
  journey/       新手创作任务、10 秒工坊、本机音频参考摘要、路线与扩展编排
  tutorial/      内容目录、进度、上下文解析、高亮层
  ui/            chat、arrangement、pianoroll、automation、export
  test/          unit、integration、e2e、fixture、audio 测试工具
src-tauri/       本地文件、系统对话框、Keychain 与原生 AI 请求
gateway/         历史 Node 网关实验/协议回归测试；不参与桌面应用运行时
```

## 2. 技术栈与工程基础

| 层     | 选型                                                                   | 原则                                                                                                |
| ------ | ---------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------- |
| 桌面壳 | Tauri + React + Vite                                                   | 本地文件与轻量桌面分发；M0 先验收 macOS                                                             |
| 语言   | TypeScript strict                                                      | 所有文档/操作/工具参数显式类型                                                                      |
| 状态   | Zustand                                                                | 一份工程文档、独立会话状态与可序列化历史                                                            |
| 校验   | TypeScript 类型 + 运行时 Schema 校验                                   | 运行时校验是保存、播放、AI、导出的前提                                                              |
| 音频   | Web Audio + Tone.js transport + 打包实录采样                           | 实时与离线均从同一 SHA-256 校验的实录层取音；仅明确标注的合成主音例外，其他缺层或校验失败即阻止播放 |
| 持久化 | Tauri 文件能力 + 本地恢复副本                                          | `.json` 显式保存；恢复副本不含秘密或聊天内容                                                        |
| AI     | 原生 Rust `reqwest` + Keychain；OpenAI Responses / Gemini Interactions | WebView 不持有 Key；输出只能是 Proposal                                                             |
| 测试   | 单元 + 集成 + 桌面端到端测试                                           | 每个技术点有可重复证据                                                                              |

### 技术基础追踪

- [x] T-001 初始化 Tauri、React、Vite 与 TypeScript strict 工程，并锁定 Node、Rust、Tauri、React、Tone.js、音源库版本。（证据：`package.json`/`pnpm-lock.yaml`/`src-tauri/Cargo.lock`；`pnpm exec tauri build --debug --bundles app`）
- [x] T-002 选择包管理器、锁文件策略、开发/构建/测试/lint/format/typecheck 命令，并写入 README。（证据：`pnpm-lock.yaml`、`package.json` 与 README；`pnpm check`）
- [x] T-003 建立 CI 或本地等价质量门：format、lint、typecheck、unit、build 任一失败即阻止合并。（证据：`pnpm check` 串行执行 `format:check`、`lint`、`typecheck`、`test`、`build`）
- [ ] T-004 建立开发/生产错误边界、结构化诊断与无敏感信息日志策略。（证据待补）
- [x] T-004a 为打包 macOS WebView 配置严格 CSP：仅允许本地资源、Tauri IPC 与受控 asset 协议；开发期单独允许 Vite HMR，WebView 不直接连接 AI 服务商或本地网关。（证据：`src-tauri/tauri.conf.json`；`pnpm exec tauri build --debug --bundles app`。）
- [ ] T-005 建立测试 fixture、临时文件和音频资产的隔离策略，测试不得污染用户工程或恢复副本。（证据待补）

## 3. M-1：教程系统（优先于业务功能）

教程不是后置文档；没有教程、错误说明和无障碍文本的页面不能标记完成。具体内容规则见 [教程系统](tutorial-system.md)。

- [x] T-010 实现全局 App Shell 与所有页面固定可见、可聚焦的“当前页面教程”文字按钮。（证据：`pnpm test`；`src/app/App.tsx` 的全局顶栏及全部 5 个已实现 mock 路由）
- [x] T-011 实现非阻塞教程侧栏：上下文匹配、步骤、预期结果、常见错误、跳过/重试/重置。（证据：`pnpm test`；`src/tutorial/TutorialDrawer.tsx`、`src/tutorial/content.ts`）
- [x] T-012 实现稳定 `data-tutorial` anchor、高亮层、锚点缺失/不可见时的文字降级与错误保护。（证据：`pnpm test`；`src/tutorial/TutorialDrawer.test.tsx` 覆盖高亮与缺失锚点降级）
- [x] T-013 实现本地 TutorialProgress、内容版本迁移、首次引导恢复和“重新开始教程”。（证据：`pnpm test`；`src/tutorial/progress.test.ts` 覆盖持久化、版本迁移与损坏数据恢复）
- [x] T-014 建立教程无障碍测试：键盘焦点、Esc、屏幕阅读器文本、非颜色依赖。（证据：`pnpm test`；`src/tutorial/TutorialDrawer.test.tsx` 覆盖 Esc，原生 button 焦点、`aria-label`/`aria-live`/文字状态由组件实现）
- [x] T-015 为欢迎、demo、播放控制建立可在 mock 界面上运行的 M-1 教程并完成验收。（证据：`pnpm test && pnpm typecheck && pnpm build && pnpm exec tauri build --debug --bundles app`；macOS `.app` 调试包成功生成）

### M-1a：零乐理创作旅程与参考音频

本功能的用户、数据和失败边界以[新手创作旅程方案](creative-journey.md)为准。它不改变工程 JSON 的唯一真相地位：任务状态是本机辅助状态，所有音乐写入仍必须经过 Operation Layer。

- [x] T-016 实现任务式新手入口、QWERT 上行热身、10 秒工坊、结构路线图、手工收尾和导出入口；每一步提供当前页面教程和“返回上一步”入口。实体 QWERT、页面按键、重复按键抑制与文本输入保护均走同一热身状态机；后退只切换步骤，不清空选择或工程。（证据：`src/journey/CreativeJourney.tsx`、`src/tutorial/content.ts`、`CreativeJourney.test.tsx`、`content.test.ts`；`pnpm check`、`pnpm exec tauri build --debug --bundles app`。）
- [x] T-017 实现 10 秒开场的有效工程工厂：5 小节 seed、3 轨、30 小节完整结构，并通过受控 Store 替换开启干净历史。（证据：`src/journey/workshop.ts`、`workshop.test.ts`、`projectStore.test.ts`；`pnpm test`。）
- [x] T-018 实现不依赖网络的逐段扩展：仅为目标非 seed 段的空轨生成 `upsertClip` 原子 batch，成功后可由现有 Undo 回退。（证据：`src/journey/workshop.ts`、`workshop.test.ts`；`pnpm test`。）
- [x] T-019 实现最多 3 段的本机参考音频导入、格式/大小/时长限制、用户同意、轻量特征摘要、用途/权重修正和移除入口；默认不上传原始字节或路径。（证据：`src/journey/audioSeed.ts`、`audioSeed.test.ts`、`CreativeJourney.tsx`；`pnpm test`。）
- [x] T-019a 将创作问答、已确认参考摘要和“保护 10 秒开场”约束带入应用内 AI Chat；仍沿用最小 scope、候选校验和显式接受。（证据：`src/journey/workshop.ts`、`src/app/App.tsx`、`workshop.test.ts`；`pnpm typecheck && pnpm test`。）
- [ ] T-019b 以 Rust/AVFoundation worker 替换 WebView `AudioContext` 解码，并增加解码进度、取消、更多格式诊断和稳定的桌面端端到端测试。（证据待补）
- [ ] T-019c 实现波形预览与 15–45 秒选区；当前整段分析不得被表述成用户已裁剪的参考。（证据待补）
- [ ] T-019d 实现 BPM/onset/key 等可解释推断及用户修正记录；不能把轻量 RMS/过零率摘要表述为精确乐理分析。（证据待补）
- [ ] T-019e 设计并迁移可移植的 Journey manifest（不含路径、原始字节或秘密），使保存后的工程可跨 Mac 继续任务。（证据待补）

## 4. 文档、Schema、模板与乐器注册表

工程文档是唯一真相。任何输入都必须在进入 Store 前通过运行时校验；详细字段约束以 [Schema 规格](schema.md) 为准。

### 工程文档与迁移

- [x] T-020 定义 `ProjectDocument`、Meta、Section、Track、Clip、Note、AutomationLane 的 TypeScript 类型，并与 Schema 一一对应。（证据：`pnpm typecheck`；`src/doc/types.ts`）
- [x] T-021 实现 v1 运行时校验：UUID、引用完整性、tempo/key/mode/4-4、bars、notes、automation、solo 语义和错误路径。（证据：`pnpm test`；`src/doc/schema.ts` 与 `src/doc/schema.test.ts`）
- [ ] T-022 实现版本检查与纯函数迁移；不能迁移的工程只读诊断打开且可导出原始备份。（证据待补）
- [x] T-023 提供完整有效工程 fixture，并为每条约束提供至少一个无效 fixture。（证据：`pnpm test`；`src/doc/fixtures/` 的有效/无效 JSON 与 `schema.test.ts` 约束集）
- [x] T-024 实现 `createProject(template)`：空白工程、lofi、electronic、popInstrumental 均生成有效、版本化文档。（证据：`src/doc/templates.ts`、`templates.test.ts`；欢迎页模板入口与当前页面教程；`pnpm test`）

### 乐器注册表与资产

- [x] T-025 实现乐器注册表 v1：`acoustic_kit`、`finger_bass`、`square_lead` 的 ID、角色、资产 hash、许可证、实时/离线能力、automation 与 MIDI 映射。（证据：`src/instruments/registry.ts`；`pnpm test`）
- [ ] T-026 实现 `meta.instrumentRegistryVersion` 解析、role/instrument 兼容校验与显式注册表迁移预览。（版本解析和角色兼容性已在 `src/instruments/registry.ts` 完成；仍缺显式注册表迁移预览，故未完成）
- [ ] T-027 实现资产加载完整性检查；版本、hash 或许可证不满足时只读诊断，禁止试听、Proposal 和导出。（证据待补）
- [ ] T-028 验证模板、实时试听、Proposal、离线渲染和 MIDI 均解析到相同资产 hash 与 MIDI 映射。（证据待补）

## 5. 操作层、历史与确定性变换

操作层是所有修改的唯一写入口。每个原语必须是确定性的 `doc → doc` 纯函数；精确参数、失败语义和范围规则以 [操作契约](operations.md) 为准。

### 批处理与历史

- [x] T-029 定义完整的 `Operation`、`OperationBatch`、`Scope`、来源和原语枚举，并建立结构级运行时校验：拒绝未知字段、未知原语、非法 scope、非法来源和批内重复操作 ID。（证据：`src/ops/types.ts`、`src/ops/validate.ts`、`validate.test.ts`；`pnpm test`）
- [x] T-030 为每个原语实现严格的 args/runtime tool 参数校验，并拒绝未列出的参数；结构校验不等于原语参数校验。（证据：`src/ops/apply.ts` 的全部原语分支均使用精确 args 白名单与运行时范围/引用校验；`apply.test.ts`；`pnpm test`）
- [x] T-031 实现批次模拟、最终 Schema 校验、原子提交和失败零写入；返回受影响对象与可诊断错误。（证据：`src/ops/apply.ts` 在深拷贝顺序模拟、最终 Schema 校验；`projectStore.test.ts` 和 `apply.test.ts` 覆盖零写入与受影响对象；`pnpm test`）
- [x] T-032 实现快照式 Undo/Redo、future 清空、history 内存边界和 batch 粒度回滚。（证据：`src/store/projectStore.ts`、`projectStore.test.ts` 覆盖成功 batch、redo 清空、50 条边界与 trimAndSplit 回滚；Demo 提供撤销/重做控件；`pnpm test`）
- [ ] T-033 保证所有 UI、键盘、导入、宏和 AI 只能调用 Operation Layer；添加防止直接写文档的架构测试。（证据待补）

### 结构、轨道、音符和自动化原语

- [x] T-034 实现 add/remove/extend/shrink/reorder section；`shrinkSection(overflow=trim)` 要预览截短 notes、删除 notes 和 automation 影响。（证据：`src/ops/apply.ts` 以 section 相对 beat 重建 automation；`apply.test.ts` 覆盖插入、延长、重排、截短/删除、级联删除和最后 section 防护；`pnpm test`）
- [x] T-035 实现 add/remove track、setInstrument、音源角色验证及级联删除 clip/automation。（证据：`src/ops/apply.ts` 结合乐器注册表校验；`apply.test.ts` 覆盖兼容性、未知乐器、最后一轨防护和级联删除；`pnpm test`）
- [x] T-036 实现稳定 clip/note ID 的 upsert/remove/replace/insert/update/remove notes；不得用数组下标作为持久引用。（证据：`src/ops/apply.ts`、`apply.test.ts` 覆盖新 ID、旧 ID 拒绝、scope 与原子 batch；`pnpm test`）
- [x] T-037 实现 `removeNotesInRange(mode=trimAndSplit)`，覆盖全删、单侧截短、跨范围拆分、split ID 校验与 Undo fixture。（证据：`src/ops/apply.ts`、`apply.test.ts` 与 `projectStore.test.ts` 覆盖全删、截短、拆分、split-ID 校验和 batch Undo；`pnpm test`）
- [x] T-038 实现 setTempo、setVolume、mute、solo 及受影响范围更新。（证据：`src/ops/apply.ts`、`apply.test.ts`、`projectStore.test.ts`；Demo 手工控件统一调用 `applyOperations`；`pnpm test`）
- [x] T-039 实现 setKey、transpose、changeKey 的严格区别；转调只在 mode 不变时转置 notes，越界 pitch 整批失败。（证据：`src/ops/apply.ts`、`apply.test.ts` 覆盖 scope、鼓组排除、调性不一致与原子失败；Demo 提供全曲移调入口；`pnpm test`）
- [x] T-040 实现 quantize、setVelocity、halfTime、doubleTime、humanize；不可满足 section 边界或最小 0.25 beat 时整批失败。（证据：`src/ops/apply.ts`、`apply.test.ts` 覆盖范围、边界、严格参数和 seed 可重放性；`pnpm test`）
- [x] T-041 实现 automation 点增删、严格排序、section 相对位置重排、同 lane 同 beat 合并及结果计数。（证据：`src/ops/apply.ts` 的相对 beat 重建和 lane 合并；`apply.test.ts` 覆盖增删、排序、重排与合并计数；`pnpm test`）
- [ ] T-042 为每个非平凡原语提供正常、边界、非法输入测试及属性/回归 fixture。（证据待补）

## 6. RenderPlan、音频播放与时间线

`RenderPlan` 是从有效工程和指定乐器注册表派生的确定性调度计划；它是实时播放、Proposal 试听、WAV 与 MIDI 的共同输入。字段级定义见 [输出与工程生命周期](output-and-lifecycle.md)。

- [ ] T-050 实现 canonical document 序列化、`sourceDocumentHash`、`planHash` 和 RenderPlan v1 编译器。（证据待补）
- [ ] T-051 在 RenderPlan 中解析 section 顺序、全局 beat、scope `[from,to)`、contextFrom、notes、automation、mute/solo、音源资产与 MIDI 映射。（证据待补）
- [ ] T-052 实现 Tone.js Transport 与按 beat 调度；支持播放、停止、全曲/section/range loop、可见 playhead 和受影响范围重排。（证据待补）
- [x] T-052b 修复 WebKit/Tone Transport 的启动窗口：`start()` 后由音频引擎维护播放意图，不能因 Transport 状态晚一个调度窗口更新而让 UI 误判停止并取消刚排好的事件。（证据：`src/audio/audioEngine.ts`、`src/audio/audioEngine.test.ts`；`pnpm check`。）
- [ ] T-053 实现轨道 gain、mute、solo、volume/filterCutoff automation；不支持的 lane 必须显式提示并在 plan 中标记。（证据待补）
- [ ] T-054 实现用户手势后的音频初始化、音源加载状态、加载失败、卡音防护、窗口失焦/停止时的全部 note-off。（证据待补）
- [x] T-054a 将高频页面试听从共享 `Tone.PolySynth` 拆分为有界原生 Web Audio 短音通道：每次点击创建独立 oscillator/gain，最多 24 个活动节点，满载时主动回收最早节点，最新音符不被丢弃；已运行的 `AudioContext` 直接复用，暂停时的并发试听共享一次恢复任务。播放停止立即清空 Transport 调度和旧工程引用，播放位置 UI 限为 10 Hz 更新，避免长时间循环时按屏幕帧率重渲染整页。（证据：`src/audio/audioEngine.ts`、`src/app/App.tsx`；`audioEngine.test.ts` 覆盖并发恢复和连续 10,000 次页面键盘点击回归；`pnpm check`、`pnpm exec tauri build --debug --bundles app`。）
- [ ] T-055 实现实时与离线引擎只消费同一 RenderPlan；未知注册表、hash 不匹配或不完整 plan 必须拒绝执行。（证据待补）
- [ ] T-056 建立音频调度测试：循环无重复事件、停止无残留、tempo/loop 边界、mute/solo、automation 和资产失败。（证据待补）

## 7. 电脑键盘输入与录制

详细映射和行为见 [电脑键盘输入](keyboard-input.md)。试听是短暂音频事件；录制结果必须以 OperationBatch 提交。

- [x] T-060 实现 `Q W E R T Y U I` 当前调性音阶映射、Shift 高八度、Z/X 默认八度与 C1–C7 本地偏好。（证据：`src/audio/scale.ts`、`src/input/keyboardPreferences.ts`、`src/app/App.tsx`；`keyboardPreferences.test.ts`、`scale.test.ts`；`pnpm check`）
- [x] T-061 实现 keydown/keyup 去重、文本输入/模态框禁用、失焦/隐藏/切换工程时 note-off。（证据：`src/app/App.tsx`、`src/audio/audioEngine.ts`；浏览器手测与 `pnpm check`）
- [x] T-062 实现 melodic track 试听；drums 不启用音阶键盘，错误状态清楚说明；页面白键短音与实体键持续音隔离，连续点击不会耗尽共享 PolySynth 声部。（证据：`src/app/App.tsx`、`src/audio/audioEngine.ts`、`audioEngine.test.ts` 的 10,000 次回归；`pnpm check`）
- [ ] T-063 实现录制 arm、目标 track/section、可见 playhead、暂停/继续、可关闭一小节 count-in 和 4/4 metronome。（证据待补）
- [ ] T-064 实现 1/16（0.25 beat）量化、边界截断、固定初始 velocity、overdub 和 trimAndSplit 替换范围。（证据待补）
- [x] T-065 验证整次录制作为一个可撤销批次提交，AI 后续读取提交后的文档而非键盘事件日志。（证据：`src/app/App.tsx`、`src/input/recording.ts`；`recording.test.ts`；浏览器手测“录入 → 写入 1 个量化音符 → 一次撤销”通过；`pnpm check`）

## 8. 工程生命周期、本地文件与恢复

生命周期规则以 [输出与工程生命周期](output-and-lifecycle.md) 为准；本地恢复不等于云端存储。

- [x] T-070 实现新建空白/模板工程、dirty 状态、文件名/路径/上次保存时间展示。（证据：`src/doc/templates.ts`、`src/store/projectStore.ts`、`src/app/App.tsx`；`projectStore.test.ts`；`pnpm check`）
- [x] T-071 实现 `.json` 保存、打开、另存与系统文件对话框；保存时更新 `updatedAt` 且不写入秘密/聊天/教程数据。（证据：`src/lifecycle/projectCodec.ts`、`src/lifecycle/tauriProjectFile.ts`、`src/lifecycle/tauriRuntime.ts`、`src-tauri/src/lib.rs`；`projectCodec.test.ts`、`tauriRuntime.test.ts`；已通过 `pnpm exec tauri build --debug --bundles app`；浏览器预览会给出明确桌面端提示。）
- [ ] T-072 实现最多 2 秒 debounce 的本地恢复副本、恢复/丢弃/另存选择和未保存退出三选项。（证据待补）
- [ ] T-073 实现损坏/未知版本/缺失注册表工程的只读诊断和原始备份导出。（证据待补）
- [ ] T-074 验证离线重启后，已保存工程、恢复副本、模板和打包音源均可用。（证据待补）

## 9. AI Provider、原生运行时与 Proposal（可选发布路径）

AI 相关实现必须服从 [AI 接入契约](ai-contract.md)。未通过 G2 前，以下条目可以实现为禁用状态，但不得伪装为可生成。

- [x] T-080 形成可审计的 AI 发布路径决策：macOS 应用内完成服务商选择、配置、生成与候选接受；当前开发期采用 Keychain BYOK，未来产品代付服务由相同原生边界调用。用户不需要启动网关、配置 URL 或假定聊天订阅含 API 额度。（证据：2026-07-19 架构决策；`docs/ai-contract.md`。）
- [ ] T-081 实现产品账户的原生登录、短期会话安全存储、断开连接与桌面端状态机；它不申请或保存用户 OpenAI/Gemini 凭据。（证据待补）
- [x] T-082 实现开发期无状态 Node 网关核心，作为历史实验与协议回归基线；已从桌面应用运行时移除。（证据：`gateway/src/`、`gateway/src/{auth,validation,openai,gemini,server}.test.ts`；`gateway/README.md` 迁移说明。）
- [ ] T-082a 以迁移管理的持久化 AccountStore、共享原子限流/会话撤销和幂等性替换开发期 MemoryAccountStore/MemoryGenerationLimiter。（证据待补）
- [ ] T-082b 实现产品套餐、真实 API 成本归集、每日/月度预算、额度展示、拒付/退款策略和管理员审计；不得以请求次数替代真实账务。（证据待补）
- [ ] T-082c 完成生产网关部署：固定域名/TLS、KMS/Secret Manager、密钥轮换、受控 egress、健康检查、监控告警、灾备与数据保留/删除策略。（证据待补）
- [x] T-082c-1 取消发布包的 `VITE_GATEWAY_URL`、WebView CORS 与本地端口依赖；AI 由 Tauri 原生侧发起 HTTPS 请求。产品服务地址若未来需要，由原生配置管理，用户不配置也不可见。（证据：`src/app/App.tsx` 的 `Chat`、`src/agent/desktopAiClient.ts`、`src-tauri/src/lib.rs`；`pnpm exec tauri build --debug --bundles app` 后对 `dist`/`.app` 资源检索无旧网关 URL 或文案。）
- [ ] T-082d 实现网关滥用防护：注册/登录/IP 与账户限流、邮箱验证/找回/删除、bot 防护和不含 prompt/token 的安全审计。（证据待补）
- [ ] T-082e 用真实产品 API Project 的隔离测试环境验证 OpenAI 与 Gemini 错误映射、用量归集、超时/取消和不泄露密钥；测试密钥不得进入仓库或桌面端。（证据待补）
- [x] T-082f 保留完全本地的模拟测试路径：显式 `local-demo` 模型、一次性 mock 第三方身份回调、内存账户/限流/用量；该路径不从桌面 UI 暴露，生产环境拒绝启动。（证据：`gateway/src/{config,auth,localDemoModel,server}.ts`、对应测试；`gateway/README.md`；`pnpm test` 122 项通过。）
- [x] T-082g 实现过本机 `.env.local` + loopback Node BYOK 路径；该路径已由 Keychain 原生 BYOK 替换，不再属于桌面应用运行时。（证据：`gateway/src/localEnvironment.ts`、`gateway/README.md`、`docs/ai-contract.md`。）
- [x] T-082h 实现双服务商协议适配，并以其 OpenAI/Gemini 结构化输出与运行时校验规则迁移到原生侧。（证据：`gateway/src/{openai,gemini,validation}.ts`、`src-tauri/src/lib.rs`；`cargo test`。）
- [ ] T-083 完成产品代付 `AiProvider`：原生侧 getStatus、planOperations、generateNotes、disconnect、服务商可用性和账户级选择；用户不配置或接触产品服务 URL。（证据待补）
- [x] T-083a 实现过 WebView 本机网关客户端；该客户端仅保留作历史协议测试，Chat 已不读取 `VITE_GATEWAY_URL` 或会话 token。（证据：`src/agent/gatewayClient.ts`、`src/app/App.tsx`。）
- [x] T-083b 实现 macOS 原生 BYOK `AiProvider`：Chat 在应用内选择 OpenAI/Gemini 并管理 Keychain Key；原生 Rust 直接进行 HTTPS 请求、结构化输出解析、30 秒超时与候选边界校验，WebView 生成命令不接收 Key。（证据：`src-tauri/src/lib.rs`、`src/agent/desktopAiClient.ts`、`desktopAiClient.test.ts`；`cargo test`、`pnpm check`、`pnpm exec tauri build --debug --bundles app`。）
- [ ] T-083c 为原生请求实现用户取消、取消后的连接清理及桌面端到端验证；不得以中断后写入候选或自动重试替代。（证据待补）
- [ ] T-084 实现最小 scope 文档投影、首次数据告知、scope 预览、内存聊天历史和敏感信息过滤。（证据待补）
- [x] T-084a 实现当前 Chat 页的数据范围告知与 track × section 选择：仅发送全局音乐参数和当前 clip 最多 120 个音符，不发送完整工程或本地路径。（证据：`src/app/App.tsx` 的 `Chat`、`src/tutorial/content.ts`；`pnpm typecheck && pnpm test`。）
- [x] T-085a 实现网关端候选 notes 的 JSON Schema/运行时边界校验，拒绝超出 section、音高/力度非法及超量候选。（证据：`gateway/src/validation.ts`、`gateway/src/{validation,openai}.test.ts`；`pnpm test`。）
- [x] T-085b 实现原生侧候选 Schema/运行时边界校验，拒绝超出 section、音高/力度/时值非法及超量候选。（证据：`src-tauri/src/lib.rs`；`cargo test`。）
- [ ] T-085 实现桌面端候选转换与校验、鼓/bass 模板兜底、和弦进行库和完整生成编排。（候选到基础 `upsertClip`/`replaceClipNotes`/`insertNotes` 的转换已完成；模板兜底与完整编排仍待完成。）
- [ ] T-086 实现 Proposal 模拟：在当前工程深拷贝顺序 apply batch → Schema/音源/scope 校验 → 候选 RenderPlan。（证据待补）
- [x] T-086a 实现候选 batch 的本地深拷贝模拟、scope 与 Schema 校验；失败候选不会暴露为可接受批次。（证据：`src/agent/proposal.ts`、`proposal.test.ts`；`pnpm test` 122 项通过。）
- [ ] T-087 实现 Proposal UI：summary、warnings、replace/overdub、受影响范围、试听、接受/拒绝/同 scope 重试；部分接受不进入 MVP。（证据待补）
- [x] T-087a 实现基础 Proposal UI：摘要、track/section、replace/overdub、音符数、接受/拒绝；未接受候选不写工程，接受按单一 agent batch 进入 Undo 历史。（证据：`src/app/App.tsx` 的 `Chat`、`src/agent/proposal.test.ts`；`pnpm typecheck && pnpm test`。）
- [x] T-087b 修复真实 AI 候选接受写入：长摘要不会再使 OperationBatch 标题超限；接受失败会在 Chat 就地显示可操作提示。已用 Gemini 对四个后续段落实际生成候选、逐个本地校验并接受写入，再导出成品 WAV。（证据：`src/agent/proposal.ts`、`src/app/App.tsx`、`src/journey/geminiLive.e2e.test.ts`、`deliverables/gemini-afternoon-melancholy.wav`；2026-07-19。）
- [ ] T-088 保证接受后重新编译的 document/plan hash 与已试听 Proposal 一致；不一致时要求重新试听。（证据待补）
- [x] T-088a 在接受前比对短生命周期候选的 source document 指纹；生成后工程若变化则丢弃候选并要求重新生成，避免覆盖新的手工修改。（证据：`src/agent/proposal.ts`、`proposal.test.ts`、`src/app/App.tsx`；`pnpm test`。）
- [ ] T-089 覆盖未配置 Key、Keychain 不可用、取消、网络/超时、429、无效候选、用户拒绝、一次修复上限和 Undo；产品代付模式补充会话失效。（证据待补）

## 10. 语义宏、作用域与 Arrangement

- [ ] T-090 实现 Arrangement 视图：section × track 网格、全局/section/track/clip scope、选中范围和空状态。（证据待补）
- [ ] T-091 实现宏展开器：更燃/更安静、延长/缩短、换鼓组/乐器、重写 section/track 都必须输出可预览 OperationBatch。（证据待补）
- [ ] T-092 实现 setEnergy 的确定性策略与可量化指标；禁止模型直接改文档。（证据待补）
- [ ] T-093 实现 scope 越界防护、重写 replace/overdub 提示和宏失败的零写入。（证据待补）
- [ ] T-094 建立至少六条语义指令的固定回归集，验证合法 batch、影响范围、可撤销与指标变化。（证据待补）

## 11. Piano Roll 与 Automation 编辑

- [ ] T-100 实现 Piano Roll canvas/交互层：显示 clip、网格、playhead、选择与缩放。（证据待补）
- [ ] T-101 实现 note 创建、拖动、改 pitch/start/dur/velocity、删除与多选，全部转换为 note ID 原语。（证据待补）
- [ ] T-102 实现编辑时的量化、越界提示、trimAndSplit 选区替换、Undo/Redo 与受影响范围重渲染。（证据待补）
- [ ] T-103 实现 Automation lane 的点创建、移动、删除、参数范围、排序和 RenderPlan 同步。（证据待补）
- [ ] T-104 验证手工编辑后 AI scope 投影、Proposal 模拟、播放和导出均使用修改后的同一文档。（证据待补）

## 12. WAV、MIDI 与片段导出

导出规则以 [输出与工程生命周期](output-and-lifecycle.md) 和 [乐器注册表](instrument-registry.md) 为准。

- [ ] T-110 实现导出 preflight：Schema、注册表/资产、实时/离线能力、范围、automation、时长、文件可写、削波风险。（证据待补）
- [ ] T-111 实现 WAV 全曲/section/range 导出：stereo PCM、44.1 kHz、16-bit、2 秒 release tail、临时文件、进度、取消与失败恢复。（证据待补）
- [x] T-111a 修复全曲 WAV 的 PCM 包络首帧：attack 从零开始时只跳过首个采样，而不提前结束整枚音符；有可播放事件的导出必须包含非静音 PCM。（证据：`src/export/wav.ts`、`src/export/wav.test.ts`、`src/journey/songFlow.e2e.test.ts`；`pnpm check`。）
- [ ] T-112 实现片段 WAV contextFrom 预渲染、片段起点 automation 插值、帧裁切和跨边界长音 tail。（证据待补）
- [ ] T-113 实现 SMF Type 1、PPQN 480、tempo/4-4 meta、轨道、drums channel 10、Program Change、CC7/CC74。（证据待补）
- [ ] T-114 实现片段 MIDI notes/automation 裁剪、起点插值和 beat 0 重定位；不可映射 automation 必须预警而非伪造。（证据待补）
- [ ] T-115 验证实时试听、Proposal preview、WAV 和 MIDI 使用相同 RenderPlan 注册表解析；哈希不一致时禁止导出。（证据待补）
- [ ] T-116 用独立播放器和 MIDI 工具验证文件可打开，且时长、tempo、轨道数、音符数量与工程/RenderPlan 相符。（证据待补）
- [x] T-116a 已用 macOS `afinfo` 验证端到端生成的 WAV：WAVE、2 声道、44.1 kHz、16-bit interleaved、62 秒、44-byte PCM data offset；端到端测试同时验证 MIDI `MThd`、WAV 非静音采样及本机可写文件。（证据：`/private/tmp/ai-music-ide-workshop-e2e.wav`、`src/journey/songFlow.e2e.test.ts`；2026-07-19。）

## 13. 横切质量、性能、安全与无障碍

- [ ] T-120 为 Schema、迁移、注册表、所有原语、宏、RenderPlan、导出范围建立单元/fixture 测试。（证据待补）
- [ ] T-121 建立集成测试：音源加载、Transport、键盘录制、Proposal 模拟、恢复、WAV/MIDI 预检。（证据待补）
- [x] T-121a 建立“做首歌”无网络集成回归：覆盖所有感觉/风格/发展方向 prompt、逐段本机扩展、AI 候选本地校验后接受、手工 OperationBatch、RenderPlan、MIDI 与非静音 WAV。（证据：`src/journey/songFlow.e2e.test.ts`；`pnpm check`。）
- [ ] T-122 建立桌面端到端测试：教程 → 新建/模板 → 编辑 → 保存/恢复 → 导出；AI 路径在 G2 通过时追加。（证据待补）
- [ ] T-123 验证所有键盘交互不干扰文本输入、教程可键盘操作、错误信息可被屏幕阅读器读取。（证据待补）
- [ ] T-124 实现长曲 scope 裁剪、请求/工具调用上限、token/费用本地估算和性能基准。（证据待补）
- [ ] T-125 审计秘密与隐私：除 macOS Keychain 中的用户主动保存 Key 外，无 API Key/Token/Cookie/完整 prompt 写入工程、日志、恢复副本、崩溃报告或教程进度。（证据待补）
- [ ] T-126 建立离线、缺失音源、损坏工程、取消导出、未保存退出、网络失败的回归用例。（证据待补）

## 14. 里程碑映射与最终验收

| 阶段            | 必须完成的技术项                                   | 阶段出口                                 |
| --------------- | -------------------------------------------------- | ---------------------------------------- |
| M-1 教程        | T-010…T-015                                        | 当前页面教程在任意已实现路由可用且可恢复 |
| M0 可播放骨架   | T-001…T-005、T-020…T-028、T-050…T-056、T-060…T-062 | demo 可离线播放，QWERT 试听无卡音        |
| M1 手工编辑底座 | T-030…T-042、T-063…T-074                           | 原语、录制、模板、恢复和 Undo 可用       |
| M2 AI/Proposal  | T-080…T-089                                        | 仅 G2 通过时可生成并确认 Proposal        |
| M3 语义/编排    | T-090…T-094                                        | scope 宏可预览、可撤销、可回归验证       |
| M4 专业手改     | T-100…T-104                                        | Piano Roll/Automation 编辑与 AI 同步     |
| M5 本地成品     | T-110…T-116                                        | 保存、恢复、WAV/MIDI 与试听一致          |
| M6 闭环         | T-120…T-126 + 所有适用前置项                       | 两条用户路径与异常路径完整通过           |

### M6 最终验收清单

- [ ] T-130 手工路径：空白工程 → 键盘录制 → Piano Roll 精细编辑 → 保存 → 重启恢复 → 全曲 WAV + MIDI 导出。（证据待补）
- [ ] T-131 模板路径：内置模板 → section/track 编辑 → 片段 WAV + 全曲 MIDI 导出。（证据待补）
- [ ] T-132 AI 路径（仅 G2 通过）：工程 → Proposal 试听/接受或重试 → 局部 AI + 手工编辑 → WAV + MIDI。（证据待补）
- [ ] T-133 独立验证：WAV 可播放、MIDI 可打开，且与 RenderPlan 的长度、tempo、轨道和音符一致。（证据待补）
- [ ] T-134 异常验证：缺失音源、非法文档、取消导出、网络失败、未保存退出都可恢复且不损坏已保存工程。（证据待补）
- [ ] T-135 新用户不查外部资料，仅依靠当前页面教程完成所有适用闭环路径。（证据待补）
