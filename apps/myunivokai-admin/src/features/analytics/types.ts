// Mirrors contracts/go/contracts_analytics.go. Every one of these shapes is
// computed by analytics-service in SQL and relayed unchanged by the gateway —
// this app renders numbers, it never derives them.

export type WorldFamily = "universe" | "nature";
export type JobStatus = "queued" | "processing" | "completed" | "failed";

// Kept in step with contracts.AnalyticsDefaultPageSize / MaximumPageSize.
// analytics-service clamps to the same bounds server-side, so a mismatch here
// degrades the page-size picker rather than breaking a query.
export const PAGE_SIZE_OPTIONS = [25, 50, 100] as const;
export const DEFAULT_PAGE_SIZE = 25;

export interface TraitScores {
  creativity: number;
  discipline: number;
  curiosity: number;
  energy: number;
  focus: number;
}

export interface DistributionSlice {
  value: string;
  count: number;
}

export interface FamilyTotals {
  family: WorldFamily;
  worldCount: number;
  publishedCount: number;
  variantCount: number;
  jobCount: number;
  failedJobCount: number;
}

export interface JobHealth {
  totalJobs: number;
  completedJobs: number;
  failedJobs: number;
  inFlightJobs: number;
  failureRatePercent: number;
  averageDurationMs: number;
  p95DurationMs: number;
  slowestDurationMs: number;
  measuredJobCount: number;
  publishRatePercent: number;
  multiVariantPercent: number;
}

export interface Overview {
  days: number;
  totalWorlds: number;
  totalPublished: number;
  worldsInWindow: number;
  families: FamilyTotals[];
  jobHealth: JobHealth;
  archetypeTop: DistributionSlice[];
  worldStyleTop: DistributionSlice[];
  moodTop: DistributionSlice[];
  errorCodeTop: DistributionSlice[];
  averageTraitScores: TraitScores;
  generatedAt: string;
  oldestProjectedWorld?: string;
}

export interface TimeseriesPoint {
  day: string;
  worldCount: number;
  publishedCount: number;
  jobCount: number;
  failedJobCount: number;
}

export interface Timeseries {
  days: number;
  points: TimeseriesPoint[];
}

export interface WorldProjection {
  worldId: string;
  family: WorldFamily;
  nickname: string;
  role?: string;
  archetype: string;
  sceneName: string;
  mood: string;
  worldStyle: string;
  favoriteColors: string[];
  traitScores: TraitScores;
  variantCount: number;
  selectedVariantNo: number;
  isPublished: boolean;
  publishedAt?: string;
  revision: number;
  sourceJobId: string;
  worldCreatedAt: string;
  projectedAt: string;
}

export interface WorldPage {
  worlds: WorldProjection[];
  nextCursor?: string;
  totalCount: number;
  pageSize: number;
}

export interface JobProjection {
  jobId: string;
  family?: WorldFamily;
  status: JobStatus;
  errorCode?: string;
  errorMessage?: string;
  worldId?: string;
  profileId?: string;
  dnaVersionId?: string;
  createdAt: string;
  completedAt?: string;
  durationMs?: number;
}

export interface JobPage {
  jobs: JobProjection[];
  nextCursor?: string;
  totalCount: number;
  pageSize: number;
}

export interface WorldListFilters {
  family?: WorldFamily | "";
  worldStyle?: string;
  mood?: string;
  published?: "true" | "false" | "";
}

export interface JobListFilters {
  family?: WorldFamily | "";
  status?: JobStatus | "";
}
