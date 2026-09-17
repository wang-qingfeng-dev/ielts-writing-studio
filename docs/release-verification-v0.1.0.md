# v0.1.0 release verification

Date: September 17, 2026. Local environment: Windows, Node.js 24.19.0.

## Automated checks

`node --test tests/*.test.mjs` passed all 52 tests with no failures or skips.
The suite covers request validation, exact source citations, four scoring
criteria, HTML escaping, independent model context, provider selection,
mocked HTTP integration, cancellation, request locking, and draft/history
preservation. The HTTP Ollama test uses a local fixture service, not model
weights or real inference.

`node --check` passed for the server, provider and frontend application.
PowerShell parsing and `git diff --check` passed. The CI workflow runs the
same automated tests under Node 22 and 24.

## Windows startup

The PowerShell and CMD launchers were run from a test copy in a path containing
Chinese characters and spaces. Checks confirmed that the configured model was
read from `.env`, `PORT` in `.env` selected the endpoint, and an existing shell
`PORT` overrode the file. The local page returned HTTP 200. Test launchers ran
without opening a desktop browser.

## Browser checks

- Desktop three-panel rendering and labelled demo content inspected.
- 390 px and 320 px layouts had no horizontal document overflow.
- Mobile tabs changed with clicks and arrow keys; selected/tab-stop state agreed.
- Provider selection remained usable on narrow screens and missing API
  configuration produced an explicit message.
- Source annotations opened matching correction details and an exercise.
- A correct exercise answer was recognized, a review card was saved, and it
  remained after reload.
- No application error logs were observed during this browser check.

The README screenshot uses the built-in teaching example, not personal writing.

## Public source review

All three earlier reachable commits were scanned before publication. No realistic
API credentials, private keys, personal filesystem paths or real essay results
were found in their tracked contents. The current release additionally ignores
Windows shortcuts and local release artifacts. Git retains ordinary author
attribution; no history was rewritten.

## Model quality boundary

Automated correctness tests do not validate IELTS band accuracy. There is no
available local Ollama model in this environment, so real Ollama inference
quality and hardware performance are not claimed. Compatible API transports
were checked with controlled fixtures, not every hosted provider.

The older `tests/TEST-REPORT.md` describes the September 16 development checks;
it is preserved as a dated record, not evidence that all providers were tested
again in this release.
