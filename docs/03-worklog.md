# 全周期工作项 — AI 音乐 IDE（MVP）

里程碑串行，每个 M 结束都能"跑起来 / 听得到"。勾选框追踪进度。

---

## M0 — 可播放的文档骨架
目标：硬编码一份工程 JSON，能听到多轨器乐。

- [ ] `doc/` Schema 类型定义（meta / sections / tracks / clips / automation）
- [ ] Schema 运行时校验（拒绝非法文档）
- [ ] Zustand store 装文档
- [ ] `audio/` Tone.js 引擎：Transport + 按 beat 调度音符
- [ ] soundfont 加载（先 3 个乐器：kit / bass / lead）
- [ ] 播放 / 停止 / 循环
- [ ] 硬编码一段 8 小节 JSON 作为 demo
- [ ] **验收**：点播放能听到一段器乐

## M1 — 原语操作层 + 撤销
目标：确定性编辑跑通，可撤销。

- [ ] `ops/` 原语：transpose / setTempo / setKey / setVelocity / quantize / humanize / halfTime / doubleTime
- [ ] 原语：addTrack / removeTrack / setInstrument
- [ ] 原语：addSection / removeSection / extendSection / reorderSections
- [ ] 混音原语：setVolume / mute / solo → 映射到 gain
- [ ] 每个用户回合前整份文档快照
- [ ] 撤销 / 重做
- [ ] 每个非平凡原语一个 assert 自检
- [ ] **验收**：改速 / 转调 / 改力度生效且可撤销

## M2 — Agent 循环 + 生成
目标：一句话出完整器乐。

- [ ] `agent/` Claude tool 定义（每个原语一个 tool）
- [ ] 文档序列化进上下文
- [ ] `generateClip(track, section, hints)` 原语：Claude 生成 MIDI 音符数组
- [ ] 生成编排：定 tempo/key → 段落结构 → 和弦进行 → 逐轨逐段填充
- [ ] 鼓 / bass 模板库兜底（AI 主要生成旋律 / 和声）
- [ ] 默认和弦进行库
- [ ] Chat 面板（输入 + 操作历史 + 回滚按钮）
- [ ] **验收**："生成一段 lo-fi hiphop" 出完整可循环器乐

## M3 — 语义宏 + 作用域
目标：自然语言逐步修改 + 段落 / 轨道级重写。

- [ ] `ops/` 语义宏展开器（宏 → 原语序列，可预览）
- [ ] setEnergy（更燃 / 更安静）
- [ ] 加长 / 缩短段落（extendSection + 逐轨 generateClip）
- [ ] 换鼓组 / 换乐器
- [ ] 重写某段 / 某轨（scope=section / track）
- [ ] Arrangement 视图：段落 × 轨道网格，点选设 scope
- [ ] 语义宏小评测集（"更燃"能量指标前后可量化）
- [ ] **验收**："副歌更燃""只重写 bass""副歌再长一点" 稳定生效

## M4 — Piano Roll + Automation
目标：专业手动编辑，AI 仍懂全局。

- [ ] Piano Roll canvas：画 / 移动 / 增删音符 → 发原语操作
- [ ] 音符编辑：拖动、改时值、改力度
- [ ] Automation 视图：画 / 编辑曲线点
- [ ] 手动编辑后重渲染正确
- [ ] 验证 AI 后续指令基于改后文档
- [ ] **验收**：手改音符 / 曲线后播放正确，AI 上下文同步

## M5 — 本地化收尾
目标：完全本地可用。

- [ ] 工程存 / 读 `.json`（Tauri fs 或 IndexedDB）
- [ ] 新建 / 打开 / 另存工程
- [ ] 导出音频（离线渲染 wav）
- [ ] 导出 MIDI
- [ ] 基础错误处理（生成失败可重试、损坏文档提示）
- [ ] **验收**：断网下完成打开→编辑→保存→导出全流程（生成步骤除外）

---

## 横切工作项（跨里程碑，持续）
- [ ] 键鼠交互：快捷键（播放 / 撤销 / 删除 / 缩放）
- [ ] 长曲上下文成本控制（超长时只传 scope 邻域）
- [ ] soundfont 音质打磨（至少覆盖若干曲风的默认音色）
- [ ] 生成结果人评 + 语义宏回归用例积累

## 明确延后（本期不做）
人声 / 歌词、真实录音、MIDI 硬件、移动端、多人协作、云端存储、专业混音母带。
底座设计保证以上均为"加视图 / 加后端"，不触及核心。
