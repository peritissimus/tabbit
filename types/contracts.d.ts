export type BuildStatus = "running" | "idle" | "failed";
export interface BuildState {
  status: BuildStatus;
  phase: string | null;
  attempt?: number;
  startedAt?: number;
  finishedAt?: number;
  phaseStartedAt?: number | null;
  durationMs?: number;
  timings?: Record<string, number>;
  scrapeWindowId?: number | null;
  error?: string;
  pageCount?: number;
  sourceCount?: number;
}
export interface AiSettings {
  provider: "openai" | "codex" | "claude";
  apiKey: string;
  claudeModel?: string;
  claudeBriefModel?: string;
  model: string;
  briefModel: string;
  context: string;
  modelRoutingVersion: number;
}
export interface ChatMessage {
  role: string;
  content: string;
}
export type AiTask = "selection" | "brief" | "grouping";
export interface BuildJob {
  set(patch: Partial<BuildState>): Promise<void>;
  start(
    run: (attempt: number) => Promise<void>,
    attempt?: number,
  ): Promise<void>;
  reset(): void;
  restore(value: BuildState): void;
  readonly state: BuildState | null;
  readonly running: boolean;
}
export interface KeyValueStorage {
  get(key: string): Promise<Record<string, unknown>>;
  set(values: Record<string, unknown>): Promise<void>;
}
