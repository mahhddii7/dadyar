export type TableRow = Record<string, unknown>;

export type SourceKind = "table" | "document";

export interface SourceFile {
  id: string;
  name: string;
  kind: SourceKind;
  mimeType: string;
  size: number;
  uploadedAt: string;
  rows?: TableRow[];
  columns?: string[];
  text?: string;
  sheets?: string[];
  rowCount?: number;
  warnings?: string[];
  sheetColumns?: Record<string, string[]>;
  sections?: Array<{ text: string; page?: number; label?: string }>;
  extraction?: { complete: boolean; method: string; notes?: string[] };
  hasOriginal?: boolean;
  contentHash?: string;
}

export type PublicSource = Omit<SourceFile, "rows" | "text" | "sections"> & {
  preview?: TableRow[];
  previewText?: string;
};

export interface QueryFilter {
  column: string;
  operator: "eq" | "contains" | "gt" | "gte" | "lt" | "lte" | "neq";
  value: string | number | boolean;
}

export interface QueryPlan {
  intent:
    | "assistant_info"
    | "analysis"
    | "count"
    | "sum"
    | "average"
    | "min"
    | "max"
    | "grouped_count"
    | "grouped_sum"
    | "compare"
    | "list"
    | "search"
    | "schema"
    | "summarize"
    | "document_answer"
    | "seat_release"
    | "table_answer"
    | "unknown";
  column?: string | null;
  groupBy?: string | null;
  sourceIds?: string[];
  keyColumn?: string | null;
  compareColumns?: string[];
  filters?: QueryFilter[];
  searchText?: string | null;
  limit?: number;
}

export interface Citation {
  sourceId: string;
  sourceName: string;
  sheet?: string;
  rowNumber?: number;
  sectionNumber?: number;
  page?: number;
  matchedRows?: number;
  excerpt?: string;
}

export interface AnalysisResult {
  plan: QueryPlan;
  answerData: unknown;
  citations: Citation[];
  matchedRows: number;
  note?: string;
}
