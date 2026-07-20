# 历史 Node Gateway（仅协议回归）

此目录保留早期 Node 网关实验、OpenAI/Gemini 协议适配和自动化回归测试。它**不再是 AI Music IDE macOS 应用的运行时组件**。

当前桌面架构在应用内完成全部流程：

- Chat 页面在同一个 macOS 应用中选择 OpenAI 或 Gemini；
- 用户的 BYOK API Key 保存至 macOS Keychain；
- Tauri 原生 Rust 侧直接以 HTTPS 请求 OpenAI Responses API 或 Gemini Interactions API；
- 原生层和桌面操作层分别校验候选，用户接受后才写入工程。

因此，使用或测试桌面应用时，**不要**启动本目录服务、设置 `VITE_GATEWAY_URL`、创建临时网关账户，或把 Key 写入 `gateway/.env.local`。完整的用户流程见 [AI 接入契约](../docs/ai-contract.md)。

## 保留范围

- `gateway/src/`：历史协议实现与 Node 侧测试基线。
- `gateway/.env.local.example`：仅供维护历史实验时的开发者参考；不是桌面配置路径。
- `GATEWAY_MODEL_PROVIDER=local-demo`：只用于历史接口回归测试，不从桌面 UI 暴露。

新功能不得依赖此服务。产品未来若承担 API 计费、额度和账户体系，应由 Tauri 原生 `AiProvider` 透明调用产品服务，而不是恢复用户手工启动本地网关的流程。
