import type { RegisterWatchInput, ReviewDelta, Watch } from "./types.js";
import { request as httpRequest } from "node:http";
import { request as httpsRequest } from "node:https";

export class RemoteWatchClient {
  constructor(
    private readonly baseUrl: string,
    private readonly token: string,
    private readonly resolveIp?: string,
  ) {
    if (!baseUrl) {
      throw new Error("baseUrl is required");
    }
    if (!token) {
      throw new Error("token is required");
    }
  }

  async registerWatch(input: RegisterWatchInput): Promise<Watch> {
    return this.request<Watch>("/api/register", {
      method: "POST",
      body: JSON.stringify(input),
    });
  }

  async getDelta(watchIdOrRepo: string, prNumber?: number): Promise<ReviewDelta> {
    const params = new URLSearchParams({ repo: watchIdOrRepo });
    if (prNumber !== undefined) {
      params.set("pr", String(prNumber));
    }
    return this.request<ReviewDelta>(`/api/delta?${params.toString()}`);
  }

  async markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number): Promise<Watch> {
    return this.request<Watch>("/api/handled", {
      method: "POST",
      body: JSON.stringify({
        repo: watchIdOrRepo,
        prNumber,
        eventIds,
      }),
    });
  }

  async listWatches(): Promise<Watch[]> {
    return this.request<Watch[]>("/api/watches");
  }

  async rawGet<T = unknown>(path: string): Promise<T> {
    return this.request<T>(path);
  }

  private async request<T>(path: string, init: RequestInit = {}): Promise<T> {
    const url = resolveApiUrl(this.baseUrl, path);
    if (this.resolveIp) {
      return this.requestWithPinnedIp<T>(url, init);
    }

    const response = await fetch(url, {
      ...init,
      headers: {
        accept: "application/json",
        authorization: `Bearer ${this.token}`,
        "content-type": "application/json",
        ...init.headers,
      },
    });
    const body = await response.text();
    if (!response.ok) {
      throw new Error(`Watcher API ${response.status}: ${body}`);
    }
    return JSON.parse(body) as T;
  }

  private async requestWithPinnedIp<T>(url: URL, init: RequestInit): Promise<T> {
    const body = typeof init.body === "string" ? init.body : undefined;
    const headers = {
      accept: "application/json",
      authorization: `Bearer ${this.token}`,
      "content-type": "application/json",
      host: url.host,
      ...(init.headers as Record<string, string> | undefined),
    };
    const transport = url.protocol === "https:" ? httpsRequest : httpRequest;

    const responseBody = await new Promise<{ statusCode: number; body: string }>((resolve, reject) => {
      const request = transport(
        {
          protocol: url.protocol,
          hostname: this.resolveIp,
          port: url.port || (url.protocol === "https:" ? 443 : 80),
          path: `${url.pathname}${url.search}`,
          method: init.method ?? "GET",
          headers,
          servername: url.hostname,
        },
        (response) => {
          const chunks: Buffer[] = [];
          response.on("data", (chunk) => chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)));
          response.on("end", () => {
            resolve({
              statusCode: response.statusCode ?? 0,
              body: Buffer.concat(chunks).toString("utf8"),
            });
          });
        },
      );
      request.on("error", reject);
      if (body) {
        request.write(body);
      }
      request.end();
    });

    if (responseBody.statusCode < 200 || responseBody.statusCode >= 300) {
      throw new Error(`Watcher API ${responseBody.statusCode}: ${responseBody.body}`);
    }
    return JSON.parse(responseBody.body) as T;
  }
}

export function resolveApiUrl(baseUrl: string, path: string): URL {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  const relativePath = path.startsWith("/") ? path.slice(1) : path;
  return new URL(relativePath, normalizedBase);
}
