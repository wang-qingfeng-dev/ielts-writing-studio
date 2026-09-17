# Changelog

## 0.1.0 — 2026-09-17

First public release of IELTS Writing Studio (句进).

### Included
- Three-panel Task 2 workspace with linked source annotations and minimal corrections.
- Independent model-essay generation, four-criterion AI estimates and three practice priorities.
- Review cards, spaced repetition, browser-local exercise history and Markdown export.
- Ollama, OpenAI-compatible API and optional Codex CLI adapters.
- English/Chinese documentation, MIT licensing and Node 22/24 CI.

### Fixed for this release
- Compatible APIs now receive the full output schema in their instructions.
- Codex requires explicit selection instead of being an automatic fallback.
- Separate local/API model settings and a four-option provider selector.
- Friendly configuration errors, switch timeout recovery and analysis locking.
- Prompt-only drafts retained in history; keyboard state and narrow-screen controls improved.
- Windows startup and npm start load .env configuration; the launcher respects PORT.

### Limits
AI estimates are not official results. Local model quality and speed vary. The release is a single-user local app; it does not include hosted inference, Task 1 or cloud sync.
