import { generateKeyPairSync } from "node:crypto";
import test from "node:test";
import assert from "node:assert/strict";
import { GitHubAppClient } from "../src/githubAppAuth.js";

test("GitHubAppClient.fromEnvironment ignores partial app configuration", () => {
  const previousAppId = process.env.GITHUB_APP_ID;
  const previousPrivateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
  const previousPrivateKey = process.env.GITHUB_APP_PRIVATE_KEY;

  try {
    process.env.GITHUB_APP_ID = "123";
    delete process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    delete process.env.GITHUB_APP_PRIVATE_KEY;
    assert.equal(GitHubAppClient.fromEnvironment(), undefined);

    delete process.env.GITHUB_APP_ID;
    process.env.GITHUB_APP_PRIVATE_KEY_PATH = "C:/missing/private-key.pem";
    assert.equal(GitHubAppClient.fromEnvironment(), undefined);

    process.env.GITHUB_APP_ID = "123";
    const client = GitHubAppClient.fromEnvironment();
    assert.ok(client instanceof GitHubAppClient);
  } finally {
    restoreEnv("GITHUB_APP_ID", previousAppId);
    restoreEnv("GITHUB_APP_PRIVATE_KEY_PATH", previousPrivateKeyPath);
    restoreEnv("GITHUB_APP_PRIVATE_KEY", previousPrivateKey);
  }
});

test("GitHubAppClient paginates pull request reviews", async () => {
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requestedUrls.push(url.href);

    if (url.pathname === "/repos/owner/repo/installation") {
      return jsonResponse({ id: 42 });
    }
    if (url.pathname === "/app/installations/42/access_tokens") {
      return jsonResponse({ token: "installation-token", expires_at: "2999-01-01T00:00:00.000Z" });
    }
    if (url.pathname === "/repos/owner/repo/pulls/7/reviews") {
      assert.equal(url.searchParams.get("per_page"), "100");
      if (url.searchParams.get("page") === "1") {
        return jsonResponse(
          Array.from({ length: 100 }, (_, index) => ({
            state: "COMMENTED",
            user: { login: "reviewer" },
            commit_id: `page-1-${index}`,
            submitted_at: "2026-04-27T12:00:00.000Z",
          })),
        );
      }
      if (url.searchParams.get("page") === "2") {
        return jsonResponse([
          {
            state: "APPROVED",
            user: { login: "chatgpt-codex-connector[bot]" },
            commit_id: "page-2-0",
            submitted_at: "2026-04-27T12:01:00.000Z",
          },
        ]);
      }
    }

    return jsonResponse({ message: `unexpected ${url.href}` }, 404);
  }) as typeof fetch;

  try {
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    });

    const reviews = await client.listPullRequestReviews("owner/repo", 7);

    assert.equal(reviews.length, 101);
    assert.equal(reviews[100].commitSha, "page-2-0");
    assert.ok(requestedUrls.some((url) => url.endsWith("/pulls/7/reviews?per_page=100&page=2")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test("GitHubAppClient paginates issue reactions", async () => {
  const originalFetch = globalThis.fetch;
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const requestedUrls: string[] = [];

  globalThis.fetch = (async (input) => {
    const url = input instanceof URL ? input : new URL(String(input));
    requestedUrls.push(url.href);

    if (url.pathname === "/repos/owner/repo/installation") {
      return jsonResponse({ id: 42 });
    }
    if (url.pathname === "/app/installations/42/access_tokens") {
      return jsonResponse({ token: "installation-token", expires_at: "2999-01-01T00:00:00.000Z" });
    }
    if (url.pathname === "/repos/owner/repo/issues/7/reactions") {
      assert.equal(url.searchParams.get("per_page"), "100");
      if (url.searchParams.get("page") === "1") {
        return jsonResponse(
          Array.from({ length: 100 }, () => ({
            content: "eyes",
            user: { login: "reviewer" },
            created_at: "2026-04-27T12:00:00.000Z",
          })),
        );
      }
      if (url.searchParams.get("page") === "2") {
        return jsonResponse([
          {
            content: "+1",
            user: { login: "chatgpt-codex-connector[bot]" },
            created_at: "2026-04-27T12:01:00.000Z",
          },
        ]);
      }
    }

    return jsonResponse({ message: `unexpected ${url.href}` }, 404);
  }) as typeof fetch;

  try {
    const client = new GitHubAppClient({
      appId: "123",
      privateKey: privateKey.export({ type: "pkcs1", format: "pem" }).toString(),
    });

    const reactions = await client.listIssueReactions("owner/repo", 7);

    assert.equal(reactions.length, 101);
    assert.equal(reactions[100].content, "+1");
    assert.ok(requestedUrls.some((url) => url.endsWith("/issues/7/reactions?per_page=100&page=2")));
  } finally {
    globalThis.fetch = originalFetch;
  }
});

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) {
    delete process.env[name];
    return;
  }
  process.env[name] = value;
}
