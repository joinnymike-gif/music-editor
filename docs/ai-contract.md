# AI 接入契约：macOS 桌面端 OpenAI / Gemini

AI 是可选能力。用户在 **AI Music IDE for macOS** 的 Chat 页面选择 **OpenAI** 或 **Gemini**，配置服务商连接，生成一个可接受或拒绝的音乐候选；这一选择不会影响工程格式、手工编辑、播放、保存或导出。

## 一站式桌面边界

面向用户的产品只有一个 macOS 应用：Tauri 的 WebView 仅负责界面渲染；钥匙串、AI 配置、HTTPS 请求、候选校验和工程操作均由应用内的原生 Rust 侧执行。已打包应用不要求浏览器、Node 进程、本地 HTTP 端口、`VITE_GATEWAY_URL` 或临时网关账户。`pnpm tauri dev` 中的 Vite 服务仅是开发时给 WebView 提供静态资源的工具，不是用户工作流的一部分。

打包 WebView 的 CSP 只允许本地资源、Tauri IPC 和受控 asset 协议；它不直接连接 OpenAI、Gemini 或历史网关。开发版单独允许 Vite 的本地热更新连接。

当前开发验证采用本机 BYOK：用户在 Chat 页面输入自己的 OpenAI 或 Gemini API Key，一次性传给原生命令并保存到 macOS Keychain。Key 不得写入工程 JSON、Zustand、恢复副本、日志、剪贴板、崩溃报告或 `gateway/.env.local`，也不得返回给 WebView。原生侧首次成功读取所选 Key 后，只在该应用进程的内存中缓存 12 小时；后续生成不再重复访问 Keychain，退出应用或到期即清除缓存。原生侧再直接调用 OpenAI Responses API 或 Gemini Interactions API。

参考：[OpenAI API 身份验证](https://developers.openai.com/api/reference/overview#authentication)、[ChatGPT 与 API 计费分离](https://help.openai.com/en/articles/9039756-billing-settings-in-chatgpt-vs-platform)、[Gemini API Key](https://ai.google.dev/gemini-api/docs/api-key)、[Gemini Interactions API](https://ai.google.dev/api/interactions-api-v1)、[Gemini 结构化输出](https://ai.google.dev/gemini-api/docs/structured-output?lang=rest)。

## 当前桌面流程

1. 用户打开应用的 Chat 页面，选择 OpenAI 或 Gemini，并在同一页面保存或删除该服务商的 API Key。
2. 原生层仅返回 `configured: boolean`，绝不返回 Key、账户信息、上游完整响应或模型内部错误。
3. 用户选择 track × section、替换或叠加策略，并确认将发送的数据范围。
4. 原生层从 Keychain 读取所选 Key，向服务商发送提示词、选中 section/track 的音乐参数和最多 120 个当前 clip 音符；请求使用结构化 JSON 输出、`store: false`、输出上限和 30 秒超时。
5. 原生层先校验候选 `{ summary, notes }` 的数量、片段边界、MIDI 音高、力度和时值；前端再次将其转换为 `OperationBatch` 并在工程副本上模拟。用户接受后才写入工程，且可整体 Undo。

切换服务商、删除 Key、取消或失败均不修改工程。用户未配置所选服务商时，应用说明如何在当前页面完成配置，手工编辑与导出保持可用。

## 请求与候选边界

- `DesktopAiClient` 只能调用 `get_desktop_ai_status`、保存/删除 Key 和 `generate_desktop_ai_notes` 等 Tauri 原生命令；生成命令不含 API Key 参数。
- 原生 `AiProvider` 是唯一的上游 HTTPS 边界。它按用户所选服务商请求 OpenAI Responses API 或 Gemini Interactions API，绝不跨服务商回退，也不把 Key 写入错误消息。
- 输入只含用户提示、已选 `trackId`/`sectionId` 的 tempo/key/mode/role/长度和受限的当前 clip 音符；不发送完整工程、本地路径、未选轨道、恢复副本或凭据。
- 两家服务的 structured output 只是第一层约束。原生层与桌面操作层都要验证 `summary`、`notes`、section 边界、音高、力度、时值和数量；无效、拒绝或超时的上游输出一律不进入工程。
- 候选格式固定为：

```ts
{
  summary: string;
  notes: Array<{ start: number; dur: number; pitch: number; vel: number }>;
}
```

## 失败、隐私与计费

- 首次生成前展示所选服务商以及将发送的数据类别。聊天内容仅保留在当前界面内存；应用不持久化 prompt 或服务商响应。
- Keychain 不可访问、Key 缺失或无效、网络错误、超时、429、上游服务不可用、模型拒绝和候选无效时，应用展示可操作且不含秘密的错误。不会自动重试可能计费的请求；用户可手动重试或继续手工编辑。
- 直接 BYOK 请求由用户自己的服务商 API 项目计费。ChatGPT 订阅或 Codex 余额并不自动提供 OpenAI API 额度。
- 用户可随时在 Chat 页面删除某服务商 Key；删除只移除该 Mac Keychain 项目，不影响工程。

## 产品资费路径（后续）

若产品承担 API 计费、限额和账户体系，桌面应用仍保持“一站式”：同一个原生 `AiProvider` 改为通过 HTTPS 调用产品服务，而不要求用户配置 URL、运行网关、打开浏览器或维护多个端。产品服务才负责账户、计费、预算、KMS、服务商凭据、审计和滥用防护；桌面侧仅安全保存产品会话并显示状态。

该生产路径尚未实现，且不得将 BYOK 功能伪装成产品代付服务。若未来需要第三方授权，必须从桌面应用发起受审核的系统浏览器回调流程，并回到应用内完成状态更新；不得嵌入网页、读取用户密码、Cookie 或聊天产品会话。

## 迁移状态

`gateway/` 保留为历史 Node 网关实验和协议回归测试，不属于桌面应用运行时，也不得在用户教程、发布说明或 Chat 界面中要求启动。旧的 `.env.local` 仅可由开发者手工清理；桌面应用不会读取或迁移其中的秘密。

发布验收仍由 [技术追踪](02-technical.md#9-ai-provider原生运行时与-proposal可选发布路径) 的未完成产品网关、计费、限额、取消、预览与端到端项约束。
