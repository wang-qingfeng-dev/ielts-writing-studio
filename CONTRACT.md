# Shared implementation contract

This document describes the local v0.1.2 candidate; it is not a publication or release-validation claim. Public downloads remain v0.1.1 until user acceptance and release.

Zero-dependency Node HTTP server and native ES modules in public/. Chinese learning UI. Server listens only on 127.0.0.1:4318 (PORT override). AI provider is selected by AI_PROVIDER=auto|ollama|openai-compatible|codex or the saved runtime selection. Auto prefers an available Ollama service, then a configured compatible API, otherwise reports Ollama unavailable. Codex requires explicit selection. OLLAMA_MODEL and OPENAI_MODEL configure each provider independently; AI_MODEL remains a legacy fallback. Saved web settings supply the compatible endpoint/model/key and persist the selected provider. Without saved web settings, provider switching applies only to the current server process and startup follows the environment configuration.

HTTP API:

- `GET /api/status` or `GET /api/provider` => `{ available, provider, selected, engine, message }`. Availability indicates configuration/model connectivity, not IELTS scoring accuracy or a guarantee of full analysis success.
- `POST /api/provider` body `{provider:'auto'|'ollama'|'openai-compatible'|'codex'}` => current provider status. Selecting Ollama uses the managed local configuration when ready. Selection is persisted alongside saved web settings when present.
- `POST /api/analyze` body `{prompt:string, essay:string, targetBand:number}` => Analysis below. Non-2xx JSON `{error:string}`. Real analysis only; never silently return demo. Cancellation aborts provider work where possible. A single analysis/setup/provider mutation may run at a time; client and server analysis deadlines are 10 minutes.
- `GET /api/local-ai/status` => managed installation state with phase, busy, progress, model, memory and disk information. `POST /api/local-ai/start` and `POST /api/local-ai/cancel` accept `{}`. Opening `?setup=1` only presents the online/local choice; downloading requires the explicit local-prepare action.

The default model for new local installations is `qwen3.5:4b` (approximately 3.4 GB of model weights, plus Ollama runtime/storage overhead). Automatic setup requires at least 12 GiB detected system memory; 16 GB RAM and a discrete GPU are recommended. Below the threshold, offer online AI instead of silently selecting a weaker 3B model. CPU-only inference may take minutes or time out. Restoring a previous managed installation keeps its saved model and does not trigger an upgrade download. Status may expose `recommendedModel` and `updateAvailable`; only the explicit “更新推荐本地模型” action prepares the recommendation. Preserve old model files during this update. These requirements do not constitute a scoring-accuracy guarantee.

Online settings API:

- `GET /api/cloud-settings` => public settings `{provider, baseUrl, model, keyConfigured, providers, configured, tested, selectedProvider, environmentConfigured, message}`. `provider` identifies a preset (`deepseek`, `siliconflow`, `openrouter`, `custom`), distinct from runtime `openai-compatible`. `environmentConfigured` reports an existing compatible environment address plus model without exposing credentials.
- `POST /api/cloud-settings` accepts `{provider, baseUrl, model, apiKey?, remember?:boolean}`. Blank/omitted `apiKey` reuses an existing key only for the same normalized provider and endpoint. Explicit loopback custom endpoints may omit a key. A synthetic JSON probe must succeed before saving and switching to `openai-compatible`; failure leaves the previous settings in place. The probe never includes the student's draft. The UI saves with `remember:true`; API callers may explicitly request session-only configuration with `remember:false`.
- `DELETE /api/cloud-settings` accepts JSON `{}` and removes saved web settings. It does not delete browser exercises or `.env` credentials. If the selected override was `openai-compatible`, it returns to `auto`.
- Successful settings mutations return public settings plus `providerStatus`. All public responses exclude `apiKey`. Mutations require same-origin local JSON requests and are blocked during conflicting AI operations.

Settings are stored outside the repository in the current user's application configuration directory. Windows uses `%LOCALAPPDATA%\JujinWritingStudio\settings\cloud-ai.json`; macOS uses `~/Library/Application Support/JujinWritingStudio/settings`; Linux uses `$XDG_CONFIG_HOME/JujinWritingStudio/settings` or `~/.config/JujinWritingStudio/settings`. Files are not encrypted. The UI must explain provider transmission/quota before enabling online analysis and never save keys in browser exercise storage, logs or model prompts.

Analysis shape:
```
{
 originalScore: Score,
 corrected: {text:string, score:Score},
 model: {text:string, score:Score, notes:[{quote:string,label:string,explanation:string}]},
 issues: [{id:string,category:'grammar'|'vocabulary'|'logic'|'spelling',original:string,replacement:string,explanation:string,priority:'essential'|'optional',practice:{question:string,answer:string}}],
 expressions: [{id:string,text:string,meaning:string,example:string,source:'corrected'|'model',usage:string}],
 priorities:[{title:string,description:string}],
 warnings?:[{code:string,path:string,message:string}]
}
Score = {low:number,high:number,criteria:[{key:'TR'|'CC'|'LR'|'GRA',band:number,evidence:string,action:string}]}
```
All displayed quote/original snippets must be exact, unique substrings of corresponding text. Issues refer to the submitted essay. Chinese explanations; English essays, examples and practice. Max 12 issues, 8 expressions, exactly 3 priorities. Scores 0-9 half bands, ranges low <= high, all 4 unique criteria. Corrected text retains the original argument and structure. Model generation must receive ONLY task prompt and target band, not the original essay. The model's score independently assesses its actual text conservatively.

Normalization may perform lossless format repairs (numeric strings, recognized criterion names/order, annotation IDs, uniquely alignable whitespace/quote differences). It must not invent scores, missing criteria, evidence, writing or teaching content. Core text, scores, score explanations and priorities remain mandatory. Invalid auxiliary issues, expressions or notes may be omitted with warnings; every retained annotation must still pass the strict validator. Warnings contain paths and reasons, not essays, keys or raw model output. A visible non-error notice accompanies normalized results; the original draft and previously completed analysis remain available on failure/cancellation.

Ollama receives the schema through structured output and an explicit context/output budget. Local correction and independent model work run sequentially. The independent local model pipeline first generates and validates four distinct English paragraphs (250-600 words; prompt aims for 300-340), freezes that text, then requests its score and annotations. The scoring stage cannot rewrite the accepted essay. Each stage has a bounded retry for malformed or incomplete core output; cloud model generation remains independent of the student draft. No stage fills missing output with demo content or repeated paragraphs.

Demo module public/demo.js exports DEMO_PROMPT (string), DEMO_ESSAY (string), DEMO_ANALYSIS (Analysis). It is transparently labelled sample, never used as evaluation fallback.

Frontend shell class structure:
.app-header > .header-inner > .brand (.brand-mark,.brand-name,.brand-tag) + .header-actions (.connection,.btn)
.page > .hero (.eyebrow,h1,.hero-copy,.hero-side)
.prompt-card > .section-kicker + .prompt-textarea + .prompt-footer (.task-badge,.target-control,.prompt-hint)
.cloud-ai-card with #cloud-ai-open opens native dialog.cloud-ai-dialog > form#cloud-ai-form; labelled preset, key, model, endpoint and consent controls; progress/errors live region; cancel, connect and clear actions. Native modal focus handling is used. Cloud configuration never clears draft/analysis state.
.local-ai-setup displays managed preparation state; local/online setup actions are disabled during conflicting AI work; failed preparation requests must leave an enabled retry action.
.workspace-toolbar (.mode-info,.legend,.toolbar-actions)
.mobile-tabs > .mobile-tab
.workspace-grid > .essay-panel.original-panel|.corrected-panel|.model-panel
Each panel: .panel-heading (.panel-number,.panel-title,.panel-subtitle,.panel-tools), .panel-tabs > .panel-tab, .essay-body > .essay-textarea or .essay-prose, .panel-footer, .score-block (.score-heading,.score-value,.score-range,.score-note), .criteria-grid > .criterion > .criterion-top(.criterion-code,.criterion-name,.criterion-band) + .criterion-track > span; details.score-details > summary + .criterion-detail
.essay-prose paragraphs .annotation.grammar|.vocabulary|.logic|.spelling|.expression (buttons), .annotation.active; .model-lock for fold model
.empty-state, .loading-state, .spinner, .skeleton-line, .error-banner, .notice-banner
.priority-strip > .priority-intro + .priority-item (.priority-index,h3,p)
.review-section > .section-heading (.eyebrow,h2,.section-description,.section-actions), .review-grid > .review-column (.review-column-heading,.review-count) > .review-card (.card-tag,.card-title,.card-meaning,.card-example,.card-usage,.card-actions,.icon-btn,.mini-btn), .issue-pair(.wrong,.correct), .practice-box
.page-footer
.modal-backdrop > .modal(.modal-header,.modal-body,.modal-footer) with button.close-modal
.detail-popover / .issue-dialog uses .issue-pair,.detail-explanation,.practice-box,.practice-input,.practice-feedback
.history-item,.history-meta,.history-title,.history-actions,.empty-library,.library-card,.library-answer,.library-controls
.toast; .hidden display none, .sr-only; button[data-*] interaction root JS. .btn .btn-primary .btn-secondary .btn-ghost .btn-small .btn-danger .icon-btn. root uses svg icon inline with class icon, stroke currentColor.
Warm offwhite background, white cards, restrained forest green brand, amber highlights, Chinese modern sans UI plus Georgia English essay prose. Generous readable spacing, 1440px three column desktop; tablet 3 cols >=1000px; mobile tabs under 1000px. Sticky navbar, responsive dialogs, accessible focus/reduced motion.
