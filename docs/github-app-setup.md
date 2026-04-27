# GitHub App Setup

Create one GitHub App and install it on all repositories where Codex should watch PR reviews.

## App Registration

1. Go to GitHub `Settings` -> `Developer settings` -> `GitHub Apps` -> `New GitHub App`.
2. Set a name such as `Codex PR Review Watcher`.
3. Homepage URL can be `https://prwatcher.alecsmods.com/healthz`.
4. Disable user authorization callback if GitHub asks for OAuth callback details; this watcher does not use OAuth.
5. Enable webhooks.
6. Set `Webhook URL`:

```text
https://prwatcher.alecsmods.com/github/webhook
```

7. Set `Webhook secret`:

```text
<set this to the same value as GITHUB_WEBHOOK_SECRET on the watcher server>
```

## Permissions

Repository permissions:

- `Metadata`: Read-only
- `Pull requests`: Read-only
- `Issues`: Read-only

No write permission is required for the watcher itself. Codex still uses its normal GitHub access to push commits, reply to review threads, and resolve comments.

## Events

Subscribe to:

- `Pull request review comments`
- `Pull request reviews`
- `Pull request review threads`
- `Issue comments`

Do not look for a `Reactions` event. GitHub does not currently list reactions as a selectable webhook event for this setup, so the watcher should complete on review approval, quiet period, or timeout instead.

## Installation

Install the GitHub App on:

- `All repositories`, if all current and future repos should use the watcher.
- `Only select repositories`, if you want to limit it to the 13 repos.

After installation, GitHub sends a `ping` delivery. A successful setup should show a 2xx delivery in the app's webhook delivery log.

Current app:

- App ID: `3521481`
- Slug: `alec-s-pr-watcher`
- Name: `Alec's PR Watcher`
