# Review Artifacts

Every major WindSwordAI PR should be reviewable without requiring access to private legal data.

## UI-facing PRs

Prefer both:

1. A public/safe demo using synthetic fixtures.
2. A GitHub Actions artifact named `windsword-pr-XX-review`.

Beginning with PR 02, UI artifacts should include desktop, mobile, dark-mode, and light-mode screenshots when applicable.

## Security rule

Review artifacts must never contain real legal documents, prompts, credentials, matter data, raw audit exports, or private deployment configuration.
