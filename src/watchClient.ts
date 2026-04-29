import type { CodexReviewSignalClient, RegisterWatchInput, ReviewDelta, Watch } from "./types.js";
import { WatchService } from "./watchService.js";

export interface WatchClient {
  registerWatch(input: RegisterWatchInput): Promise<Watch>;
  getDelta(watchIdOrRepo: string, prNumber?: number): Promise<ReviewDelta>;
  markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number): Promise<Watch>;
  listWatches(): Promise<Watch[]>;
}

export class LazyWatchClient implements WatchClient {
  private client: WatchClient | undefined;

  constructor(private readonly createClient: () => WatchClient) {}

  registerWatch(input: RegisterWatchInput): Promise<Watch> {
    return this.getClient().registerWatch(input);
  }

  getDelta(watchIdOrRepo: string, prNumber?: number): Promise<ReviewDelta> {
    return this.getClient().getDelta(watchIdOrRepo, prNumber);
  }

  markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number): Promise<Watch> {
    return this.getClient().markHandled(watchIdOrRepo, eventIds, prNumber);
  }

  listWatches(): Promise<Watch[]> {
    return this.getClient().listWatches();
  }

  private getClient(): WatchClient {
    this.client ??= this.createClient();
    return this.client;
  }
}

export class RefreshingWatchClient implements WatchClient {
  constructor(
    private readonly service: WatchService,
    private readonly github: CodexReviewSignalClient | undefined,
  ) {}

  registerWatch(input: RegisterWatchInput): Promise<Watch> {
    return this.service.registerWatch(input);
  }

  async getDelta(watchIdOrRepo: string, prNumber?: number): Promise<ReviewDelta> {
    if (this.github) {
      try {
        await this.service.refreshCodexReviewState(watchIdOrRepo, this.github, prNumber);
      } catch {
        // Webhook-ingested feedback is still useful when GitHub polling is temporarily unavailable.
      }
    }
    return this.service.getDelta(watchIdOrRepo, prNumber);
  }

  markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number): Promise<Watch> {
    return this.service.markHandled(watchIdOrRepo, eventIds, prNumber);
  }

  listWatches(): Promise<Watch[]> {
    return this.service.listWatches();
  }
}
