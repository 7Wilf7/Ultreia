# Ultreia Desktop Codex Runner

Local-only worker for the `desktop_codex` AI provider POC.

It polls `public.ai_jobs`, claims one queued job, calls the local Codex CLI with
the current machine's Codex / ChatGPT login, then writes the result back to
Supabase. It does **not** open a public port.

## Setup

1. Run `docs-internal/supabase-ai-jobs.sql` in Supabase SQL Editor.
2. Copy `.env.example` to `.env` in this folder.
3. Fill `SUPABASE_URL` and `SUPABASE_SERVICE_ROLE_KEY`.
   - Keep `.env` local only. Do not commit it.
4. Install and run:

```powershell
cd tools\desktop-codex-runner
npm.cmd install
npm.cmd run start
```

On macOS, use:

```bash
cd tools/desktop-codex-runner
npm install --no-package-lock
npm run start
```

For a company Mac mini, prefer a stable runner id and explicit reasoning effort:

```bash
export SUPABASE_URL="https://ihibmkfgfznqwzavaeiq.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<keep local only>"
export RUNNER_ID="company-mac-mini-codex"
export POLL_MS="3000"
export LEASE_SECONDS="180"
export CODEX_TIMEOUT_MS="180000"
export CODEX_PACKAGE="@openai/codex@0.142.0"
export CODEX_REASONING_EFFORT="xhigh"
npm run start
```

Use `CODEX_REASONING_EFFORT=xhigh` only when slower, deeper answers are worth
the extra latency and quota usage.

If you want to hand this to Codex on the company Mac, run `git pull` first and
then ask Codex:

> In the current Ultreia project, start the desktop Codex runner. Read
> `AGENTS.md` and `tools/desktop-codex-runner/README.md` first. Use this
> machine's already logged-in Codex account, not an OpenAI API key. Check
> `npx -y @openai/codex@0.142.0 login status`; install
> `tools/desktop-codex-runner` dependencies; use the Supabase CLI to read the
> `service_role` key for project `ihibmkfgfznqwzavaeiq` without printing the
> key; set `SUPABASE_URL=https://ihibmkfgfznqwzavaeiq.supabase.co`,
> `RUNNER_ID=company-mac-mini-codex`, `POLL_MS=3000`, `LEASE_SECONDS=180`,
> `CODEX_TIMEOUT_MS=180000`, `CODEX_PACKAGE=@openai/codex@0.142.0`, and
> `CODEX_REASONING_EFFORT=xhigh`; then run `npm run start` from
> `tools/desktop-codex-runner`. Keep the runner running and do not commit any
> `.env`, secret, or temporary Supabase files.

## Codex execution mode

On Windows, the runner calls Codex through `cmd.exe /c npx.cmd ...` for Node
spawn compatibility. On macOS/Linux, it calls `npx ...` directly. The effective
Codex invocation is:

```bash
npx -y @openai/codex@0.142.0 exec --json --ephemeral --ignore-user-config --ignore-rules --disable plugins --disable apps --disable browser_use --disable browser_use_external --disable computer_use --disable image_generation --sandbox read-only --skip-git-repo-check --cd <empty temp dir> [-c model_reasoning_effort=\"high\"] -
```

That keeps the run local, non-interactive, read-only, and tool-light. The prompt
is passed via stdin instead of shell arguments.

The desktop Codex runner writes back one completed assistant reply after
`codex exec` finishes. It does not currently stream partial tokens into AI
Coach; if Codex is unavailable or too slow, the Edge Function falls back to
DeepSeek.

Whichever Codex account is logged in on this machine pays for / consumes the
Codex usage. If the machine uses API-key auth, usage belongs to that API plan.

## Multiple runners

Multiple desktop runners can be online at the same time. They do not process the
same job twice: Supabase claims jobs with a lease and row lock, so the first
runner that successfully claims a queued job owns it.

The current POC does not target a specific runner. If both a home PC runner and
a company Mac runner are online, whichever one polls and claims first will run
that AI Coach job. To make usage predictable, keep only the runner you want
active. For company-account usage, stop the home runner before starting the
company Mac runner.
