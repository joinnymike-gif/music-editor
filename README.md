# AI Music IDE (MVP)

Edit music like an IDE: a structured project document as the single source of truth, AI editing the document structurally, with Chat / Arrangement View / Piano Roll sharing the exact same document.

![React](https://img.shields.io/badge/React-18+-blue?logo=react) ![Vite](https://img.shields.io/badge/Vite-Latest-purple?logo=vite) ![TypeScript](https://img.shields.io/badge/TypeScript-5.0+-blue?logo=typescript) ![Tone.js](https://img.shields.io/badge/Tone.js-Latest-yellow?logo=javascript) ![License MIT](https://img.shields.io/badge/License-MIT-green)

Language: **English** | [中文](README_zh.md)

MVP Scope: **Instrumental, PC Keyboard/Mouse, Local, Single-Player**. (Vocals / Hardware / Mobile / Collaboration / Cloud are excluded in this phase)

## Documentation

- [Product Documentation](docs/01-product.md) — Scope, users, scenarios, success criteria
- [Technical Solution](docs/02-technical.md) — Architecture, Schema, Operation Layer, Agent, Tech stack
- [Schema Specification](docs/schema.md) — Versioned project document and validation rules
- [Operation Contract](docs/operations.md) — Primitive API, batches, validation, and undo semantics
- [AI Connection Contract](docs/ai-contract.md) — OpenAI/Gemini selection, privacy, and failure handling
- [Computer Keyboard Input](docs/keyboard-input.md) — QWERT scale mapping, auditioning, and recording contract
- [Tutorial System](docs/tutorial-system.md) — Mandatory onboarding and page-contextual tutorial contract
- [Output & Lifecycle](docs/output-and-lifecycle.md) — Project creation, timeline, recovery, AI proposals, and WAV/MIDI export
- [Instrument Registry](docs/instrument-registry.md) — Versioned audio assets, MIDI mappings, and render capabilities
- [M0 Definition](docs/m0-definition.md) — First runnable vertical slice and acceptance procedure
- [Full-lifecycle Worklog](docs/03-worklog.md) — M0→M5 milestones list
- [Hackathon Pitch](docs/04-pitch.md) — Inspiration, challenges, accomplishments

## One-sentence Architecture

Document (JSON, truth) + Operation Layer (Primitives + Semantic Macros) + native macOS AI runtime (OpenAI/Gemini provider adapter).
The React view is contained in the Tauri app; AI configuration, Keychain storage, provider requests, and proposal validation stay inside one macOS application.

## Development (M-1 is in progress)

Prerequisites: Node.js **25.8.0** (pinned in `.node-version`; supported range `>=24.14.0 <26`), pnpm **11.9.0**, Rust **1.94.0**, and the macOS desktop build prerequisites required by Tauri. The frontend stack is React **19.2.7**, Vite **7.3.6**, TypeScript **5.9.3**, Tauri **2.11.4**, and Tone.js **15.1.22** (exact resolutions are locked in `pnpm-lock.yaml` and `src-tauri/Cargo.lock`). Recorded instruments use verified, bundled WAV layers for auditioning and WAV export. `square_lead` is the sole deliberately synthesised instrument and is labelled as such; an instrument that is supposed to be recorded is never silently replaced with an electronic voice. See [third-party notices](THIRD_PARTY_NOTICES.md).

```sh
pnpm install
pnpm dev             # WebView asset server for development only
pnpm test            # tutorial and domain unit tests
pnpm lint            # ESLint static analysis
pnpm format:check    # Prettier format check
pnpm typecheck       # TypeScript strict check
pnpm build           # production frontend build
pnpm check           # format + lint + typecheck + test + build quality gate
pnpm tauri dev       # start the one-stop macOS development app
pnpm tauri build --debug
```

For desktop AI validation, open **AI Chat** inside the macOS application, choose OpenAI or Gemini, and save a personal API key to macOS Keychain. Do not start the legacy `gateway/` service or set `VITE_GATEWAY_URL`; the native app talks to the selected provider directly. See the [AI Connection Contract](docs/ai-contract.md).
