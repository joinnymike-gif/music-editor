## Inspiration

Traditional Digital Audio Workstations (DAWs) rely heavily on manual, point-and-click operations, which can be daunting for beginners and repetitive for professionals. We were inspired by how software engineers use Integrated Development Environments (IDEs) with AI Copilots. We thought: what if we could edit music just like we edit code? The core idea was to treat a structured engineering document (JSON) as the Single Source of Truth, allowing an AI agent to perform structured edits to the music project just as a Copilot edits an Abstract Syntax Tree (AST).

## What it does

Our AI Music IDE (MVP) allows users to generate and edit instrumental music seamlessly.

- **For Beginners**: You can generate a complete instrumental track with a single prompt (e.g., "generate a lo-fi hip-hop track") and iteratively modify it using natural language ("make it more energetic", "make the chorus longer").
- **For Professionals**: It features an Arrangement View, Piano Roll, and computer-keyboard performance input for manual, granular edits (like playing `QWERT…` as the current scale, dragging notes, or drawing automation curves).
  Crucially, there is no separation between "AI mode" and "Manual mode." The Chat interface, Arrangement View, and Piano Roll all share and modify the exact same underlying structured document.

## How we built it

We designed an architecture strictly separated into three layers: Document, Operation Layer, and Agent.

- **Frontend & App Shell**: Built with React and Vite, wrapped in Tauri to create a lightweight, localized desktop application with native file system access.
- **State Management**: We use Zustand as a single store to hold the entire JSON project document.
- **Audio Engine**: Web Audio API powered by **Tone.js** handles transport, beat-based scheduling, and quantization.
- **Computer Keyboard Input**: Key-down/up events audition the selected melodic track; recorded performances are quantized and committed as reversible document operations.
- **Sound Generation**: We utilize traditional Soundfont sampling (e.g., midi-js-soundfonts) for instrumental playback without relying on heavy neural audio synthesis.
- **AI Agent**: Users may choose **OpenAI or Gemini** through a provider adapter. The AI doesn't modify the file blindly; it proposes strict primitives (e.g., `addTrack`, `transpose`) and semantic macros that are validated before safely editing the document.

## Challenges we ran into

- **Rhythmic Stability**: Pure LLMs can struggle with generating perfectly stable rhythmic MIDI arrays. We use template libraries for foundational tracks like drums and bass, leaving the AI to focus on melodies and harmonies.
- **Context Window Limits**: Passing a massive JSON document of a full song into an LLM context window quickly becomes expensive and slow. We had to design a scoping mechanism to serialize and pass only the relevant sections or tracks when the user makes localized edits.
- **Translating Subjective Prompts**: Turning a subjective prompt like "make it more energetic" into deterministic code is tough. We had to build robust "Semantic Macros" that translate these fuzzy intents into safe, reversible primitive sequences (e.g., adding a crash cymbal, raising drum velocity, and sweeping the filter cutoff).

## Accomplishments that we're proud of

- **The Single Source of Truth Architecture**: We successfully modeled a music project as a purely symbolic JSON document. This allows every edit—whether from the AI or the user—to act as a reversible commit (like a git version control for music).
- **Seamless AI Integration**: We're incredibly proud that our AI understands the _entire_ global context of the song. If a user manually changes a note in the Piano Roll, the AI is immediately aware of it for the next chat prompt.
- **Local-First Design**: The ability to save the `.json` project locally and run edits without relying on massive cloud audio rendering makes the app incredibly fast and responsive.

## What we learned

- **Separation of Concerns is Key**: By treating audio simply as a "compiled output" and prioritizing symbolic JSON as the truth, we realized how much easier it is to apply AI to music.
- **Scoping AI Operations**: We learned that confining AI edits to strict scopes (a specific track or an 8-bar section) drastically reduces hallucinations and improves the musicality of the output.

## What's next for Your music workhouse

Our immediate focus is completing our M0-M5 milestones to solidify the local MVP. Once the core symbolic engine and Piano Roll are perfected, we plan to expand the architecture:

- **Beyond Instrumentals**: Introducing vocal synthesis, lyrics alignment, and real audio track recording.
- **Pro Features**: Adding MIDI hardware input support and integrating professional mixing/mastering plugins.
- **Collaboration**: Eventually moving the JSON document to the cloud to allow for real-time, multiplayer music collaboration.
