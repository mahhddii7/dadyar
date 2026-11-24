import type { Citation } from "@/server/storage/types";

export interface EvidenceResult {
  id: string;
  tool: string;
  description: string;
  data: unknown;
  citations: Citation[];
  coverage: {
    scannedRows: number;
    matchedRows: number;
    returnedRows: number;
    totalResultRows: number;
    completeInput: boolean;
    limitedOutput: boolean;
  };
  warnings: string[];
}

export interface AnalysisReport {
  type: "analysis_report";
  status: "answered" | "clarification" | "limited" | "model_error";
  evidence: EvidenceResult[];
  steps: number;
  unreviewedSources: string[];
}
