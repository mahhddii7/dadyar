import type { Citation, PublicSource, QueryPlan, SourceKind } from "@/server/storage/types";

export interface ChatResponse {
  answer: string;
  result: unknown;
  plan: QueryPlan;
  sources: Array<{ id: string; name: string; kind: SourceKind; rowCount?: number }>;
  citations: Citation[];
  matchedRows: number;
  usedModel: boolean;
  modelIssue?: string;
  modelAvailable: boolean;
  note?: string;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  response?: ChatResponse;
}

export type Source = PublicSource;
