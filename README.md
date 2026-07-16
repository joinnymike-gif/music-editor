# AI Music IDE (MVP)

Edit music like an IDE: a structured project document as the single source of truth, AI editing the document structurally, with Chat / Arrangement View / Piano Roll sharing the exact same document.

![React](https://img.shields.io/badge/React-18+-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-Latest-purple?logo=vite) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript) ![Tone.js](https://img.shields.io/badge/Tone.js-Latest-yellow?logo=javascript) ![License MIT](https://img.shields.io/badge/License-MIT-green)

Language: **English** | [中文](README_zh.md)

MVP Scope: **Instrumental, PC Keyboard/Mouse, Local, Single-Player**. (Vocals / Hardware / Mobile / Collaboration / Cloud are excluded in this phase)

## Documentation
- [Product Documentation](docs/01-product.md) — Scope, users, scenarios, success criteria
- [Technical Solution](docs/02-technical.md) — Architecture, Schema, Operation Layer, Agent, Tech stack
- [Full-lifecycle Worklog](docs/03-worklog.md) — M0→M5 milestones list
- [Hackathon Pitch](docs/04-pitch.md) — Inspiration, challenges, accomplishments

## One-sentence Architecture
Document (JSON, truth) + Operation Layer (Primitives + Semantic Macros) + Agent (Claude tool calling).
We only build these three; everything else is reused (Tone.js / soundfont / backend symbolic models).
