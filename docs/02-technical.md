# 技术方案 — AI 音乐 IDE（MVP）

## 核心架构：文档 + 操作 + Agent（与代码 IDE 同构）

| 代码 IDE | 本产品 |
|---|---|
| 源文件 / AST | 工程文档（JSON，唯一真相）|
| LSP / 编辑操作 | 操作层（原语 + 语义宏）|
| 编辑器视图 | Piano Roll / Automation |
| Copilot / Agent | AI 编排器（Claude tool calling）|
| git diff / undo | 每次编辑 = 文档快照 + 可逆操作 |

**自己造的只有三样，也是唯一护城河**：工程 Schema、操作层、Agent 编排。
播放引擎、音源、（后期）符号生成模型全部复用。

## 技术栈

| 层 | 选型 | 理由 |
|---|---|---|
| 壳 | React + Vite；本地 app 用 Tauri | Tauri 比 Electron 轻，本地文件读写现成 |
| 状态 | Zustand 单 store 装整份文档 | 文档即真相，无需更重方案 |
| 音频/播放 | Web Audio + Tone.js | transport / 调度 / 量化现成 |
| 音源 | soundfont 采样（midi-js-soundfonts 等） | 器乐 MVP 不碰神经合成 |
| 持久化 | `.json`（Tauri fs）或 IndexedDB | 文档本就是 JSON，直接落盘 |
| AI | Claude，tool calling = 操作层 | 编排 + MVP 音符生成共用一个模型 |

## 工程文档 Schema

```jsonc
{
  "meta": { "tempo": 120, "key": "C", "mode": "minor", "timeSig": [4,4] },
  "sections": [
    { "id": "s1", "name": "intro",  "bars": 4 },
    { "id": "s2", "name": "verse",  "bars": 8 },
    { "id": "s3", "name": "chorus", "bars": 8 }
  ],
  "tracks": [
    { "id": "t1", "role": "drums", "instrument": "acoustic_kit", "vol": 0.8, "mute": false },
    { "id": "t2", "role": "bass",  "instrument": "finger_bass",  "vol": 0.8 },
    { "id": "t3", "role": "lead",  "instrument": "square_lead",  "vol": 0.7 }
  ],
  "clips": [
    { "track": "t2", "section": "s2",
      "notes": [ { "pitch": 36, "start": 0, "dur": 1, "vel": 100 } ] }
  ],
  "automation": [
    { "track": "t3", "param": "filterCutoff",
      "points": [ { "bar": 0, "val": 0.2 }, { "bar": 8, "val": 0.9 } ] }
  ]
}
```

设计约束：
- `start` / `dur` 单位为 **beat**，与 tempo 解耦 → 改速不用重算音符。
- clip 以 `(track, section)` 索引 → 段落 / 轨道级作用域天然成立。
- 整份文档可序列化进 LLM 上下文 = "AI 理解整个工程"的实现方式。

## 操作层（两级，严格不混）

### A. 原语操作 `doc → doc`（多数确定性、无模型）
```
结构:  addSection / removeSection / extendSection(bars) / reorderSections
轨道:  addTrack(role,instrument) / removeTrack / setInstrument
变换:  transpose / quantize / setVelocity / setTempo / setKey / halfTime / doubleTime / humanize
混音:  setVolume / mute / solo
生成:  generateClip(track, section, hints)   ← 唯一依赖模型的原语
```

### B. 语义宏（LLM 规划成一串原语，绝不直改文档）
```
"更燃一点"    → setEnergy(chorus,+0.3)
              = 加 crash + 抬 drums velocity + 加 lead 八度层 + filter 上扬 (+可选 doubleTime)
"副歌再长一点" → extendSection(chorus,+8) + 逐轨 generateClip(新增小节)
"这段太吵"    → 降层 / 减 velocity / mute 某轨
```

**撤销**：每个用户回合前对整份文档快照（JSON 很小）。
`// ponytail: 整份快照做 undo；工程超大再换 per-op 逆操作`

## AI Agent 循环
```
用户 NL
  → 序列化整份文档进上下文
  → Claude 规划：选原语 / 展开语义宏 → 一串 tool call
  → 逐个 apply（先存快照）
  → 重渲染受影响段落 → 播放
```
三类用户共用此循环，唯一差异是 **scope**（whole / section / track）。

## 音符生成策略（MVP 取舍）
MVP 直接用 **Claude 生成 MIDI 音符数组**，按段/按轨调用，把工程其余部分当 condition。
一句话生成拆解：`定 tempo/key → 定段落结构 → 定和弦进行 → 逐轨逐段 generateClip`。

`// ponytail: 音符生成先用 Claude；musicality 不够时把专用符号模型接到 generateClip 后面，操作层签名不变`

节奏稳定性有限 → 鼓 / bass 先用**模板库**兜底，AI 主要生成旋律 / 和声。

## 播放 / 渲染
- Tone.js `Transport` 驱动，音符按 beat 调度。
- 每轨一个 soundfont 采样器实例；`vol` / `mute` / `solo` 映射到 gain。
- automation 曲线映射到对应参数（如 filter cutoff）的 `setValueAtTime` 序列。
- 编辑后只重排受影响段落，不整体重建。

## UI 三个面（都只是文档的视图）
1. **Chat 面板** — NL 输入 + 操作历史（每条可回滚）。
2. **Arrangement 视图** — 段落 × 轨道网格，点选=设 scope。
3. **Piano Roll + Automation** — canvas 画音符 / 曲线，编辑=发原语操作。

## 天花板与风险
- 音质取决于音源 + 和声库，不只音符 → M2 需备像样 soundfont + 默认和弦库。
- 语义宏需配小评测集（"更燃"能量指标可量化），否则不可控。
- 长曲 token 成本高 → `// ponytail: 先全量传上下文，超长再只传 scope 邻域`。
- Claude 生成 MIDI 节奏稳定性有限 → 鼓 / bass 模板兜底。

## 模块划分（代码目录建议）
```
src/
  doc/         Schema 类型 + 校验
  ops/         原语操作（纯函数）+ 语义宏展开
  agent/       Claude tool 定义 + 循环
  audio/       Tone.js 引擎 + soundfont 加载
  ui/          chat / arrangement / pianoroll
  store/       Zustand + 快照撤销
  persist/     json 读写
```
