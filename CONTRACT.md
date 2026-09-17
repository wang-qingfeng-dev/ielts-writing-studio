# Shared implementation contract

Zero-dependency Node HTTP server and native ES modules in public/. Chinese learning UI. Server listens only on 127.0.0.1:4318 (PORT override). AI provider is selected by AI_PROVIDER=auto|ollama|openai-compatible|codex. Auto prefers an available Ollama service, then a configured AI_BASE_URL, otherwise reports Ollama unavailable. Codex requires explicit selection. Provider switching applies to the current server process. OLLAMA_MODEL and OPENAI_MODEL configure each provider independently; AI_MODEL remains a legacy fallback.

GET /api/status => { available: boolean, engine: string, message: string }
POST /api/analyze body { prompt: string, essay: string, targetBand: number } => Analysis below. Non-2xx JSON {error:string}. Real analysis only; never silently return demo. POST cancellation should stop work if practical; server single request limit. Client timeout 10 min.

Analysis shape:
```
{
 originalScore: Score,
 corrected: {text:string, score:Score},
 model: {text:string, score:Score, notes:[{quote:string,label:string,explanation:string}]},
 issues: [{id:string,category:'grammar'|'vocabulary'|'logic'|'spelling',original:string,replacement:string,explanation:string,priority:'essential'|'optional',practice:{question:string,answer:string}}],
 expressions: [{id:string,text:string,meaning:string,example:string,source:'corrected'|'model',usage:string}],
 priorities:[{title:string,description:string}]
}
Score = {low:number,high:number,criteria:[{key:'TR'|'CC'|'LR'|'GRA',band:number,evidence:string,action:string}]}
```
All quote/original snippets must be exact substrings of corresponding text. Issues refer to submitted essay. All Chinese explanations, English essays, examples and practice. Max 12 issues, 8 expressions, exactly 3 priorities. Scores 0-9 half bands, ranges low <= high, all 4 unique criteria. Aim for 270-330 word model. Corrected retains original argument and structure. Model generation must receive ONLY task prompt and target band, not original essay: separate request/job. Model score independently evaluate and conservative.

Demo module public/demo.js exports DEMO_PROMPT (string), DEMO_ESSAY (string), DEMO_ANALYSIS (Analysis). It is transparently labelled sample, never used as evaluation fallback.

Frontend shell class structure:
.app-header > .header-inner > .brand (.brand-mark,.brand-name,.brand-tag) + .header-actions (.connection,.btn)
.page > .hero (.eyebrow,h1,.hero-copy,.hero-side)
.prompt-card > .section-kicker + .prompt-textarea + .prompt-footer (.task-badge,.target-control,.prompt-hint)
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
