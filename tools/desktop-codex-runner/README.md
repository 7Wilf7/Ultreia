# Aevum Desktop Codex Runner

Local-only worker for the `desktop_codex` AI provider POC. It currently serves
Ultreia AI Coach jobs and can also serve Sidera jobs after the shared `ai_jobs`
schema has been upgraded with `product` and `target_runner_id`.

It polls `public.ai_jobs`, claims one queued job compatible with this runner,
calls the local Codex CLI with the current machine's normal Codex provider/auth
configuration, then writes the result back to Supabase. It does **not** open a
public port.

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

For a company Mac mini, prefer a stable runner id and explicit reasoning effort.
Sidera's first implementation targets this runner id explicitly:

```bash
export SUPABASE_URL="https://ihibmkfgfznqwzavaeiq.supabase.co"
export SUPABASE_SERVICE_ROLE_KEY="<keep local only>"
export RUNNER_ID="company-mac-mini-codex"
export POLL_MS="2000"
export RUNNING_HEARTBEAT_MS="5000"
export LEASE_SECONDS="180"
export CODEX_TIMEOUT_MS="180000"
export CODEX_PACKAGE="@openai/codex@0.142.0"
export CODEX_MODEL="gpt-5.5"
export CODEX_REASONING_EFFORT="xhigh"
npm run start
```

Use `CODEX_REASONING_EFFORT=xhigh` only when slower, deeper answers are worth
the extra latency and quota usage.

The company Mac mini may use a third-party API-key Codex provider configured in
the local Codex config. Do not switch accounts, and do not bypass the user config.

For convenience on the company Mac mini, a local double-click launcher can live
on the Desktop as `Start Ultreia Codex Runner.command`. It should only export the
non-secret runner settings above, read the Supabase `service_role` key from the
machine's logged-in Supabase CLI session at runtime, and then run `npm run start`
from this folder. Do not write the service role key into the Desktop launcher.
Keep the Terminal window open while the runner should stay online; closing it
stops the runner.

If you want to hand this to Codex on the company Mac, run `git pull` first and
then ask Codex:

> In the current Ultreia project, start the desktop Codex runner. Read
> `AGENTS.md` and `tools/desktop-codex-runner/README.md` first. Use this
> machine's existing Codex config/auth exactly as-is; do not switch accounts,
> do not force an official OpenAI login, and do not add `--ignore-user-config`.
> Install `tools/desktop-codex-runner` dependencies; use the Supabase CLI to read
> the `service_role` key for project `ihibmkfgfznqwzavaeiq` without printing the
> key; set `SUPABASE_URL=https://ihibmkfgfznqwzavaeiq.supabase.co`,
> `RUNNER_ID=company-mac-mini-codex`, `POLL_MS=2000`,
> `RUNNING_HEARTBEAT_MS=5000`, `LEASE_SECONDS=180`,
> `CODEX_TIMEOUT_MS=180000`, `CODEX_PACKAGE=@openai/codex@0.142.0`,
> `CODEX_MODEL=gpt-5.5`, and `CODEX_REASONING_EFFORT=xhigh`; then run `npm run start` from
> `tools/desktop-codex-runner`. Keep the runner running and do not commit any
> `.env`, secret, or temporary Supabase files.

## Codex execution mode

On Windows, the runner calls Codex through `cmd.exe /c npx.cmd ...` for Node
spawn compatibility. On macOS/Linux, it calls `npx ...` directly. The effective
Codex invocation is:

```bash
npx -y @openai/codex@0.142.0 exec --json --ephemeral --ignore-rules --disable plugins --disable apps --disable browser_use --disable browser_use_external --disable computer_use --disable image_generation --sandbox read-only --skip-git-repo-check --cd <empty temp dir> [--model gpt-5.5] [-c model_reasoning_effort=\"xhigh\"] [--image <temp image>] -
```

That keeps the run local, non-interactive, read-only, and tool-light while still
loading the machine's normal Codex provider/auth configuration. The prompt is
passed via stdin instead of shell arguments.

For AI Coach image messages, the Edge Function queues compressed image data in
`ai_jobs.payload.attachments` only long enough for the runner to claim the job.
The runner writes each attachment into the empty temp directory and passes it to
Codex with `--image`. After claim / completion / failure / timeout, the stored
job payload is redacted down to image name + media type metadata. DeepSeek is
not used as fallback for image messages because it cannot inspect the image.

Do not add `--ignore-user-config`; the company Mac may require custom provider
settings such as `base_url` in the local Codex config.

The desktop Codex runner writes back one completed assistant reply after
`codex exec` finishes. It does not currently stream partial tokens into AI Coach
when Codex is selected; if Codex is unavailable or too slow, the Edge Function
falls back to DeepSeek for text-only jobs.

Whichever Codex account is logged in on this machine pays for / consumes the
Codex usage. If the machine uses API-key auth, usage belongs to that API plan.

## Multiple runners

Multiple desktop runners can be online at the same time. They do not process the
same job twice: Supabase claims jobs with a lease and row lock, so the first
runner that successfully claims a queued job owns it.

Untargeted jobs can still be claimed by any compatible online runner. Jobs with
`target_runner_id = company-mac-mini-codex` are only claimed by that runner after
the upgraded `claim_ai_job` SQL is installed. Use targeted jobs for Sidera so the
company Codex account is predictable even if another runner is online.
