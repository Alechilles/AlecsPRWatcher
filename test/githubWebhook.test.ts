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

test("toIngestEvent parses review approvals", () => {
  const event = toIngestEvent("pull_request_review", "delivery-2", {
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

test("toIngestEvent parses thumbs-up reactions on PR issue payloads", () => {
  const event = toIngestEvent("reaction", "delivery-3", {
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
