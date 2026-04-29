# Codex PR Review Watcher

This project is a local durable watcher for Codex-submitted GitHub PRs. It lets a Codex thread register a PR, go idle, wake later through a Codex heartbeat automation, ask for only new review events, address those comments, push fixes, and mark the events handled.

The watcher does not replace Codex. It solves the part Codex is bad at during one live run: durable waiting.

## Pieces

- `src/server.ts`: HTTP webhook receiver for GitHub events.
- `src/mcp.ts`: MCP stdio server exposing watcher tools to Codex.
- `src/watchService.ts`: state machine for watches, event deltas, handled cursors, and completion policy.
- `.codex-pr-watcher.json`: default durable state file.

## Install

```powershell
npm install
npm run typecheck
npm test
```

## GitHub App Setup

Use a GitHub App for normal operation. A GitHub App has one central webhook URL and can be installed on all repositories, so you do not need to create a webhook in each repo.

App webhook URL:

```text
https://prwatcher.alecsmods.com/github/webhook
```

App webhook secret:

```text
<set this to the same value as GITHUB_WEBHOOK_SECRET on the watcher server>
```

Recommended repository permissions:

- `Metadata`: Read-only
- `Pull requests`: Read-only
- `Issues`: Read and write

`Issues` write access is required so the watcher can post `@codex review` when a new PR head SHA has not been acknowledged by the Codex review bot.

Subscribe to events:

- `Pull request review comments`
- `Pull request reviews`
- `Pull request review threads`
- `Issue comments`

Install the app on all repositories you want Codex PR watching to work with.

## Local Webhook Receiver

```powershell
$env:GITHUB_WEBHOOK_SECRET = "use-a-real-random-secret"
npm run serve
```

The server listens on `http://127.0.0.1:3797` by default.

For local development only, expose it to GitHub with your preferred tunnel, then configure a repository or organization webhook for:

- `Pull request review comments`
- `Pull request reviews`
- `Pull request review threads`
- `Issue comments`

Set the webhook URL to:

```text
https://your-tunnel.example/github/webhook
```

Use the same secret as `GITHUB_WEBHOOK_SECRET`.

## Register a PR Watch

```powershell
npm run cli -- register --repo owner/name --pr 123 --branch feature/my-pr --workspace C:\path\to\repo --bot codex-review-bot
```

Useful options:

- `--quiet-minutes 15`: complete after no unhandled feedback and no new activity for 15 minutes.
- `--timeout-minutes 240`: stop waiting after 4 hours.
- `--complete-on-approval true`: complete when the bot submits an approving review.

## Query a Delta

```powershell
npm run cli -- delta --repo owner/name --pr 123
```

After Codex addresses events:

```powershell
npm run cli -- handled --repo owner/name --pr 123 --events 1,2,3
```

## MCP Configuration

Add an MCP server entry that runs:

```powershell
npm run mcp
```

Set `CODEX_PR_WATCHER_DB` if Codex and the webhook server need to share a database path from different working directories:

```powershell
$env:CODEX_PR_WATCHER_DB = "C:\path\to\.codex-pr-watcher.json"
```

The MCP tools are:

- `register_watch`
- `get_review_delta`
- `mark_events_handled`
- `watch_status`
- `list_watches`

## Same-Thread Codex Flow

1. Codex implements the change and submits the PR.
2. Codex calls `register_watch` through MCP.
3. Codex creates a thread heartbeat automation in the current thread, for example every 5 minutes.
4. The webhook server records GitHub review activity while Codex is idle.
5. Each heartbeat resumes the same thread and asks the watcher for a delta.
6. If new events exist, Codex patches the registered workspace, runs tests, pushes the branch, replies/resolves review threads when possible, and calls `mark_events_handled`.
7. If the watcher reports `completed`, Codex summarizes the completion reason and stops the heartbeat.

Generate a reusable heartbeat prompt:

```powershell
npm run cli -- prompt --repo owner/name --pr 123
```

Prompt text:

```text
Check the PR review watcher for owner/name#123. If get_review_delta returns new review feedback, inspect the PR branch in the registered workspace, address only the new actionable comments, run the relevant tests, push the branch, reply to or resolve the addressed GitHub review threads when possible, then call mark_events_handled with the event IDs you addressed. If the watch is completed, summarize the completion reason and stop.
```

## Limits

This does not prove no reviewer will ever add another comment. It uses explicit completion signals and policy:

- bot review approval
- quiet period with no unhandled feedback
- timeout

GitHub does not expose reactions as a selectable webhook event in the current webhook event list. The watcher keeps reaction parsing for compatibility with any future or manually forwarded payloads, but the normal GitHub App setup should not rely on thumbs-up reactions as a completion signal.

If your Codex app exposes a direct wake-current-thread API later, the webhook service can be extended to trigger that instead of relying on heartbeat polling.

## VPS API Mode

When the watcher runs on a VPS, configure the local MCP server as a remote client:

```powershell
$env:CODEX_PR_WATCHER_API_URL = "https://your-domain.example/codex-pr-watcher/"
$env:CODEX_PR_WATCHER_API_TOKEN = "remote-api-token"
npm run mcp
```

The VPS server needs:

```bash
WATCHER_API_TOKEN=remote-api-token
GITHUB_WEBHOOK_SECRET=github-webhook-secret
CODEX_PR_WATCHER_DB=/data/.codex-pr-watcher.json
GITHUB_APP_ID=3521481
GITHUB_APP_PRIVATE_KEY_PATH=/run/secrets/github-app-private-key.pem
```

Reverse proxy `/codex-pr-watcher/*` to the service with the prefix stripped before it reaches the watcher.
