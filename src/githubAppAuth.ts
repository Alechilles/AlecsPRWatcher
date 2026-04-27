import { createSign } from "node:crypto";
import { readFile } from "node:fs/promises";

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

export class GitHubAppClient {
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

  private async githubRequest<T>(path: string): Promise<T> {
    const jwt = await this.createJwt();
    const response = await fetch(new URL(path, "https://api.github.com"), {
      headers: {
        accept: "application/vnd.github+json",
        authorization: `Bearer ${jwt}`,
        "user-agent": "codex-pr-review-watcher",
        "x-github-api-version": "2022-11-28",
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`GitHub App API ${response.status}: ${body}`);
    }
    return JSON.parse(body) as T;
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
