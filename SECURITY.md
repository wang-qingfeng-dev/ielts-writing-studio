# Security and data handling

IELTS Writing Studio is intended for one person running it on their own computer. It binds to 127.0.0.1, checks request origins, limits submitted payloads, serves only public files and validates model output before rendering.

Keep API keys in environment variables, the ignored .env file, or the app's server-side online-AI settings. UI-saved settings are plaintext files in the current user's application-data directory, outside this repository; they are not returned to the browser or stored with essays. Do not save keys on shared computers. Configured keys are bound to their API base URL and are not forwarded to a different endpoint. Treat provider responses, sample essays and submitted writing as untrusted content. Do not add credentials, personal drafts or live-result.json to issues or commits.

Browser storage is local but unencrypted. Other people with access to the same browser profile may see it. External providers receive submitted content according to their own policies. The optional CLI mode invokes an installed CLI with tool restrictions; it is not a guarantee against vulnerabilities in the CLI or other installed software.

Do not expose this server directly to the internet. It has no user authentication, per-user storage, public-service rate limiting or deployment hardening.

Report reproducible bugs through GitHub Issues with synthetic input and redacted logs. Use private vulnerability reporting when available for security-sensitive details; never publish exploitable secrets in a public issue. This early release has no guaranteed support lifetime.
