# AI 音乐 IDE（MVP）

像 IDE 一样编辑音乐：结构化工程文档为唯一真相，AI 对文档做结构化编辑，Chat / 编排视图 / Piano Roll 共享同一份文档。

![React](https://img.shields.io/badge/React-18+-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-Latest-purple?logo=vite) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript) ![Tone.js](https://img.shields.io/badge/Tone.js-Latest-yellow?logo=javascript) ![License MIT](https://img.shields.io/badge/License-MIT-green)

语言: [English](README.md) | **中文**

MVP 范围：**器乐、PC 键鼠、本地化、单人**。（人声 / 硬件 / 移动端 / 协作 / 云端本期不做）

## 文档
- [产品文档](docs/01-product.md) — 范围、用户、场景、成功标准
- [技术方案](docs/02-technical.md) — 架构、Schema、操作层、Agent、栈选型
- [全周期工作项](docs/03-worklog.md) — M0→M5 里程碑清单
- [Hackathon 介绍](docs/04-pitch.md) — 灵感、挑战、成就

## 一句话架构
文档（JSON，真相） + 操作层（原语 + 语义宏） + Agent（Claude tool calling）。
自己造的只有这三样，其余全部复用（Tone.js / soundfont / 后期符号模型）。
