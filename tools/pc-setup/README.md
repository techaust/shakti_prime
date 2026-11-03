# Setting up a new PC

How to make a new Windows PC the owner's development machine for Shakti Prime BOS, and bring back what the previous PC held outside the repository. A cloud session needs none of this ([hybrid](../../docs/runbooks/hybrid.md)).

Ask Claude to do it: open the project in the Claude desktop app and say "set this PC up from tools/pc-setup". The steps it follows:

1. Install Git, Node 24, Docker Desktop (with WSL), the GitHub CLI, the AWS command line (version 2) and `uv`; enable pnpm with `corepack enable`.
2. Sign in: `gh auth login` as `techaust`; the Claude desktop app on the Team organisation (the client checklist page is published there, [client packs](../../docs/13-client-packs/readme.md)).
3. Clone `techaust/shakti_prime` to `D:\BUSINESS\4. CLIENT PROJECTS\SHAKTI PRIME\SOFTWARE\shakti_prime`. Claude names its memory folder after this path, so keep it.
4. Bring back Claude's files from this folder:

   | From                                          | To                                                                                                                                |
   | --------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
   | `claude-memory/*.txt`                         | `%USERPROFILE%\.claude\projects\D--BUSINESS-4--CLIENT-PROJECTS-SHAKTI-PRIME-SOFTWARE-shakti-prime\memory\`, each renamed to `.md` |
   | `claude-settings/user-settings.json`          | `%USERPROFILE%\.claude\settings.json`                                                                                             |
   | `claude-settings/user-mcp-servers.json`       | the `mcpServers` key of `%USERPROFILE%\.claude.json`                                                                              |
   | `claude-settings/project-settings.local.json` | `.claude\settings.local.json` in the project                                                                                      |

5. In the project: copy `.env.example` to `.env`, then run `pnpm install`, `docker compose up -d --wait`, `pnpm db:migrate`, `pnpm db:seed` and `pnpm --filter web exec playwright install chromium`. The local database is rebuilt this way and was never saved. Your local sign-in comes from `pnpm --filter web invite-executive -- --email <you> --name <name>` ([README](../../README.md#commands)).
6. Set again what no file holds:
   - The Windows user variable `GITHUB_PERSONAL_ACCESS_TOKEN`: a new fine-grained token limited to `shakti_prime`, for the GitHub plugin.
   - `aws configure` with the read-only IAM user `claude-shakti`, region `ap-south-1`, for the AWS tools.
   - The plugin and MCP sign-ins in [tooling](../../docs/runbooks/tooling.md).
7. Download Supabase's CA certificate to `%USERPROFILE%\Downloads\prod-ca-2021.crt` before running a script in `tools/secrets/` that uses it.
8. Say "start the day".

## What this folder holds

- `claude-memory/`: Claude's memory for the project as the previous PC held it on 03-11-2026, one note per file and the `MEMORY` index. The repository's documents are the record; the notes add the owner's working preferences and some history. Notes that name `D:/shakti-wt/*.ps1` mean the scripts now in `tools/secrets/`.
- `claude-settings/`: the Claude Code settings (enabled plugins, the user-scope MCP servers' addresses, the project's allowed commands and switched-off skills). No password, key or token is in any of them.

The owner's helper scripts for secrets are in `tools/secrets/`. Each prompts with hidden typing, checks the value and prints only a RESULT line; its first lines say how to run it.
