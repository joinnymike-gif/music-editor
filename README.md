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

## The role of Codex and ChatGPT in this project

This repository is a human-owned product and codebase. Codex and ChatGPT are used as AI collaborators; they do not replace the product owner, the user's musical judgment, or the application's explicit approval flows.

### Codex: engineering collaborator

Codex is used during development to help turn the product and technical specifications into reviewable implementation work. Its responsibilities include:

- Reading the existing specifications and source tree, identifying gaps in the end-to-end music workflow, and proposing scoped implementation plans.
- Implementing and refactoring frontend, Tauri/Rust, audio, export, input, tutorial, and AI-integration code under the repository's documented contracts.
- Running local builds, unit tests, integration checks, export validation, and targeted regression investigations; documenting what was verified and what remains unresolved.
- Producing and maintaining developer-facing artifacts such as architecture notes, test cases, work logs, and reproducible issue reports.
- Helping prepare user-facing materials, including tutorial scripts and recordings, while keeping generated media and local test artifacts out of source control unless deliberately requested.

Codex does **not** receive standing authority to publish, spend money, use a personal API key, upload local audio, or accept an AI music proposal on a user's behalf. Those actions remain subject to the user's request and the application's own confirmation UI.

### ChatGPT: product and creative copilot

ChatGPT can be used as a conversational partner for product exploration and creative direction: turning a user's natural-language goal into an actionable workflow, suggesting prompt wording, explaining beginner concepts, and helping draft tutorials or documentation. It is not the source of truth for project data and is not a mandatory runtime component of the desktop client.

When a user selects the **OpenAI** provider inside **AI Chat**, the application sends only the validated, scoped generation request defined in the [AI Connection Contract](docs/ai-contract.md). The resulting candidate is kept separate from the project until the user explicitly chooses **Accept and write to project**. ChatGPT itself does not automatically gain access to the user's project files, audio references, or credentials.

### Runtime, privacy, and human control

- The macOS application supports provider selection between OpenAI and Gemini. Credentials are supplied by the user and stored locally in macOS Keychain; they are never committed to this repository.
- Local audio references remain local. The client sends a confirmed text summary rather than the original audio, file path, or entire project document.
- AI output is a proposal, not an automatic mutation. Local schema and operation validation run before the proposal can be presented, and user acceptance is required before it changes the project.
- The source, contracts, and tests remain the auditable record of behavior. Any AI-assisted development output is subject to ordinary code review, testing, and version control.

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

### One-click macOS launch

For the local development application, double-click [AI Music IDE Launcher.app](<scripts/AI Music IDE Launcher.app>) in Finder. It opens a native macOS launch window; click **Launch AI Music IDE** to start the complete desktop project. The launcher opens Terminal, checks the required Node.js and Rust toolchains, installs the lockfile-pinned JavaScript dependencies on the first run, and opens the one-stop Tauri desktop app. Keep that Terminal window open while using the development build; press <kbd>Control</kbd>+<kbd>C</kbd> there to stop it.

The launcher's source is [AI Music IDE Launcher.applescript](<scripts/AI Music IDE Launcher.applescript>). [start-mac.command](scripts/start-mac.command) remains the direct terminal fallback.

If macOS blocks the file because it was downloaded from the internet, Control-click it in Finder and choose **Open** once. The equivalent terminal command is:

```sh
./scripts/start-mac.command
```

For a non-launching environment check, run `./scripts/start-mac.command --dry-run`.

For desktop AI validation, open **AI Chat** inside the macOS application, choose OpenAI or Gemini, and save a personal API key to macOS Keychain. Do not start the legacy `gateway/` service or set `VITE_GATEWAY_URL`; the native app talks to the selected provider directly. See the [AI Connection Contract](docs/ai-contract.md).
