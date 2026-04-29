import { createHmac } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { toIngestEvent, verifyGitHubSignature } from "../src/githubWebhook.js";

test("verifyGitHubSignature validates sha256 signatures", () => {
  const body = JSON.stringify({ ok: true });
  const secret = "secret";
  const signature = `sha256=${createHmac("sha256", secret).update(body).digest("hex")}`;

  assert.equal(verifyGitHubSignature(body, signature, secret), true);
  assert.equal(verifyGitHubSignature(body, signature, "wrong"), false);
});

test("toIngestEvent parses pull request review comments", () => {
  const event = toIngestEvent("pull_request_review_comment", "delivery-1", {
    action: "created",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42 },
    comment: {
      node_id: "PRRC_node",
      user: { login: "codex-review-bot" },
      body: "Please extract this helper.",
      html_url: "https://github.com/Owner/Repo/pull/42#discussion_r1",
      commit_id: "abc123",
      created_at: "2026-04-26T12:00:00Z",
    },
  });

  assert.equal(event?.repo, "Owner/Repo");
  assert.equal(event?.prNumber, 42);
  assert.equal(event?.kind, "review_comment");
  assert.equal(event?.author, "codex-review-bot");
  assert.equal(event?.body, "Please extract this helper.");
});

test("toIngestEvent uses updated time for edited review comments", () => {
  const event = toIngestEvent("pull_request_review_comment", "delivery-2", {
    action: "edited",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42 },
    comment: {
      node_id: "PRRC_node",
      user: { login: "reviewer" },
      body: "Updated feedback.",
      html_url: "https://github.com/Owner/Repo/pull/42#discussion_r1",
      commit_id: "abc123",
      created_at: "2026-04-20T12:00:00Z",
      updated_at: "2026-04-26T12:00:00Z",
    },
  });

  assert.equal(event?.kind, "review_comment");
  assert.equal(event?.action, "edited");
  assert.equal(event?.createdAt, "2026-04-26T12:00:00Z");
});

test("toIngestEvent parses review approvals", () => {
  const event = toIngestEvent("pull_request_review", "delivery-3", {
    action: "submitted",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42 },
    review: {
      node_id: "PRR_node",
      user: { login: "codex-review-bot" },
      body: "Looks good.",
      html_url: "https://github.com/Owner/Repo/pull/42#pullrequestreview-1",
      state: "approved",
      commit_id: "abc123",
      submitted_at: "2026-04-26T12:01:00Z",
    },
  });

  assert.equal(event?.kind, "review_submitted");
  assert.equal(event?.state, "approved");
});

test("toIngestEvent uses updated time for edited reviews", () => {
  const event = toIngestEvent("pull_request_review", "delivery-4", {
    action: "edited",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42 },
    review: {
      node_id: "PRR_node",
      user: { login: "reviewer" },
      body: "Updated summary.",
      html_url: "https://github.com/Owner/Repo/pull/42#pullrequestreview-1",
      state: "changes_requested",
      commit_id: "abc123",
      submitted_at: "2026-04-20T12:00:00Z",
      updated_at: "2026-04-26T12:01:00Z",
    },
  });

  assert.equal(event?.kind, "review_submitted");
  assert.equal(event?.action, "edited");
  assert.equal(event?.createdAt, "2026-04-26T12:01:00Z");
});

test("toIngestEvent parses pull request review thread events", () => {
  const event = toIngestEvent("pull_request_review_thread", "delivery-5", {
    action: "unresolved",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42, html_url: "https://github.com/Owner/Repo/pull/42" },
    thread: {
      node_id: "thread_node",
      html_url: "https://github.com/Owner/Repo/pull/42#discussion_r1",
      updated_at: "2026-04-26T12:02:00Z",
    },
    sender: { login: "reviewer" },
  });

  assert.equal(event?.kind, "review_thread");
  assert.equal(event?.action, "unresolved");
  assert.equal(event?.author, "reviewer");
});

test("toIngestEvent parses pull request synchronize events", () => {
  const event = toIngestEvent("pull_request", "delivery-6", {
    action: "synchronize",
    repository: { full_name: "Owner/Repo" },
    pull_request: {
      number: 42,
      node_id: "pr_node",
      html_url: "https://github.com/Owner/Repo/pull/42",
      updated_at: "2026-04-26T12:02:30Z",
      head: { sha: "abc123" },
    },
    sender: { login: "Alechilles" },
  });

  assert.equal(event?.kind, "head_changed");
  assert.equal(event?.commitSha, "abc123");
  assert.equal(event?.createdAt, "2026-04-26T12:02:30Z");
});

test("toIngestEvent parses thumbs-up reactions on PR issue payloads", () => {
  const event = toIngestEvent("reaction", "delivery-7", {
    action: "created",
    repository: { full_name: "Owner/Repo" },
    issue: {
      number: 42,
      pull_request: { url: "https://api.github.com/repos/Owner/Repo/pulls/42" },
      html_url: "https://github.com/Owner/Repo/pull/42",
    },
    reaction: {
      node_id: "reaction_node",
      content: "+1",
      created_at: "2026-04-26T12:02:00Z",
    },
    sender: { login: "codex-review-bot" },
  });

  assert.equal(event?.kind, "reaction");
  assert.equal(event?.reaction, "+1");
  assert.equal(event?.author, "codex-review-bot");
});

test("toIngestEvent parses deleted issue comments", () => {
  const event = toIngestEvent("issue_comment", "delivery-8", {
    action: "deleted",
    repository: { full_name: "Owner/Repo" },
    issue: {
      number: 42,
      pull_request: { url: "https://api.github.com/repos/Owner/Repo/pulls/42" },
    },
    comment: {
      node_id: "comment_node",
      user: { login: "reviewer" },
      body: "Removed feedback.",
      html_url: "https://github.com/Owner/Repo/pull/42#issuecomment-1",
      created_at: "2026-04-26T12:03:00Z",
      updated_at: "2026-04-26T12:04:00Z",
    },
  });

  assert.equal(event?.kind, "issue_comment");
  assert.equal(event?.action, "deleted");
  assert.equal(event?.createdAt, "2026-04-26T12:04:00Z");
});

test("toIngestEvent parses edited issue comments", () => {
  const event = toIngestEvent("issue_comment", "delivery-8", {
    action: "edited",
    repository: { full_name: "Owner/Repo" },
    issue: {
      number: 42,
      pull_request: { url: "https://api.github.com/repos/Owner/Repo/pulls/42" },
    },
    comment: {
      node_id: "comment_node",
      user: { login: "reviewer" },
      body: "Edited existing feedback.",
      html_url: "https://github.com/Owner/Repo/pull/42#issuecomment-1",
      created_at: "2026-04-26T12:03:00Z",
      updated_at: "2026-04-26T12:05:00Z",
    },
  });

  assert.equal(event?.kind, "issue_comment");
  assert.equal(event?.action, "edited");
  assert.equal(event?.body, "Edited existing feedback.");
  assert.equal(event?.createdAt, "2026-04-26T12:05:00Z");
});

test("toIngestEvent ignores unsupported webhook events", () => {
  const event = toIngestEvent("pull_request", "delivery-9", {
    action: "edited",
    repository: { full_name: "Owner/Repo" },
    pull_request: { number: 42 },
    sender: { login: "Alechilles" },
  });

  assert.equal(event, undefined);
});
