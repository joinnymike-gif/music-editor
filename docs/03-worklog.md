# 全周期工作项 — AI 音乐 IDE（MVP）

里程碑串行，每个 M 结束都能"跑起来 / 听得到"。勾选框追踪进度。

## 2026-07-20 — 全局静默失败收敛

- [x] 实时播放在启动 `Transport` 前完成所有计划乐器声部的预创建；真实采样或原生 Web Audio 资源异常会在可捕获链路中失败，不再等到调度回调里静默失效（证据：`src/audio/audioEngine.ts`、`audioEngine.test.ts`）。
- [x] 调度回调期间若底层声源创建失败，立即停止 Transport，并通过播放快照将明确错误反馈到页面；不再维持“正在播放”的假状态（证据：`src/audio/audioEngine.ts`、`src/app/App.tsx`）。
- [x] MIDI 导出与实时播放、WAV 导出共用“工程可听性”预检；全部静音/没有音符时拒绝产生看似成功的空白 MIDI（证据：`src/export/midi.ts`、`midi.test.ts`）。

---

## M-1 — 教程骨架（所有功能之前）

目标：先建立可访问、可恢复的教程能力；后续页面没有教程不得标记完成。

- [x] 全局 App Shell：所有页面固定显示带文字的“当前页面教程”按钮，键盘可访问（证据：`src/app/App.tsx`；`pnpm test`）
- [x] 教程侧栏：上下文匹配、非阻塞展示、锚点高亮、跳过/继续/重试/重置（证据：`src/tutorial/TutorialDrawer.tsx`；`pnpm test`）
- [x] 本地进度：首次引导、恢复进度、内容版本升级和“重新开始教程”（证据：`src/tutorial/progress.ts` 与单测）
- [x] 锚点降级：页面元素暂缺或不可见时只显示文字说明，应用不报错、不阻塞（证据：`src/tutorial/TutorialDrawer.test.tsx`）
- [x] 核心空壳教程：欢迎页、工程 demo、播放控制（可使用 mock 界面验证流程）（证据：`src/tutorial/content.ts`；`pnpm build`）
- [x] **验收**：任意路由点击按钮均有可理解的当前页面教程；关闭后可继续操作，重启后进度保留（证据：6 项 Vitest 测试通过；`pnpm exec tauri build --debug` 成功生成 macOS `.app`）

---

## M0 — 可播放的文档骨架

目标：硬编码一份工程 JSON，能听到多轨器乐。

- [x] `doc/` Schema 类型定义（meta / sections / tracks / clips / automation）（证据：`src/doc/types.ts`；`pnpm typecheck`）
- [x] Schema 运行时校验（拒绝非法文档）（证据：`src/doc/schema.ts`、`src/doc/schema.test.ts`；`pnpm test`）
- [ ] 固化 `schemaVersion: "1.0"`、迁移入口与有效/无效 fixture
- [x] 初始化工程、TypeScript 严格模式、单元测试与格式/类型检查命令（证据：`pnpm check`；2026-07-18 全质量门通过）
- [x] Zustand store 装文档（证据：`src/store/projectStore.ts`；`projectStore.test.ts` 验证有效 demo 载入与非法工程零替换）
- [x] `audio/` Tone.js 引擎：Transport + 按 beat 调度音符（证据：`src/audio/audioEngine.ts`、`audioEngine.test.ts`；`pnpm test`；2026-07-18 桌面端人工确认 Demo 点击播放可听到声音）
- [x] 程序化音色加载（先 3 个乐器：kit / bass / lead；M0 不分发第三方 SoundFont）（证据：`tone@15.1.22`、`src/audio/audioEngine.ts`）
- [x] 乐器注册表 v1：资产版本/许可、角色、实时/离线能力、automation 和 MIDI Program 映射（证据：`src/instruments/registry.ts`；`registry.test.ts`）
- [x] 播放 / 停止 / 循环（证据：`src/audio/audioEngine.ts`、`audioEngine.test.ts`；浏览器走查与 2026-07-18 桌面端人工听音确认）
- [x] 电脑键盘试听：lead 轨 `Q W E R T` 映射当前调性的 do/re/mi/fa/sol；失焦时停止全部试听音符（含 Shift/I 高八度、Z/X 本地 C1–C7 偏好；证据：`src/app/App.tsx`、`src/input/keyboardPreferences.ts`、相关单测与浏览器走查）
- [x] 补齐 M0 教程：demo、播放/停止/循环、加载失败和 QWERT 试听；每步包含预期结果与常见错误（证据：`src/tutorial/content.ts`、`content.test.ts`；`pnpm test`）
- [x] 硬编码一段 8 小节 JSON 作为 demo（证据：`src/doc/fixtures/valid-project-v1.json`、`src/doc/demo.ts`；`playbackPlan.test.ts` 验证 32 beat / 三轨计划）
- [x] **验收**：按 [M0 定义](m0-definition.md) 的现有 M0 步骤，点播放能听到一段器乐且校验/测试均通过（证据：2026-07-18 用户已确认 Demo 可听到声音；`pnpm check`、`pnpm exec tauri build --debug --bundles app`）

## M1 — 原语操作层 + 撤销

目标：确定性编辑跑通，可撤销。

- [x] OperationBatch 基础契约：统一来源、scope、原语枚举与结构校验，未知字段/原语不会进入 Store（证据：`src/ops/types.ts`、`src/ops/validate.ts`；`validate.test.ts`）
- [x] `ops/` 原语：transpose / setTempo / setKey / setVelocity / quantize / humanize / halfTime / doubleTime（证据：`src/ops/apply.ts`、`apply.test.ts`；`pnpm test`）
- [x] 原语：addTrack / removeTrack / setInstrument（证据：`src/ops/apply.ts`、`apply.test.ts`；`pnpm test`）
- [x] 原语：addSection / removeSection / extendSection / reorderSections（证据：`src/ops/apply.ts`、`apply.test.ts`；`pnpm test`）
- [x] 原语：shrinkSection（受影响 notes/automation 预览 + 显式 trim）（证据：`AffectedObjects` 返回截短/删除 note 与 automation 计数；`apply.test.ts`；`pnpm test`）
- [x] 为 clip / note 引入稳定 UUID；原语 updateNotes / removeNotes 仅以 note ID 精确编辑（证据：`src/ops/apply.ts`、`apply.test.ts`；`pnpm test`）
- [ ] 固化 P0 原语参数/返回值契约：转调、替换/更新 notes、half/doubleTime、`trimAndSplit` 范围删除与 automation 重排均有 fixture（转调、replace/update、half/doubleTime 与 trimAndSplit 的核心边界测试已完成；automation 重排与 history fixture 仍待完成）
- [x] 混音原语：setVolume / mute / solo 的原子文档变换、受影响轨道返回与 Demo 手工入口（证据：`src/ops/apply.ts`、`apply.test.ts`、`src/app/App.tsx`；`pnpm test`。实时 gain 同步仍随 M0/M1 播放重排继续完成）
- [ ] 电脑键盘录制：Piano Roll 已支持 melodic track + section 的 QWERT 量化 overdub，并以一个操作批提交（证据：`src/input/recording.ts`、`src/app/App.tsx`、`recording.test.ts`；`pnpm check`）。替换范围、count-in、节拍器与 transport playhead 同步仍待完成。
- [ ] 时间线控制：全曲/选段 loop、可见 playhead、录制 arm、暂停/继续、一小节 count-in 与 metronome
- [ ] 工程起点：空白工程与内置曲风模板；dirty 状态、自动恢复草稿和退出确认（空白/Lo-fi/Electronic/Pop 模板、JSON 保存/打开/另存和 1.2 秒本地恢复副本已完成；退出保存/放弃/取消三选项仍待完成）
- [ ] 补齐 M1 教程：作用域、原语编辑、撤销/重做和键盘录制/替换范围
- [ ] 每个用户回合前整份文档快照
- [x] 撤销 / 重做（证据：`src/store/projectStore.ts`、`projectStore.test.ts`；Demo 的撤销/重做控件与当前页面教程；`pnpm test`）
- [ ] 每个非平凡原语的单元测试（正常、边界、非法输入）
- [ ] **验收**：改速 / 转调 / 改力度生效且可撤销；键盘录入的音符播放正确且整次录制可撤销（基础录制提交已实现，仍需替换范围与 transport 录制验收）

## M2 — Agent 循环 + 生成

目标：一句话出完整器乐。

- [ ] `agent/` OpenAI/Gemini provider tool 定义（每个原语一个 tool）
- [ ] Provider Adapter、产品代付服务连接、产品会话安全存储与断开连接（macOS 原生 BYOK、双服务商选择与本机 Key 删除已完成；产品账户/计费/限额与可取消请求仍待完成）
- [x] 历史无状态 Node 生成网关：保留协议回归基线，已从桌面端运行时移除（证据：`gateway/src/`、`gateway/README.md`）
- [x] macOS 原生 BYOK AI 路径：Chat 内选择 OpenAI/Gemini、Key 保存至 Keychain、原生 HTTPS 的 Responses/Interactions 请求、最小 scope、结构化候选与接受/拒绝；不需要 Node 网关、端口、临时账户或浏览器。（证据：`src-tauri/src/lib.rs`、`src/agent/desktopAiClient.ts`、`src/app/App.tsx`；`cargo test`、`pnpm check`、`pnpm exec tauri build --debug --bundles app`）
- [ ] scope 文档投影序列化进上下文；禁止上传无关工程数据
- [ ] 候选 MIDI 音符数组生成 → Schema/音乐约束校验 → `replaceClipNotes` 原语提交（基础 notes → upsert/replace/insert batch 与深拷贝 Schema 模拟已完成；音乐约束和完整编排仍待完成）
- [ ] 生成编排：定 tempo/key → 段落结构 → 和弦进行 → 逐轨逐段填充
- [ ] 鼓 / bass 模板库兜底（AI 主要生成旋律 / 和声）
- [ ] 默认和弦进行库
- [ ] Chat 面板（输入 + 操作历史 + 回滚按钮）（原生 Keychain 配置、范围选择、错误和基础候选接受/拒绝已完成；操作历史、取消和产品会话仍待完成）
- [ ] AI Proposal：候选试听、操作摘要、scope/replace/overdub 提示、接受/拒绝/同范围重试；未接受草稿不写工程（基础摘要、scope/策略、接受/拒绝已完成；试听、警告和同范围重试仍待完成）
- [ ] Proposal 模拟器：候选 batch 先在工程深拷贝执行并通过 Schema/音源预检，再生成 preview RenderPlan（深拷贝原语/Schema 模拟已完成；音源预检和 preview RenderPlan 待完成）
- [ ] RenderPlan v1：canonical document hash、范围、预渲染上下文、解析后的注册表资产、调度事件与 plan hash
- [ ] AI 发布门槛：仅在原生 Keychain/服务商边界或产品计费归属、限额和生成失败恢复均验证后显示“可生成”
- [ ] 补齐 M2 教程：AI Keychain 状态、数据发送范围、候选预览、失败与重试（Keychain 配置、范围、接受/拒绝和手工替代路径已完成；候选试听与重试待完成）
- [ ] AI 失败策略：超时/限额/无效候选/中断均不改变工程，用户可重试或继续手动编辑
- [ ] **验收（仅 AI 发布门槛通过时）**："生成一段 lo-fi hiphop" 出完整可循环器乐；断开 AI 后本地工程仍可正常编辑与播放

## M3 — 语义宏 + 作用域

目标：自然语言逐步修改 + 段落 / 轨道级重写。

- [ ] `ops/` 语义宏展开器（宏 → 原语序列，可预览）
- [ ] setEnergy（更燃 / 更安静）
- [ ] 加长 / 缩短段落（extendSection + 逐轨 replaceClipNotes）
- [ ] 换鼓组 / 换乐器
- [ ] 重写某段 / 某轨（scope=section / track）
- [ ] Arrangement 视图：段落 × 轨道网格，点选设 scope
- [ ] 补齐 M3 教程：选择 scope、预览语义宏和回滚
- [ ] 语义宏小评测集（"更燃"能量指标前后可量化）
- [ ] **验收**："副歌更燃""只重写 bass""副歌再长一点" 稳定生效

## M4 — Piano Roll + Automation

目标：专业手动编辑，AI 仍懂全局。

- [ ] Piano Roll canvas：画 / 移动 / 增删音符 → 发原语操作
- [ ] 音符编辑：拖动、改时值、改力度
- [ ] Automation 视图：画 / 编辑曲线点（底层 automation 原语已完成；可视化编辑界面仍待 M4）
- [ ] 手动编辑后重渲染正确
- [ ] 验证 AI 后续指令基于改后文档
- [ ] 补齐 M4 教程：Piano Roll、Automation、键盘录入后的细调
- [ ] **验收**：手改音符 / 曲线后播放正确，AI 上下文同步

## M5 — 本地化收尾

目标：完全本地可用。

- [ ] 工程存 / 读 `.json`（Tauri fs 或 IndexedDB）
- [ ] 新建 / 打开 / 另存工程
- [ ] 导出音频：同一 RenderPlan 的离线 WAV 渲染、资产/削波/automation 预检、进度、取消和失败恢复
- [ ] 注册表一致性：工程引用的音源版本、试听资产、离线渲染资产与 MIDI Program 映射完全一致
- [ ] 导出 MIDI：SMF Type 1、tempo/拍号/轨道/鼓映射/Program Change/受支持 CC 的明确转换
- [ ] 片段导出边界：WAV preroll + release tail、automation 起点插值；MIDI notes/CC 裁剪并重定位到 beat 0
- [ ] 基础错误处理（生成失败可重试、损坏文档提示）
- [ ] 补齐 M5 教程：新建、打开、保存、导出和损坏文档恢复
- [ ] **验收**：断网下完成新建/恢复→编辑→保存→导出全流程；导出内容与试听的音符、tempo、mute/solo 和受支持 automation 一致（生成步骤除外）

## M6 — 可交付闭环验收

目标：验证用户能独立完成“音乐片段输出 → AI/手工编辑 → 成品输出”。

- [ ] 手工路径：空白工程 → 键盘录制 → Piano Roll 精细修改 → 保存/重启恢复 → 导出 WAV + MIDI
- [ ] AI 路径（仅在 AI 发布门槛通过时）：模板/空白工程 → 生成 Proposal → 试听/接受或重试 → 局部 AI 重写 + 手工编辑 → 导出 WAV + MIDI
- [ ] 导出结果复核：WAV 可在独立播放器打开；MIDI 可在独立 MIDI 工具打开；二者与工程长度、tempo 和音符数量相符
- [ ] 异常复核：缺失音源、非法文档、取消导出、网络失败、未保存退出均有可恢复路径且不损坏已保存工程
- [ ] 逐项完成新建/录制/AI/导出教程；无外部文档帮助的首次用户完成两条路径
- [ ] **验收**：两条可用路径均通过，或 AI 路径因发布门槛未通过而从产品承诺与教程中明确隐藏

---

## 横切工作项（跨里程碑，持续）

- [ ] 键鼠交互：快捷键（播放 / 撤销 / 删除 / 缩放）；完整规则遵循 [电脑键盘输入](keyboard-input.md)
- [ ] 长曲上下文成本控制（超长时只传 scope 邻域）
- [ ] soundfont 音质打磨（至少覆盖若干曲风的默认音色）
- [ ] 生成结果人评 + 语义宏回归用例积累
- [ ] 维护固定评测集：6 条 MVP 语义指令、无效 tool call、超时与撤销/重做场景

## 明确延后（本期不做）

人声 / 歌词、真实录音、MIDI 硬件、移动端、多人协作、云端存储、专业混音母带。
底座设计保证以上均为"加视图 / 加后端"，不触及核心。

---

## 2026-07-18 功能回归记录

- [x] 自动化质量门：`pnpm check` 通过，30 个测试文件、122 项测试均通过；生产 Web 构建成功。
- [x] 桌面构建：`pnpm exec tauri build --debug --bundles app` 通过，并生成 macOS 调试应用包。
- [x] 浏览器交互走查：Demo 手工编辑与 Undo、QWERT/Shift/I/Z/X 输入、片段入口、键盘录制量化写入与一次 Undo、模板新建、重启后的恢复副本、当前页教程、AI 网关未配置降级均通过。
- [x] 本次修复：补齐 Z/X 本地八度偏好和工程/轨道切换 note-off；修正文档/教程中的过期“尚未保存或导出”表述；浏览器预览调用保存/导出时改为明确的桌面端提示。
- [ ] 仍未完成的功能不以本次通过替代：以 `docs/02-technical.md` 的未勾选 T-022、T-026…T-028、T-033、T-042、T-050…T-056、T-063…T-064、T-072…T-074、T-081、T-082a…、T-083…T-089、T-090…T-135 为准；尤其是专业 RenderPlan、完整录制控制、生产 AI/OIDC、范围导出与桌面端到端闭环。

---

## 2026-07-19 试听稳定性回归

- [x] 定位并修复连续电脑键盘试听静音：共享 `Tone.PolySynth` 在待释放声音达到 32 个时会丢弃新音符。页面白键改为有界的原生 Web Audio 短音通道，最多保留 24 个活动节点并主动回收最早节点；实体键持续音也不再占用编曲播放声部。（证据：`src/audio/audioEngine.ts`。）
- [x] 新增 10,000 次连续页面键盘点击压力回归：每次都创建新的短音节点；前 9,976 个会被安全回收，最后 24 个保持活动上限，不会出现后续音符被拒绝。（证据：`src/audio/audioEngine.test.ts`；单测约 1.35 秒通过。）
- [x] 完整质量门：`pnpm check` 通过，31 个测试文件、128 项测试及生产 Web 构建通过；桌面包在本记录后重新构建。

---

## 2026-07-19 长时间运行性能收敛

- [x] 降低持续播放 CPU：播放位置由每个动画帧触发的 App 根组件更新，收敛为 100 ms 一次（10 Hz）；停止后立即清理定时器。视觉进度保持平滑可读，不再以约 60 次/秒的频率重渲染整个应用。（证据：`src/app/App.tsx`；`pnpm check`。）
- [x] 释放音频调度：每次停止都执行 `Tone.Transport.cancel(0)` 并丢弃旧播放计划，避免长编辑会话保留已停止工程的回调闭包和音符计划。（证据：`src/audio/audioEngine.ts`、`audioEngine.test.ts`；`pnpm check`。）
- [x] 降低密集试听与 AI 的资源抖动：运行中的 AudioContext 不再重复 `Tone.start()`；多次并发恢复共用一个 Promise。原生 OpenAI/Gemini 请求改为复用单一 `reqwest::Client`，保留连接池而非每次生成新建客户端。（证据：`src/audio/audioEngine.ts`、`audioEngine.test.ts`、`src-tauri/src/lib.rs`；`pnpm check`、`cargo test`、`pnpm exec tauri build --debug --bundles app`。）

---

## 2026-07-19 原生桌面 AI 架构迁移记录

- [x] 移除桌面运行时对浏览器、Node 网关、本地端口、`VITE_GATEWAY_URL` 与临时账户的依赖；保留 `gateway/` 仅用于历史协议回归。（证据：`src/app/App.tsx`、`gateway/README.md`；打包后的 `dist` 与 `.app` 资源未检出旧网关 URL/文案。）
- [x] 将 OpenAI/Gemini BYOK 配置与请求迁入 Tauri 原生侧：macOS Keychain 保存 Key、`reqwest` 直接请求、结构化候选解析及边界校验；Chat 同页提供服务商选择、保存/删除 Key 与候选接受/拒绝。（证据：`src-tauri/src/lib.rs`、`src/agent/desktopAiClient.ts`、`src/tutorial/content.ts`；`cargo test` 4 项通过。）
- [x] 为打包 WebView 配置 CSP，限制到本地资源、Tauri IPC 与 asset 协议；开发 CSP 仅额外允许 Vite HMR。（证据：`src-tauri/tauri.conf.json`；`pnpm exec tauri build --debug --bundles app`。）
- [x] 质量验证：`pnpm check` 通过（31 个测试文件、124 项测试）；`cargo test` 通过（4 项）；macOS 调试包已生成。（证据：`pnpm check`、`cargo test`、`pnpm exec tauri build --debug --bundles app`。）
- [ ] 未替代的后续项：原生请求取消和真实桌面端到端 Keychain/API 验证（T-083c）、产品代付账户与计费（T-081、T-082a…T-082e、T-083）、Proposal 试听与 RenderPlan/导出闭环（T-050…T-056、T-086…T-089、T-110…T-116）。

---

## 2026-07-19 零乐理创作旅程实现记录

- [x] 新增“做首歌”应用内任务入口：QWERT 上行热身 → 10 秒音乐工坊 → 可选音频参考 → 日常语言创作问答 → 结构路线图 → 逐段扩展 → Piano Roll 微调 → Demo 试听/导出。每一页仍由固定“当前页面教程”解释下一步。（证据：`src/journey/CreativeJourney.tsx`、`src/tutorial/content.ts`、`docs/creative-journey.md`。）
- [x] 10 秒工坊创建真实、可保存的工程文档：第一个 5 小节段为开场，鼓/低音/旋律三轨可立即播放；其后是展开、变化、高潮、收束，合计 30 小节。所有本机扩展均为可撤销 `OperationBatch`，不会覆盖开场或已有段落。（证据：`src/journey/workshop.ts`、`workshop.test.ts`、`projectStore.test.ts`。）
- [x] 音频参考默认本机处理：系统对话框选取最多三段支持格式，WebView 本地解码后仅生成可复核的能量/明暗/变化摘要；AI prompt 排除原始字节与绝对路径。（证据：`src/journey/audioSeed.ts`、`audioSeed.test.ts`、`workshop.test.ts`。）
- [x] 修复创作旅程热身页无法使用实体键的问题：Q/W/E/R/T 现与页面按键共享同一状态机；长按重复、组合键和输入框聚焦不会误触发。同步修复键盘事件目标为 `window` 时的安全判断，避免监听器异常中断。（证据：`src/journey/CreativeJourney.tsx`、`src/app/App.tsx`、`CreativeJourney.test.tsx`；`pnpm check`、`pnpm exec tauri build --debug --bundles app`。）
- [x] 创作旅程的每个非首步提供“返回上一步”：返回不会丢失当前工程、参考摘要或创作方向；组件回归测试覆盖“方向 → 参考”的保留数据返回。（证据：`src/journey/CreativeJourney.tsx`、`CreativeJourney.test.tsx`；`pnpm test`。）
- [ ] 后续不能跳过的收尾：原生音频分析 worker/进度/取消、波形选区、真实节拍/调性分析、跨设备可移植 Journey manifest、AI Proposal 试听与最终 RenderPlan 导出一致性；对应 `T-019b…T-019e`、`T-050…T-056`、`T-086…T-089`。

---

## 2026-07-19 做首歌试听与导出闭环回归

- [x] 修复 Demo 播放无声的状态竞争：Tone Transport 的 `start()` 与状态字段存在短暂调度延迟，UI 不再在该窗口把已经排好的播放计划视作停止；播放状态改由音频引擎的明确生命周期维护，取消请求会显示可理解的错误提示。（证据：`src/audio/audioEngine.ts`、`src/app/App.tsx`、`audioEngine.test.ts`。）
- [x] 修复 WAV 实际静音：离线包络在 attack 的第 0 帧为零，旧逻辑错误地直接跳出整枚音符循环。现在仅跳过这一帧，后续 PCM 正确写入；新增非静音采样回归。（证据：`src/export/wav.ts`、`src/export/wav.test.ts`。）
- [x] 补齐成品长度分支：在“方向”页选择 30 秒、60 秒或 120 秒时，后续段落会通过可撤销 macro 调整为 15、30、60 小节；路线图、播放、MIDI 和 WAV 从同一工程文档读取该长度。（证据：`src/journey/workshop.ts`、`CreativeJourney.tsx`、`workshop.test.ts`。）
- [x] 端到端回归实际跑通：10 秒种子 → 本机逐段扩展 → AI 候选校验/接受 → 手工收束音 → RenderPlan → MIDI + WAV；测试写出 `/private/tmp/ai-music-ide-workshop-e2e.wav`，验证 WAVE 头、非静音 PCM 与文件存在。macOS `afinfo` 进一步确认该文件为 2 声道、44.1 kHz、16-bit PCM、62 秒。（证据：`src/journey/songFlow.e2e.test.ts`、`pnpm check`。）
- [x] 压力与构建验证：连续 10,000 次页面键盘试听测试通过；`pnpm check` 通过（36 个测试文件、147 项测试）；更新后的 macOS `.app` 已生成。DMG 封装脚本最后一步失败，不影响 `.app` 运行包。（证据：`src-tauri/target/debug/bundle/macos/AI Music IDE.app`。）

---

## 2026-07-19 AI 候选长摘要校验修复

- [x] 修复 AI 候选摘要与 OperationBatch 标题的长度契约不一致：候选摘要可保留至 300 字供用户审核，但写入 Undo 历史的 `AI 候选：…` 标题会压缩至校验要求的 120 字符以内；原生侧同时提示模型优先输出 120 字以内摘要并声明 schema 上限。（证据：`src/agent/proposal.ts`、`src-tauri/src/lib.rs`、`proposal.test.ts`。）
- [x] 回归验证：包含长中文摘要的候选成功通过本地 Schema/OperationBatch 校验；`cargo test` 4 项、`pnpm check` 36 个文件 148 项测试通过，更新后的 macOS `.app` 生成于 19:23。（证据：`src/agent/proposal.test.ts`、`src-tauri/target/debug/bundle/macos/AI Music IDE.app`。）

---

## 2026-07-19 Keychain 会话保活

- [x] 原生侧首次成功访问 OpenAI/Gemini Keychain 项后，将 Key 仅缓存在应用进程内存 12 小时；后续生成直接使用该缓存，不再重复触发 macOS 钥匙串密码框。退出应用或删除对应 Key 会立即清除缓存，Key 从不返回 WebView、工程或日志。（证据：`src-tauri/src/lib.rs`、`docs/ai-contract.md`。）
- [x] 新增 TTL 回归：缓存 12 小时内可用，到期自动失效。（证据：`src-tauri/src/lib.rs` 的 `retains_a_key_only_until_the_twelve_hour_session_expiry`。）

---

## 2026-07-19 Gemini 真实做首歌交付

- [x] 修复 AI 候选“接受并写入工程”不可见失败：长摘要现在生成受 120 字符上限约束的操作标题，候选仍保留完整摘要；若写入被播放/录制状态或本地校验阻止，Chat 直接显示可执行错误说明。（证据：`src/agent/proposal.ts`、`src/app/App.tsx`。）
- [x] 使用用户授权的临时 Gemini Key 按原生 Gemini Interactions 协议实际运行完整路径：10 秒开场 → 对四个后续段落逐段请求 Gemini lead 候选 → 本地 proposal/schema 校验 → 接受写入 OperationBatch → 本机补齐鼓/低音 → WAV 导出。参考 `/Users/mydoczhang/Downloads/昼下がりの憂鬱.mp3` 仅在本机形成“温暖、安静、午后忧郁、后段轻微推进”的文字摘要；未上传原始音频，提示词明确禁止复制旋律、歌词、音色或结构。（证据：`src/journey/geminiLive.e2e.test.ts`。）
- [x] 交付件验证：`deliverables/gemini-afternoon-melancholy.wav` 已由 macOS `afinfo` 验证为 WAVE、2 声道、44.1 kHz、16-bit interleaved、62 秒；PCM 抽样非零。临时 Key 仅以单次进程环境变量用于该测试，未写入工程、仓库或交付文件。（证据：2026-07-19 真实运行记录。）

---

## 2026-07-20 多乐器键盘试听与编排

- [x] 将内置乐器扩展为 8 种：原声鼓组、指弹贝斯、合成主音、钢琴、电钢琴、原声吉他、小提琴、长笛。电脑键盘试听可选择 6 种实录旋律乐器和明确标注的合成主音；编排页可按轨道选择角色兼容的乐器，变更仍通过可撤销 `setInstrument` 写入工程。（证据：`src/instruments/registry.ts`、`src/app/App.tsx`。）
- [x] 保持试听/播放/导出一致：钢琴、电钢琴、吉他、小提琴、长笛和指弹贝斯从同一批 SHA-256 校验实录 WAV 进行实时试听和离线导出；合成主音是唯一明确的方波合成实现。原声鼓组没有实录层，因此保持置灰，绝不回退为电子音。（证据：`src/audio/{sampleBank,audioEngine}.ts`、`src/export/wav.ts`、`sampleBank.test.ts`、`audioEngine.test.ts`、`wav.test.ts`。）
- [x] 实录音阶回归：对 6 种实录乐器逐一覆盖 C1–C7 的 Q/W/E/R/T/Y/U 七音阶（294 次），确认每次经实际样本解码并创建 `AudioBufferSourceNode`；另以浏览器界面逐次选择乐器、切换八度并点击全部 294 个按键，六类乐器均无页面音频错误。（证据：`src/audio/audioEngine.test.ts`；2026-07-20。）
- [x] 修复实录试听前摇：量化后发现钢琴实录含 0.345–0.557 秒前导静音、小提琴含 1.989 秒前导静音，低八度变调时等待会进一步放大。为每个实录层登记 `onsetSeconds`，实时 `AudioBufferSourceNode` 与离线 WAV 同时从该起音点读取；当前乐器/八度变更后预解码所需层，使首次按下不再等待全部多层样本。浏览器在 C1 实测钢琴、小提琴、指弹贝斯的页面点击与实体 Q 键均无错误。（证据：`src/audio/{sampleBank,audioEngine}.ts`、`src/export/wav.ts`、`audioEngine.test.ts`、`sampleBank.test.ts`；2026-07-20。）

---

## 2026-07-20 Gemini 钢琴与吉他成品交付

- [x] 使用用户授权的一次性 Gemini Key 实际跑通“做首歌”：保留 10 秒种子，仅保留钢琴和原声吉他轨道；Gemini 对四个后续段落逐段生成原创原声吉他旋律候选，本地校验、显式接受写入后再补齐钢琴和声。参考 `昼下がりの憂鬱.mp3` 只在本机读取时长、响度与“温暖、安静、午后忧郁、后段轻微推进”的整体摘要；未上传原始音频，提示明确禁止复制旋律、歌词、音色或结构。（证据：`src/journey/geminiLive.e2e.test.ts`；2026-07-20。）
- [x] 交付 WAV 已以独立工具验证：`deliverables/gemini-afternoon-piano-guitar.wav` 为 WAVE、双声道、44.1 kHz、16-bit interleaved PCM、62 秒，PCM 平均响度 -28.8 dB、峰值 -20.8 dB，具备可播放音频数据。（证据：macOS `afinfo`、`ffprobe`、`ffmpeg volumedetect`；2026-07-20。）

---

## 2026-07-20 Gemini 成品音轨修复

- [x] 修复 Node 离线 WAV 导出错误地使用测试 `OfflineAudioContext` 常量缓冲的问题：导出器现直接解析、SHA-256 校验并混合随包 PCM WAV，Node、浏览器与桌面端均使用同一真实钢琴/吉他资产；新增正负波形回归，拒绝“非静音但没有实录音轨”的常量输出。（证据：`src/audio/pcmWav.ts`、`src/audio/pcmWav.test.ts`、`src/audio/sampleBank.ts`、`src/export/wav.test.ts`；2026-07-20。）
- [x] 修复真实 Gemini 候选越界使整曲中断：本地 Proposal 校验改为返回可处理失败；做首歌流程对无效候选最多重试 3 次，并明确约束每枚音符 `start + dur <= sectionBeats`。（证据：`src/agent/proposal.ts`、`proposal.test.ts`、`src/journey/geminiLive.e2e.test.ts`；2026-07-20。）
- [x] 修复成品响度过低：离线混音保留钢琴/吉他的相对动态后，将整体峰值归一到安全范围。最终交付 `gemini-afternoon-piano-guitar.wav` 已重新用 Gemini 真实生成并验证为 62 秒、44.1 kHz、16-bit stereo PCM，真实双向波形 RMS difference 约 215–218、平均响度 -23.2 dB、峰值 -3.0 dB。（证据：`src/export/wav.ts`、Gemini live test、macOS `afinfo`、`ffmpeg astats/volumedetect`；2026-07-20。）

---

## 2026-07-20 做首歌热身试听闭环修复

- [x] 修复“做首歌”热身页的假完成状态：Q/W/E/R/T 之前以 fire-and-forget 方式发起试听，真实采样加载或 Web Audio 恢复失败时仍会更新黄色进度，且错误只在 Demo 页可见。现在 `onTapScaleKey` 只会在音源已成功调度后完成；热身状态机等待该结果，失败不推进，并在当前页给出可读错误。（证据：`src/app/App.tsx`、`src/journey/CreativeJourney.tsx`。）
- [x] 回归覆盖点击、实体键和失败三分支：鼠标点击与实体 QWERT 使用同一异步试听链路；采样失败时保持 0/5 并显示错误。浏览器本地界面实际依次验证点击 Q、实体 W/R/T、点击 E 后可解锁 10 秒工坊，控制台无错误。（证据：`src/journey/CreativeJourney.test.tsx`、2026-07-20 本机界面走查。）

---

## 2026-07-20 长音频参考时间轴导入

- [x] 移除“源文件超过 3 分钟即拒绝”的限制：选择后的音频先仅在页面内存解码，用户可用开始/结束双时间轴或秒数输入保留 1–45 秒，并可试听这段实际范围；确认后才将该范围的本机特征摘要写入创作任务。源文件 PCM、路径和完整时长不会进入 AI prompt 或 Journey 持久化数据。（证据：`src/journey/{audioSeed,CreativeJourney}.ts`。）
- [x] 新增长源文件范围回归：240 秒来源请求 10–100 秒时会截为 10–55 秒，摘要时长为 45 秒且保存标签反映该时间轴范围；原有权重与本机摘要回归继续通过。（证据：`src/journey/audioSeed.test.ts`。）

---

## 2026-07-20 纯本地做首歌导出可听性修复

- [x] 拆分“本机扩展 + Piano Roll 微调”与 AI 候选的端到端验证：新回归严格不构造、不请求、不接受 AI 候选，依次覆盖 10 秒开场、四段本机 MIDI 扩展、Piano Roll 插入收束音、RenderPlan 与 WAV。结果验证为真实正负 PCM 波形、峰值超过 24,000，并写出 `/private/tmp/ai-music-ide-local-manual-e2e.wav`。（证据：`src/journey/songFlow.e2e.test.ts`。）
- [x] 修复本机路径响度不足：导出归一化曾有 24 倍增益上限，稀疏本机编排只能达到约 -23.5 dB RMS；移除该不必要上限，仍以 -2.1 dB 峰值目标防止削波。修复后纯本地 WAV 为 62 秒、44.1 kHz、16-bit stereo PCM，整体 RMS 约 -19.5 dB，已由 `afinfo`、`ffmpeg astats` 与 macOS `afplay` 实际播放验证。（证据：`src/export/wav.ts`；2026-07-20。）
- [x] 防止再次生成静音假文件：播放和 WAV 导出共用可听性预检；工程没有可播放音符（例如空 Piano Roll 片段）或所有可播放轨道音量为 0 时，直接显示下一步操作，而不是输出无声 WAV。（证据：`src/audio/playbackPlan.ts`、`src/app/App.tsx`、`src/export/wav.test.ts`。）

---

## 2026-07-20 内置 Demo 与创作旅程状态隔离

- [x] 修复跨工程的创作旅程恢复：Journey 进度此前只保存在 localStorage，而工程可能在重启后恢复为内置 Demo；旧“成品长度”操作会错误地套用到另一工程，因此出现标题为 `C minor 8-bar demo`、实际却显示 5 小节的矛盾状态。现在 Journey 必须匹配其创建工程的 ID，否则自动回到安全的第一步，并清除待处理 AI 请求。（证据：`src/journey/progress.ts`、`src/app/App.tsx`、`progress.test.ts`。）
- [x] 为内置 C minor Demo 增加实时播放回归：编译 32 beat、三轨计划后，逐一执行 Tone Transport 的已排程回调，确认每一个计划事件均创建并启动真实采样 `AudioBufferSourceNode`；与已有 WAV 非静音回归共同覆盖试听和导出。（证据：`src/audio/audioEngine.test.ts`、`src/export/wav.test.ts`。）
