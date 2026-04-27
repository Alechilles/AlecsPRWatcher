export type WatchStatus = "active" | "completed" | "paused";

export type CompletionReason =
  | "bot_approved"
  | "bot_thumbs_up"
  | "quiet_period"
  | "timeout";

export interface WatchPolicy {
  botLogin: string;
  quietMinutes: number;
  timeoutMinutes: number;
  completeOnApproval: boolean;
  completeOnThumbsUp: boolean;
  completeOnQuiet: boolean;
}

export interface Watch {
  id: string;
  repo: string;
  prNumber: number;
  branch?: string;
  workspace?: string;
  threadLabel?: string;
  status: WatchStatus;
  policy: WatchPolicy;
  cursor: number;
  createdAt: string;
  updatedAt: string;
  lastActivityAt: string;
  lastObservedHeadSha?: string;
  lastObservedHeadAt?: string;
  lastReviewRequestHeadSha?: string;
  lastReviewRequestAt?: string;
  codexReviewSeenHeadSha?: string;
  codexReviewSeenAt?: string;
  completedAt?: string;
  completionReason?: CompletionReason;
}

export type WatchEventKind =
  | "review_comment"
  | "review_submitted"
  | "issue_comment"
  | "reaction"
  | "unknown";

export interface WatchEvent {
  id: number;
  watchId: string;
  githubDeliveryId?: string;
  githubNodeId?: string;
  kind: WatchEventKind;
  action?: string;
  author?: string;
  body?: string;
  url?: string;
  state?: string;
  reaction?: string;
  commitSha?: string;
  createdAt: string;
  handledAt?: string;
  rawEventName?: string;
}

export interface WatchDatabase {
  version: 1;
  nextEventId: number;
  watches: Record<string, Watch>;
  events: WatchEvent[];
  deliveries: Record<string, number>;
}

export interface RegisterWatchInput {
  repo: string;
  prNumber: number;
  branch?: string;
  workspace?: string;
  threadLabel?: string;
  botLogin?: string;
  quietMinutes?: number;
  timeoutMinutes?: number;
  completeOnApproval?: boolean;
  completeOnThumbsUp?: boolean;
  completeOnQuiet?: boolean;
}

export interface IngestEventInput {
  repo: string;
  prNumber: number;
  githubDeliveryId?: string;
  githubNodeId?: string;
  kind: WatchEventKind;
  action?: string;
  author?: string;
  body?: string;
  url?: string;
  state?: string;
  reaction?: string;
  commitSha?: string;
  rawEventName?: string;
  createdAt?: string;
}

export interface ReviewDelta {
  watch: Watch;
  events: WatchEvent[];
  completed: boolean;
  completionReason?: CompletionReason;
}

export interface PullRequestSnapshot {
  headSha: string;
}

export interface IssueReactionSnapshot {
  content: string;
  userLogin?: string;
  createdAt: string;
}

export interface PullRequestReviewSnapshot {
  state: string;
  author?: string;
  commitSha?: string;
  submittedAt?: string;
}

export interface CodexReviewSignalClient {
  getPullRequest(repo: string, prNumber: number): Promise<PullRequestSnapshot>;
  listIssueReactions(repo: string, prNumber: number): Promise<IssueReactionSnapshot[]>;
  listPullRequestReviews(repo: string, prNumber: number): Promise<PullRequestReviewSnapshot[]>;
  createIssueComment(repo: string, prNumber: number, body: string): Promise<{ url?: string }>;
}
