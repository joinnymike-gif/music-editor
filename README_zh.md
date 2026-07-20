# AI 音乐 IDE（MVP）

像 IDE 一样编辑音乐：结构化工程文档为唯一真相，AI 对文档做结构化编辑，Chat / 编排视图 / Piano Roll 共享同一份文档。

![React](https://img.shields.io/badge/React-18+-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-Latest-purple?logo=vite) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript) ![Tone.js](https://img.shields.io/badge/Tone.js-Latest-yellow?logo=javascript) ![License MIT](https://img.shields.io/badge/License-MIT-green)

语言: [English](README.md) | **中文**

MVP 范围：**器乐、PC 键鼠、本地化、单人**。（人声 / 硬件 / 移动端 / 协作 / 云端本期不做）

## 文档

- [产品文档](docs/01-product.md) — 范围、用户、场景、成功标准
- [技术方案](docs/02-technical.md) — 架构、Schema、操作层、Agent、栈选型
- [Schema 规格](docs/schema.md) — 版本化工程文档与校验规则
- [操作契约](docs/operations.md) — 原语 API、批处理、校验与撤销语义
- [AI 接入契约](docs/ai-contract.md) — OpenAI/Gemini 服务商选择、隐私与失败处理
- [电脑键盘输入](docs/keyboard-input.md) — QWERT 音阶映射、试听与录制契约
- [教程系统](docs/tutorial-system.md) — 强制新手引导与页面上下文教程契约
- [输出与生命周期](docs/output-and-lifecycle.md) — 工程创建、时间线、恢复、AI 草稿及 WAV/MIDI 导出
- [乐器注册表](docs/instrument-registry.md) — 版本化音源资产、MIDI 映射与渲染能力
- [M0 定义](docs/m0-definition.md) — 首个可运行纵向切片及验收流程
- [全周期工作项](docs/03-worklog.md) — M0→M5 里程碑清单
- [Hackathon 介绍](docs/04-pitch.md) — 灵感、挑战、成就

## 一句话架构

文档（JSON，真相） + 操作层（原语 + 语义宏） + macOS 原生 AI 运行时（OpenAI/Gemini Provider Adapter）。
React 界面包含在 Tauri 应用内；AI 配置、Keychain 保存、服务商请求与候选校验都在一个 macOS 应用中完成。

## Codex 与 ChatGPT 在本项目中的角色

本仓库的产品与代码所有权始终归人类项目负责人所有。Codex 与 ChatGPT 是协作型 AI，不替代产品决策、用户的音乐判断，也不绕过应用内明确的确认流程。

### Codex：工程协作者

开发阶段使用 Codex，将产品与技术规格转化为可审查的工程工作。其职责包括：

- 阅读现有规格与代码树，检查音乐创作闭环中的缺口，并提出边界清晰的实现计划。
- 在既定契约下实现或重构前端、Tauri/Rust、音频、导出、输入、教程与 AI 接入相关代码。
- 运行本地构建、单元测试、集成检查、导出校验和针对性的回归排查；记录已验证内容与尚未解决的事项。
- 维护架构说明、测试用例、工作日志和可复现的问题报告等开发者文档。
- 协助准备教程脚本与录制材料；除非项目负责人明确要求，不将生成媒体或本地测试产物纳入源代码版本控制。

Codex **不**拥有默认权限去发布内容、产生付费、使用个人 API Key、上传本地音频，或代替用户接受 AI 音乐候选。此类动作必须由用户明确授权，并经过应用自身的确认界面。

### ChatGPT：产品与创作协作助手

ChatGPT 可用于产品探索与创作方向的对话协作：把自然语言目标整理为可执行流程、建议提示词表达、解释新手概念，以及协助编写教程或文档。它不是工程数据的唯一真相，也不是桌面客户端运行时的必需组件。

当用户在 **AI Chat** 中选择 **OpenAI** 服务商时，应用仅会依据 [AI 接入契约](docs/ai-contract.md) 发送经过校验、范围受限的生成请求。返回结果会保持为独立候选，直到用户点击 **接受并写入工程** 才会改变工程。ChatGPT 不会自动获得用户工程文件、音频参考或凭据的访问权。

### 运行时、隐私与人工控制边界

- macOS 客户端允许在 OpenAI 与 Gemini 间选择服务商。凭据由用户提供，保存在本机 macOS 钥匙串，绝不提交到本仓库。
- 音频参考只在本地读取。客户端发送的是用户确认的文字摘要，而不是原始音频、文件路径或完整工程文档。
- AI 输出是候选，不是自动修改。在候选展示前会经过本地 Schema 与操作校验；只有用户接受后才会写入工程。
- 源代码、契约与测试是可审计的行为记录。所有 AI 辅助产出仍需接受正常的代码审查、测试与版本控制流程。

## 开发环境（当前处于 M-1）

前置条件：Node.js **25.8.0**（`.node-version` 固定；支持范围 `>=24.14.0 <26`）、pnpm **11.9.0**、Rust **1.94.0**，以及 Tauri 所要求的 macOS 桌面构建环境。前端固定为 React **19.2.7**、Vite **7.3.6**、TypeScript **5.9.3**、Tauri **2.11.4**、Tone.js **15.1.22**（精确解析版本见 `pnpm-lock.yaml` 与 `src-tauri/Cargo.lock`）。实录乐器的试听与 WAV 导出只使用通过校验的随包 WAV 采样；`合成主音` 是唯一明确标注的电子合成乐器。任何本应使用实录、却没有通过校验的乐器都会在界面中禁用，绝不静默回退为电子音。详见[第三方声明](THIRD_PARTY_NOTICES.md)。

```sh
pnpm install
pnpm dev             # 仅开发时为 WebView 提供静态资源
pnpm test            # 教程与领域单元测试
pnpm lint            # ESLint 静态检查
pnpm format:check    # Prettier 格式检查
pnpm typecheck       # TypeScript 严格检查
pnpm build           # 前端生产构建
pnpm check           # format + lint + typecheck + test + build 质量门
pnpm tauri dev       # 启动一站式 macOS 桌面开发应用
pnpm tauri build --debug
```

### macOS 一键启动

在 Finder 中双击 [AI Music IDE Launcher.app](<scripts/AI Music IDE Launcher.app>)，会先出现原生 macOS 启动窗口；点击 **Launch AI Music IDE** 即可启动完整桌面项目。启动器会打开 Terminal、检查 Node.js 与 Rust 环境、仅在首次运行时安装 lockfile 固定的 JavaScript 依赖，然后打开一站式 Tauri 桌面应用。使用开发版期间请保持该 Terminal 窗口打开；在其中按 <kbd>Control</kbd>+<kbd>C</kbd> 可以停止应用。

启动器源码见 [AI Music IDE Launcher.applescript](<scripts/AI Music IDE Launcher.applescript>)；[start-mac.command](scripts/start-mac.command) 仍可作为直接在终端启动的备用入口。

如果 macOS 因“来自互联网”而阻止打开，请在 Finder 中按住 Control 点击该文件，并选择一次 **打开**。等价的终端命令为：

```sh
./scripts/start-mac.command
```

如只想检查环境而不启动应用，可运行 `./scripts/start-mac.command --dry-run`。

验证桌面 AI 时，在 macOS 应用内打开 **AI Chat**，选择 OpenAI 或 Gemini，并把个人 API Key 保存到 macOS 钥匙串。不要启动历史 `gateway/` 服务或设置 `VITE_GATEWAY_URL`；原生应用会直接请求所选服务商。详见 [AI 接入契约](docs/ai-contract.md)。
