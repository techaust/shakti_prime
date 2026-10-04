# Claude Code tooling: connections and sign-in

How each plugin and MCP server that `.claude/tooling.json` requires is connected on the developer's machine, and how to bring one back when it drops. The rules (never install without the go-ahead, credentials never in the repository, the check at session start) are in [CLAUDE.md](../../CLAUDE.md#claude-code-tooling). Checked with a live call on 28-09-2026, with the later re-authorisations noted against each tool.

## Tools by phase
| Tool | Kind | Phase | Sign-in |
|---|---|---|---|
| supabase | plugin | 0 | Supabase sign-in; also registered at user scope |
| context7 | plugin | 0 | Optional `CONTEXT7_API_KEY` for higher rate limits |
| frontend-design | plugin | 0 | None |
| security-guidance | plugin | 0 | None |
| upstash | plugin | 0 | Upstash account; also registered at user scope, read-only by the owner's choice |
| github | plugin | 0 | A fine-grained personal access token, limited to this repository, in the Windows user variable `GITHUB_PERSONAL_ACCESS_TOKEN` |
| vercel | MCP (`.mcp.json`) | 0 | Vercel sign-in on first use |
| shadcn | MCP (`.mcp.json`) | 0 | None |
| vercel-agent-skills | skills (`.claude/skills`) | 0 | None |
| playwright | plugin | 1 | None |
| sentry | plugin | 1 | Sentry sign-in (organisation `shakti-supreme`) |
| aws-core | plugin | 1 | The read-only IAM user `claude-shakti` |
| expo | plugin | 4 | Expo account |

The ten directory plugins are enabled on the owner's claude.ai account. The SessionStart hook cannot see account plugins, so it always lists them as "to confirm"; confirm them with the plugin listing tool.

## Connection notes
- **GitHub:** the plugin has no browser sign-in and sends the token from `GITHUB_PERSONAL_ACCESS_TOKEN`; an unset variable shows as HTTP 400. When the repository moves to the client's organisation, a new token is needed. `gh` is signed in as `techaust`. Sentry and Expo are signed in.
- **AWS:** runs through `uvx` with the credentials `aws configure` saved in `%USERPROFILE%\.aws` for `claude-shakti` (region `ap-south-1`, read-only). For the file storage bucket, add a permission for that one bucket rather than widening the user; the files stack does this ([files-setup](files-setup.md)).
- **Supabase, Upstash and Vercel** hold the dev and staging environments (29-09-2026). The Vercel server was authorised again for the `shakti-prime` team on 29-09-2026 and reads its projects, variables and deployments.
- **Context7** was signed in again on 03-10-2026; a session started before a sign-in cannot see it until it is reopened.
- **shadcn** and the second AWS entry can time out at start and come back on the next start.
- A server that shows "Connection closed" is missing its stdio command: check the plugin's `.mcp.json` under `~/.claude/plugins/synced/`.

## Signing a server in again
The desktop chat cannot run an OAuth sign-in. The owner authorises a server from the CLI (`claude`, then `/mcp`, then Authenticate) or on claude.ai, and the session is reopened afterwards.
