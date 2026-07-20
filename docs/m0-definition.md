# M0 定义：可播放的文档骨架

M0 的目标不是 AI 生成或完整 DAW，而是证明“有效文档是唯一真相，播放是它的派生结果”。此里程碑完成后才进入原语操作和 AI。

## 固定边界

- 桌面端先支持 macOS；其他桌面平台不作为 M0 验收条件。
- 一份内置、不可编辑的 8 小节 demo：4/4、120 BPM、C minor、drums/bass/lead 三轨。
- 支持播放、停止、循环、transport 位置显示和 QWERT 音阶试听；试听不写入工程。不做 AI、文件选择、Piano Roll、automation 编辑、音符录制、导出或音频录制。
- 音源只支持明确打包的首批 kit、bass、lead；加载失败必须可见且不会让应用崩溃。

## 开始编码前的准备项

1. 完成 [M-1 教程骨架](03-worklog.md)：全局“当前页面教程”按钮、离线内容、进度恢复及锚点降级全部验收通过；未完成时不得开始 M0 音频功能。
2. 锁定包管理器、Node、Rust、Tauri、React、TypeScript 与 Tone.js 的版本，并写入 README 的开发环境要求。M0 的首批音色采用随代码打包的程序化合成器，不分发第三方 SoundFont；任何后续采样库均须另行锁版本、哈希与可再分发许可证。
3. 建立 TypeScript 严格模式、运行时 Schema 校验、单元测试、lint/format/typecheck/build 的可重复命令。
4. 提供 `valid-project-v1` 和无效 Schema fixture；内置 demo 必须通过同一校验器，不能绕过它。
5. 选定音源许可证、打包体积预算和离线加载方式；许可证不兼容时替换资源后才允许开始音频实现。

## 验收脚本

1. 全新环境安装依赖并运行检查命令，所有 Schema/单元测试、typecheck 和 production build 通过。
2. 启动应用，看到内置 demo 的三轨与 8 小节长度；无效 fixture 被校验器拒绝并给出字段路径；点击“当前页面教程”可看到 demo、播放和 QWERT 试听的引导。
3. 单击播放后，三轨按相同 transport 起点循环；停止后不再有残留音符事件。
4. 在非文本焦点区域按 `Q W E R T`，依次听到 C minor 的 do/re/mi/fa/sol；窗口失焦后没有残留试听音符。
5. 连续执行播放、停止、再播放十次，不产生重复调度、未处理异常或明显的节拍漂移。
6. 断网后重启应用，内置 demo 仍可加载并播放。

M0 不满足以上任一项，不进入 M1；M1 也不得绕开 Schema/Operation 契约直接修改 demo 文档。
