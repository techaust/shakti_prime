# Claude Code tooling: connections and sign-in

How each plugin and MCP server that `.claude/tooling.json` requires is connected on the owner's PC, and how to bring one back when it drops. The rules (never install without the go-ahead, credentials never in the repository, the check at session start) are in [CLAUDE.md](../../CLAUDE.md#claude-code-tooling). Last reviewed 07-10-2026; a sign-in that has lapsed shows as a failed connection at the start of a session.

## On the PC only
Every plugin and MCP server below is signed in on the owner's PC (the claude.ai account's directory plugins, `.mcp.json`, user-scope servers and the PC's credentials). A Claude Code cloud session has none of them, and nothing is installed there; its session-start hook says so ([hybrid §2](hybrid.md#2-what-a-cloud-session-has-and-lacks)).

What a cloud session has of this list: the skills committed in `.claude/skills/` (the project's and the vendored `vercel-agent-skills`), and `gh`, signed in as the owner through the cloud's GitHub proxy. So the steps that need a tool here (the hosted look-ups, the migration count, Context7) run on the PC.

## Tools by phase
| Tool | Kind | Phase | Sign-in |
|---|---|---|---|
| supabase | plugin | 0 | Supabase sign-in; also registered at user scope |
| context7 | plugin | 0 | Optional `CONTEXT7_API_KEY` for higher rate limits |
| frontend-design | plugin | 0 | None |
| security-guidance | plugin | 0 | None |
| upstash | plugin | 0 | Upstash account; also registered at user scope, read-only by the owner's choice |
| github | plugin | 0 | A personal access token (see GitHub below) |
| vercel | MCP (`.mcp.json`) | 0 | Vercel sign-in on first use |
| shadcn | MCP (`.mcp.json`) | 0 | None |
| vercel-agent-skills | skills (`.claude/skills`) | 0 | None |
| playwright | plugin | 1 | None |
| sentry | plugin | 1 | Sentry sign-in (organisation `shakti-supreme`) |
| aws-core | plugin | 1 | The read-only IAM user `claude-shakti` |
| expo | plugin | 4 | Expo account |

The ten directory plugins are enabled on the owner's claude.ai account. The SessionStart hook cannot see account plugins, so it always lists them as "to confirm"; confirm them with the plugin listing tool.

## Connection notes
- **GitHub:** the plugin has no browser sign-in. It sends a fine-grained personal access token, limited to this repository, from the Windows user variable `GITHUB_PERSONAL_ACCESS_TOKEN`; an unset variable shows as HTTP 400. When the repository moves to the client's organisation, a new token is needed. `gh` is signed in as `techaust` on the PC; in a cloud session it reaches GitHub through the cloud's proxy as the owner.
- **Sentry and Expo** are signed in.
- **AWS:** runs through `uvx` with the credentials `aws configure` saved in `%USERPROFILE%\.aws` for `claude-shakti` (region `ap-south-1`, read-only). For the file storage bucket, add a permission for that one bucket rather than widening the user; the files stack does this ([files-setup](files-setup.md)).
- **Supabase, Upstash and Vercel** hold the dev and staging environments (29-09-2026). The Vercel server was authorised again for the `shakti-prime` team on 29-09-2026 and reads its projects, variables and deployments.
- **Context7** was signed in again on 03-10-2026; a session started before a sign-in cannot see it until it is reopened.
- **shadcn**, **playwright** and the second AWS entry can time out at start and come back on the next start.
- A server that shows "Connection closed" is missing its stdio command: check the plugin's `.mcp.json` under `~/.claude/plugins/synced/`.

## Signing a server in again
The desktop chat cannot run an OAuth sign-in. The owner authorises a server from the desktop app's menu, then reopens the session (the labels below follow the app at the time of writing; if a screen names a step differently, the setting is the same):
1. Open the Claude desktop app and click the settings icon (the gear).
2. Open *Connectors* (or *Developer*, for a server from `.mcp.json`) and click the server's name.
3. Click *Connect* (or *Authenticate*) and finish the sign-in in the browser window that opens.
4. Close the session and start a new one; a session that was open during the sign-in cannot see the server.

From a terminal the same is `claude`, then `/mcp`, then *Authenticate*; a plugin's server can also be authorised on claude.ai.
