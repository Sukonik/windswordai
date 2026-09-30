# Credential handoff: GitHub Repository Secrets ($0, browser only)

For the PR03C alpha, the Google Client Secret goes into GitHub's own encrypted secret store. No terminal, `.env`, Render, Supabase, SQL or database.

## Nathan's steps
1. GitHub → **windswordai** → **Settings** → **Secrets and variables** → **Actions** → **New repository secret**
2. Name: `WINDSWORD_GOOGLE_CLIENT_SECRET` · Secret: paste the Client Secret · **Add secret**
3. (Optional) **Variables** tab → `WINDSWORD_GOOGLE_CLIENT_ID` (public). If omitted, the project's public client id in `scripts/check-google-credentials.mjs` is used.
4. Actions → **Google credential check** → **Run workflow**. (The workflow must be on `main`, so merge first.) Then say "secret added".

## Canonical secret names (same pattern for every one)
`WINDSWORD_GOOGLE_CLIENT_SECRET` · `OPENAI_API_KEY` · `ANTHROPIC_API_KEY` · `GEMINI_API_KEY` · `GOOGLE_DRIVE_CLIENT_SECRET` · `DROPBOX_CLIENT_SECRET`

Paste a secret once in GitHub; workflows see whether it exists, use it only where authorized, and never print or return it. **Actions → Credential status → Run workflow** lists each name as `configured ✓ / missing ✗`, plus `PASS / FAIL` where a check exists (today: Google). Client IDs are not secret: use the Variables tab or the defaults in code.

To add a credential later: add one line to `scripts/credential-status.mjs` and the same name to `.github/workflows/credential-status.yml` (a test fails if they drift).

## What the code does with it
- GitHub never shows a secret again after saving, and code can't read it back; workflows receive it only while they run, and GitHub masks it in logs.
- `.github/workflows/google-credential-check.yml` is manual-only (`workflow_dispatch`), read-only, never runs for pull requests, and passes the secret only as an environment variable to `scripts/check-google-credentials.mjs`.
- That script prints only `configured ✓ / missing ✗` and `PASS / FAIL` with a fixed plain-words reason. It asks Google's token endpoint with a deliberately fake code: `invalid_grant` means Google accepted the Client ID + Secret pair.
- Never `echo`, print, upload as an artifact or return the secret from any workflow.

## Limits (honest)
A repository secret is only available to GitHub Actions while a workflow runs. It cannot feed a live web server, so real Google sign-in in a running app still needs somewhere that holds the secret at runtime. Hosting is undecided; for local use the existing Settings → Connections screen still works (secret saved encrypted on that computer). A branded "KeyDrop" page on a tiny free serverless endpoint is a possible later step.
