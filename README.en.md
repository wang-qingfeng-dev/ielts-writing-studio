# IELTS Writing Studio · 句进

[简体中文](README.md) · [Download v0.1.1](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/tag/v0.1.1) · [Changelog](CHANGELOG.md)

This working copy is a **local v0.1.2 candidate, not a published release**. Public download links still point to v0.1.1. The online AI settings and reliability changes described below require the candidate build and are awaiting user acceptance before publication.

A local IELTS Writing Task 2 practice app that turns essay feedback into reusable learning cards. Compare your draft, a minimally corrected version, and an independently generated model essay, then practise the language you want to retain.

The learning interface and feedback explanations are in Simplified Chinese; essays and practice sentences are in English. **AI band estimates are learning feedback, not official IELTS results or a promise of improvement.** This project is not affiliated with IELTS.

![Desktop workspace using the labelled built-in teaching example](docs/images/studio-desktop.jpg)

## The learning workflow

| Your original | Minimal correction | Independent model |
| --- | --- | --- |
| Write or paste an essay and inspect highlighted issues | Fix grammar, spelling and collocations while retaining the argument | Explore another argument generated from the question and target band only |
| Review evidence for TR, CC, LR and GRA estimates | See why grammar fixes may leave reasoning weaknesses | Inspect useful expressions and reasoning moves |

Click a highlight to see the source, revision, explanation and a short exercise. The app prioritizes three actions per essay, offers spaced review at 1/3/7/14/30 days, stores up to 30 exercises in the browser, and exports Markdown study notes. A labelled built-in example works without a model.

## Run locally

### Windows one-click installer (recommended)

The public download remains the [Jujin v0.1.1 Windows x64 installer](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.1/ielts-writing-studio-v0.1.1-windows-x64-setup.exe). It includes Node.js and a Chinese setup wizard and needs no administrator permission. That published package does not yet contain the v0.1.2 online settings or reliability fixes.

The v0.1.2 candidate first-run page offers a choice between online and local AI. It does not start a model download automatically. Clicking **一键准备本地 AI** explicitly starts Ollama download and verification, then prepares the recommended `qwen3.5:4b` model (approximately 3.4 GB). The Ollama runtime needs additional download and storage space; the setup page reports total requirements. Progress, retry and cancellation are available.

Automatic local preparation requires at least 12 GiB of detected system memory; 16 GB RAM and a discrete GPU are recommended. Below the threshold, the app recommends online AI rather than automatically installing a weaker 3B model. CPU-only analysis may take minutes or time out. Models are stored on the user's computer, not bundled in the installer. Users who prefer no model download can choose online AI below. A model connection check does not establish IELTS scoring accuracy.

Existing installations can restore their previously installed model without a forced download. Only clicking **更新推荐本地模型** starts preparation of the new recommended model; old model files are retained. After setup, the desktop shortcut starts the app without a terminal.

### Windows portable download

Download [ielts-writing-studio-v0.1.1-windows-x64.zip](https://github.com/wang-qingfeng-dev/ielts-writing-studio/releases/download/v0.1.1/ielts-writing-studio-v0.1.1-windows-x64.zip), extract the entire archive, then double-click `Start Portable.cmd`. The Windows x64 package includes Node.js, so no separate Node installation is needed. **AI models are not bundled:** the labelled example is available immediately; real analysis requires the first-run local AI setup or another provider configured below.

### Run from source (Windows, macOS or Linux)

Install [Node.js 24 LTS](https://nodejs.org/) (minimum 22.9). Download and extract the release source ZIP, or clone:

```sh
git clone https://github.com/wang-qingfeng-dev/ielts-writing-studio.git
cd ielts-writing-studio
npm start
```

No `npm install` is needed: the server uses Node built-ins and the UI uses native browser modules. Open [http://127.0.0.1:4318](http://127.0.0.1:4318). The example is usable immediately; real analysis needs one of the providers below. On Windows, `Start Writing Studio.cmd` starts the server in the background and opens the page.

If npm is unavailable, use `node --env-file-if-exists=.env server.mjs`.

### Local model with Ollama

Install and start [Ollama](https://ollama.com/), then download a model:

```sh
ollama pull qwen3.5:4b
```

Select **Ollama 本地** in the page header. Local inference needs no API key or hosted API subscription, but uses your computer's memory and compute. The suggested model is a starting configuration, not a validated IELTS assessor; feedback quality, speed and schema reliability vary.

To change models or configure an API, copy `.env.example` to `.env` (Windows: `Copy-Item .env.example .env`; macOS/Linux: `cp .env.example .env`), edit it and restart the server. Both `npm start` and the Windows launcher load this file. Existing shell variables take precedence.

### Online AI without model downloads (v0.1.2 candidate)

1. Click **设置在线 AI** and choose a provider.
2. Follow the provider link, create an API key with your own account, and paste it into the settings. Supply a model name available to your account when required.
3. Confirm that analysis will send writing to that provider and use your account quota, then click **连接并使用**. A short synthetic request, containing no essay, must succeed before the new configuration is saved and selected.
4. Start analysis in the writing workspace. Use **管理在线 AI** to change or remove the saved connection later.

Presets include DeepSeek, SiliconFlow, OpenRouter and a custom compatible endpoint. DeepSeek is billed by usage. SiliconFlow model availability and any free quota depend on its current console. OpenRouter's free-model route requires your own key and has rate, quota, availability and quality limits. No shared credentials or unlimited free inference are supplied.

Online analysis does not run a model on your computer, but requires internet access and usable provider quota. The connection test checks a basic response format, not full-essay reliability. Custom remote endpoints require HTTPS; explicit loopback endpoints (`localhost`, `127.0.0.1`, `::1`) may use HTTP and omit a key when the local service permits it.

### Advanced environment configuration or optional Codex CLI

For an OpenAI-compatible Chat Completions service, configure:

```dotenv
AI_PROVIDER=openai-compatible
AI_BASE_URL=https://your-provider.example/v1
OPENAI_MODEL=your-provider-model-name
AI_API_KEY=your-server-side-key
```

Replace these placeholders with your provider's values. Existing environment-configured compatible services remain selectable without repeating the web setup. Saved web settings take precedence for the compatible endpoint, model and key. A locally hosted compatible service may not require a key. Support depends on the provider's API and model; this project does not certify every compatible service. Costs and quotas are controlled by the provider.

The optional **Codex CLI** choice uses your own installed, authenticated CLI and account quota. It is never selected as an automatic fallback. No author's credentials or subscription are included.

| Setting | Purpose |
| --- | --- |
| `AI_PROVIDER` | `ollama`, `openai-compatible`, `codex`, or `auto` |
| `OLLAMA_HOST` | Defaults to `http://127.0.0.1:11434` |
| `OLLAMA_MODEL` | Defaults to `qwen3.5:4b`; existing managed installations may retain their saved model until explicitly updated |
| `AI_BASE_URL`, `OPENAI_MODEL`, `AI_API_KEY` | Compatible service configuration; key stays server-side |
| `AI_MODEL` | Legacy fallback if a provider-specific model is unset |
| `IELTS_CODEX_PATH` | Optional path to the installed Codex executable |
| `PORT` | Local port; default `4318` |

**Auto** prefers a responding Ollama service, then an explicitly configured API; otherwise it reports Ollama unavailable. An installed Ollama model is still required. When web settings are saved, header provider changes are also persisted and restored at startup. Without saved web settings, selection lasts for the current server process and startup follows the environment configuration. Analysis, connection tests and local preparation prevent conflicting provider operations.

## Privacy and scope

- The server listens on `127.0.0.1` only and rejects cross-site requests. It is a single-user local app, not a hardened multi-user hosting service.
- Drafts, exercise history and review cards stay in that browser's local storage; they are not encrypted or synchronized. Export important work before clearing browser data or changing origin/port.
- Submitted writing goes to the selected provider. With the default loopback Ollama configuration, inference stays local. An external API, remote Ollama host or Codex service receives the relevant content under its own terms.
- Correction and model-essay generation use separate requests; independent model generation never receives the student's draft. Core essay text and all four scoring dimensions must pass integrity checks. Non-core highlights with unverifiable quotes are omitted with a visible notice, while malformed core results trigger a bounded retry or error. Failures never silently substitute demo feedback and retain the draft and previous completed analysis.
- Web settings are stored in the current user's application configuration directory, including `%LOCALAPPDATA%\JujinWritingStudio\settings\cloud-ai.json` on Windows. This file is not encrypted; keep it private and avoid saving a personal key on a shared computer. Saved keys are not returned to the page or stored in browser exercise history. Removing the saved connection deletes that configuration without changing exercises; `.env` credentials must be removed from `.env` separately.
- Keys, local logs and live test results are ignored by Git. Never put credentials in `public/`.
- The app covers Task 2 only. It does not include Task 1, cloud sync, accounts, a project-hosted inference service, or validated prediction of official bands. GitHub Releases distributes code and installers; it does not host the Node backend.

See [Security](SECURITY.md), [third-party boundaries](THIRD_PARTY_NOTICES.md) and [v0.1.1 verification](docs/release-verification-v0.1.1.md).

## Development

```sh
node --test tests/*.test.mjs
```

The v0.1.1 release passed 63 automated tests; that is a historical release result, not a validation claim for v0.1.2. The local v0.1.2 candidate is awaiting user acceptance and has not undergone a GitHub release workflow. The suite covers request boundaries, annotation validation, independent model context, provider selection, local AI setup lifecycle, mocked HTTP integrations, cancellation, rendering safety and draft/review state. CI is configured for Node 22 and 24. Mocked tests and connection probes do not establish IELTS scoring accuracy.

An optional live check submits the included test essay to a running configured service and may use account quota:

```sh
node tests/live-check.mjs
```

| Path | Responsibility |
| --- | --- |
| `public/` | UI, draft storage, annotations, study cards and demo data |
| `server.mjs` | Local HTTP API, independent analysis jobs and process isolation |
| `provider.mjs` | Ollama, compatible API and optional CLI adapters |
| `http-json.mjs` | Bounded HTTP requests with cancellation and whole-request deadlines |
| `analysis-schema.mjs` | JSON schemas, band boundaries and source validation |
| `analysis-normalization.mjs` | Conservative output normalization and omission of unsupported annotations |
| `local-model.mjs` | Independent model-essay generation for local models |
| `cloud-settings.mjs` | Validated local provider settings; public responses exclude credentials |
| `tests/` | Automated regression tests and optional live check |
| `CONTRACT.md` | API and UI structure |

## License and references

[MIT](LICENSE), copyright WANG QINGFENG. Model weights, provider services and external IELTS materials retain their own terms; see [Third-party notices](THIRD_PARTY_NOTICES.md).

Scoring dimensions refer to the [official IELTS explanation](https://ielts.org/take-a-test/your-results/ielts-scoring-in-detail). This app's generated scores are not examiner assessments.
