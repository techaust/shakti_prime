# Setting up a new PC

How to make a new Windows PC the owner's development machine for Shakti Prime BOS, and bring back what the previous PC held outside the repository. A cloud session needs none of this ([hybrid](../../docs/runbooks/hybrid.md)).

Ask Claude to do it: open the project in the Claude desktop app and say "set this PC up from tools/pc-setup". The desktop app is a packaged Windows app: what a session installs under `AppData\Roaming` (npm globals, uv's data) stays in the app's own copy of that folder, so the owner installs the few tools needed in their own shell (step 2) in a PowerShell window opened from the Start menu. The steps:

1. Install with `winget` (Claude can run these; Windows asks for administrator approval where needed): Git, Node 24, the GitHub CLI, the AWS command line (version 2), `uv` and Docker Desktop. Install WSL from an administrator shell with `wsl --install --no-distribution`, then restart Windows; in Docker Desktop's settings, tick "Start Docker Desktop when you sign in". Install the latest Python 3 with "Add to PATH" (only the latest version is kept); set the Windows user variable `PYYAML_FORCE_LIBYAML=0` so the AWS MCP server builds on a Python newer than PyYAML's Windows packages.
2. In the owner's own PowerShell: Claude Code with `irm https://claude.ai/install.ps1 | iex`, and pnpm with `npm.cmd install -g pnpm --allow-scripts=pnpm` (in the project, `pnpm.cmd --version` prints the pinned version). Windows PowerShell runs no `.ps1` until the owner allows it with `Set-ExecutionPolicy -Scope CurrentUser RemoteSigned`; without it, call the `.cmd` forms.
3. Sign in: `gh auth login` as `techaust`; the Claude desktop app on the Team organisation (the client checklist page is published there, [client packs](../../docs/13-client-packs/readme.md)).
4. Clone `techaust/shakti_prime` with `git clone` (a ZIP download has no `.git`), today at `D:\Business\3. Client Projects\Shakti Prime\Application\shakti_prime`. Claude names its memory folder after the checkout's path, each `\`, `:`, space and `.` becoming `-`.
5. Bring back Claude's files from this folder:

   | From                                          | To                                                                                                                                   |
   | --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
   | `claude-memory/*.txt`                         | `%USERPROFILE%\.claude\projects\D--Business-3--Client-Projects-Shakti-Prime-Application-shakti-prime\memory\`, each renamed to `.md` |
   | `claude-settings/user-settings.json`          | `%USERPROFILE%\.claude\settings.json`                                                                                                |
   | `claude-settings/user-mcp-servers.json`       | the user-scope MCP servers, added with `claude mcp add --scope user`                                                                 |
   | `claude-settings/project-settings.local.json` | `.claude\settings.local.json` in the project                                                                                         |

   Then switch off the aws-core, Supabase and Upstash plugins' own servers for this project ([tooling](../../docs/runbooks/tooling.md#connection-notes)).

6. In the project: copy `.env.example` to `.env`, then run `pnpm install`, `docker compose up -d --wait`, `pnpm db:migrate`, `pnpm db:seed` and `pnpm --filter web exec playwright install chromium`. The local database is rebuilt this way and was never saved. Your local sign-in comes from `pnpm --filter web invite-executive -- --email <you> --name <name>` ([README](../../README.md#commands)).
7. Set again what no file holds:
   - The Windows user variable `GITHUB_PERSONAL_ACCESS_TOKEN`: a new fine-grained token limited to `shakti_prime`, for the GitHub plugin.
   - A new access key for the read-only IAM user `claude-shakti` (AWS › IAM › Users › claude-shakti › Security credentials), saved with `tools/secrets/set-aws-login.ps1`; then delete the old PC's key there.
   - The plugin and MCP sign-ins in [tooling](../../docs/runbooks/tooling.md).
8. Download Supabase's CA certificate to `%USERPROFILE%\Downloads\prod-ca-2021.crt` before running a script in `tools/secrets/` that uses it.
9. Say "start the day".

## What this folder holds

- `claude-memory/`: Claude's memory for the project as the PC held it on 04-11-2026, one note per file and the `MEMORY` index. The repository's documents are the record; the notes add the owner's working preferences and some history. Notes that name `D:/shakti-wt/*.ps1` mean the scripts now in `tools/secrets/`.
- `claude-settings/`: the Claude Code settings (enabled plugins, the user-scope MCP servers' addresses, the project's allowed commands and the plugins, skills and connectors switched off for it). No password, key or token is in any of them.

The owner's helper scripts for secrets are in `tools/secrets/`. Each prompts with hidden typing, checks the value and prints only a RESULT line; its first lines say how to run it.
