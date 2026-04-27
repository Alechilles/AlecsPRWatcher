import type { CodexReviewSignalClient, RegisterWatchInput, ReviewDelta, Watch } from "./types.js";
import { WatchService } from "./watchService.js";

export interface WatchClient {
  registerWatch(input: RegisterWatchInput): Promise<Watch>;
  getDelta(watchIdOrRepo: string, prNumber?: number): Promise<ReviewDelta>;
  markHandled(watchIdOrRepo: string, eventIds: number[], prNumber?: number): Promise<Watch>;
  listWatches(): Promise<Watch[]>;
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
      await this.service.refreshCodexReviewState(watchIdOrRepo, this.github, prNumber);
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
