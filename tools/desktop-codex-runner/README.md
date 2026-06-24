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

## Codex execution mode

The runner calls:

```powershell
npx.cmd -y @openai/codex@0.142.0 exec --json --ephemeral --ignore-user-config --ignore-rules --disable plugins --disable apps --disable browser_use --disable browser_use_external --disable computer_use --disable image_generation --sandbox read-only --skip-git-repo-check --cd <empty temp dir> -
```

That keeps the run local, non-interactive, read-only, and tool-light. The prompt
is passed via stdin instead of shell arguments.

Whichever Codex account is logged in on this machine pays for / consumes the
Codex usage. If the machine uses API-key auth, usage belongs to that API plan.
