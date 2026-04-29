# PR Review Watcher Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build a local durable GitHub PR watcher that lets Codex resume the same thread, detect new review feedback, and address review comments through MCP tools.

**Architecture:** A small TypeScript service stores watch state in an atomic JSON file, ingests GitHub webhook events through an HTTP endpoint, and exposes MCP tools over stdio for Codex to register watches and fetch review deltas. A CLI wraps the same service for setup, status checks, webhook serving, and prompt generation.

**Tech Stack:** Node.js 24, TypeScript, `@modelcontextprotocol/sdk`, `zod`, built-in `node:test`.

---

### Task 1: Core Project

**Files:**
- Create: `package.json`
- Create: `tsconfig.json`
- Create: `src/types.ts`
- Create: `src/stateStore.ts`
- Test: `test/stateStore.test.ts`

- [x] Define package scripts for `build`, `test`, `typecheck`, `mcp`, and `serve`.
- [x] Define shared watch/event/policy types.
- [x] Implement atomic JSON load/save with an empty initial database.
- [x] Test that the store creates a usable default database and persists updates.

### Task 2: Watch Service

**Files:**
- Create: `src/watchService.ts`
- Test: `test/watchService.test.ts`

- [x] Implement watch registration with repo, PR number, branch, workspace, bot login, and review policy.
- [x] Implement event ingestion with monotonic event IDs and duplicate GitHub delivery protection.
- [x] Implement delta retrieval that returns only unhandled events after the watch cursor.
- [x] Implement completion policy for bot approval, bot thumbs-up, quiet period, and timeout.
- [x] Implement mark-handled behavior so Codex can advance a watch after addressing feedback.

### Task 3: GitHub Webhook Server

**Files:**
- Create: `src/githubWebhook.ts`
- Create: `src/server.ts`
- Test: `test/githubWebhook.test.ts`

- [x] Validate GitHub webhook signatures when `GITHUB_WEBHOOK_SECRET` is set.
- [x] Parse review comments, review submissions, issue comments, and reaction events into internal watch events.
- [x] Expose `POST /github/webhook` and `GET /healthz`.
- [x] Store unmatched events only when they belong to a registered repo/PR watch.

### Task 4: MCP and CLI

**Files:**
- Create: `src/mcp.ts`
- Create: `src/cli.ts`
- Create: `src/index.ts`

- [x] Add MCP tools: `register_watch`, `get_review_delta`, `mark_events_handled`, `watch_status`, and `list_watches`.
- [x] Add CLI commands: `register`, `delta`, `handled`, `status`, `list`, `serve`, `mcp`, and `prompt`.
- [x] Make the CLI and MCP share one store path through `CODEX_PR_WATCHER_DB` or `./.codex-pr-watcher.json`.

### Task 5: Documentation and Verification

**Files:**
- Create: `README.md`

- [x] Document setup, GitHub webhook configuration, MCP configuration, and same-thread Codex heartbeat usage.
- [x] Run `npm install`.
- [x] Run `npm run typecheck`.
- [x] Run `npm test`.
