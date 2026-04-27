import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";
import type {
  CodexReviewSignalClient,
  IssueReactionSnapshot,
  PullRequestReviewSnapshot,
  PullRequestSnapshot,
} from "./types.js";

export interface GitHubAppConfig {
  appId: string;
  privateKeyPath?: string;
  privateKey?: string;
}

export interface GitHubAppInfo {
  id: number;
  slug: string;
  name: string;
  owner?: {
    login?: string;
  };
}

export interface GitHubAppInstallation {
  id: number;
  account?: {
    login?: string;
  };
  repository_selection?: string;
}

interface InstallationToken {
  token: string;
  expires_at: string;
}

interface RepositoryInstallation {
  id: number;
}

export class GitHubAppClient implements CodexReviewSignalClient {
  private readonly installationTokens = new Map<number, InstallationToken>();

  constructor(private readonly config: GitHubAppConfig) {
    if (!config.appId) {
      throw new Error("GitHub App ID is required");
    }
    if (!config.privateKey && !config.privateKeyPath) {
      throw new Error("GitHub App private key or private key path is required");
    }
  }

  static fromEnvironment(): GitHubAppClient | undefined {
    const appId = process.env.GITHUB_APP_ID;
    const privateKeyPath = process.env.GITHUB_APP_PRIVATE_KEY_PATH;
    const privateKey = process.env.GITHUB_APP_PRIVATE_KEY;
    if (!appId && !privateKeyPath && !privateKey) {
      return undefined;
    }
    return new GitHubAppClient({
      appId: appId ?? "",
      privateKey,
      privateKeyPath,
    });
  }

  async getApp(): Promise<GitHubAppInfo> {
    return this.githubRequest<GitHubAppInfo>("/app");
  }

  async listInstallations(): Promise<GitHubAppInstallation[]> {
    return this.githubRequest<GitHubAppInstallation[]>("/app/installations");
  }

  async getPullRequest(repo: string, prNumber: number): Promise<PullRequestSnapshot> {
    const response = await this.installationRequest<{ head: { sha: string } }>(
      repo,
      `/repos/${repo}/pulls/${prNumber}`,
    );
    return { headSha: response.head.sha };
  }

  async listIssueReactions(repo: string, prNumber: number): Promise<IssueReactionSnapshot[]> {
    const response = await this.installationRequest<
      Array<{ content: string; user?: { login?: string }; created_at: string }>
    >(repo, `/repos/${repo}/issues/${prNumber}/reactions`);
    return response.map((reaction) => ({
      content: reaction.content,
      userLogin: reaction.user?.login,
      createdAt: reaction.created_at,
    }));
  }

  async listPullRequestReviews(repo: string, prNumber: number): Promise<PullRequestReviewSnapshot[]> {
    const response = await this.installationRequest<
      Array<{ state: string; user?: { login?: string }; commit_id?: string; submitted_at?: string }>
    >(repo, `/repos/${repo}/pulls/${prNumber}/reviews`);
    return response.map((review) => ({
      state: review.state,
      author: review.user?.login,
      commitSha: review.commit_id,
      submittedAt: review.submitted_at,
    }));
  }

  async createIssueComment(repo: string, prNumber: number, body: string): Promise<{ url?: string }> {
    const response = await this.installationRequest<{ html_url?: string }>(repo, `/repos/${repo}/issues/${prNumber}/comments`, {
      method: "POST",
      body: JSON.stringify({ body }),
    });
    return { url: response.html_url };
  }

  private async githubRequest<T>(path: string, init: RequestInit = {}): Promise<T> {
    const jwt = await this.createJwt();
    const response = await fetch(new URL(path, "https://api.github.com"), {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "content-type": "application/json",
        "user-agent": "codex-pr-review-watcher",
        "x-github-api-version": "2022-11-28",
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub App API ${response.status}: ${body}`);
    }
    return JSON.parse(body) as T;
  }

  private async installationRequest<T>(repo: string, path: string, init: RequestInit = {}): Promise<T> {
    const token = await this.installationTokenForRepo(repo);
    const response = await fetch(new URL(path, "https://api.github.com"), {
      ...init,
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${token}`,
        "content-type": "application/json",
        "user-agent": "codex-pr-review-watcher",
        "x-github-api-version": "2022-11-28",
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub installation API ${response.status}: ${body}`);
    }
    return body.length > 0 ? (JSON.parse(body) as T) : (undefined as T);
  }

  private async installationTokenForRepo(repo: string): Promise<string> {
    const installation = await this.githubRequest<RepositoryInstallation>(`/repos/${repo}/installation`);
    const cached = this.installationTokens.get(installation.id);
    if (cached && new Date(cached.expires_at).getTime() - Date.now() > 60000) {
      return cached.token;
    }
    const token = await this.githubRequest<InstallationToken>(`/app/installations/${installation.id}/access_tokens`, {
      method: "POST",
    });
    this.installationTokens.set(installation.id, token);
    return token.token;
  }

  private async createJwt(): Promise<string> {
    const now = Math.floor(Date.now() / 1000);
    const header = base64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
    const payload = base64Url(
      JSON.stringify({
        iat: now - 60,
        exp: now + 540,
        iss: this.config.appId,
      }),
    );
    const unsigned = `${header}.${payload}`;
    const signer = createSign("RSA-SHA256");
    signer.update(unsigned);
    signer.end();
    const privateKey = this.config.privateKey ?? (await readFile(this.config.privateKeyPath ?? "", "utf8"));
    const signature = signer.sign(privateKey);
    return `${unsigned}.${base64Url(signature)}`;
  }
}

function base64Url(value: string | Buffer): string {
  return Buffer.from(value)
    .toString("base64")
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}
