import "server-only";

import type { AnalysisResult, Citation, QueryFilter, QueryPlan, SourceFile, TableRow } from "../storage/types";
import { planSeating } from "./seating";
import type { SeatMappings } from "@/types/seating";
import { retrieveDocumentEvidence, retrieveTableEvidence } from "./retrieval";
import { profileSources } from "./profile";

function normalize(value: unknown) {
  return String(value ?? "").normalize("NFKC").replace(/[\u064A\u0649]/g, "ی").replace(/\u0643/g, "ک").replace(/[\u200c\s\u0640]+/g, "").toLowerCase();
}

function numeric(value: unknown): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  const source = String(value ?? "").trim();
  const digits = source.replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  if (/^\d{2,4}[/-]\d{1,2}[/-]\d{1,4}(?:$|[T\s])/u.test(digits)) return null;
  const cleaned = digits
    .replace(/[٫]/g, ".")
    .replace(/[٬،]/g, ",")
    .replace(/\s*(?:ریال|تومان|عدد|روز|ساعت|دقیقه|متر|کیلوگرم|کیلو|گرم|دستگاه|قلم|درصد)\s*$/u, "")
    .replace(/\s+/g, "");
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/u.test(cleaned) || !/[0-9]/.test(cleaned)) return null;
  const parsed = Number(cleaned.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : null;
}

function hasCellValue(value: unknown) {
  return value !== null && value !== undefined && String(value).trim() !== "";
}

function resolveColumn(requested: string | null | undefined, columns: string[], question: string): string | null {
  if (requested) {
    const requestedKey = normalize(requested);
    const exact = columns.find((item) => normalize(item) === requestedKey);
    if (exact) return exact;
    const fuzzy = columns.filter((item) => normalize(item).includes(requestedKey) || requestedKey.includes(normalize(item)));
    if (fuzzy.length === 1) return fuzzy[0];
  }
  const numericIntent = /(جمع|مجموع|میانگین|متوسط|بیشترین|کمترین)/u.test(question);
  if (numericIntent) {
    const candidates = columns.filter((item) => /(مبلغ|قیمت|تعداد|مقدار|روز|زمان|هزینه|ارزش|عدد|جمع|بهای|درصد)/u.test(item));
    return candidates.length === 1 ? candidates[0] : null;
  }
  return null;
}

function matchesFilter(row: TableRow, filter: QueryFilter, columns: string[]) {
  const column = resolveColumn(filter.column, columns, "");
  if (!column) return false;
  const actual = row[column];
  if (filter.operator === "contains") return normalize(actual).includes(normalize(filter.value));
  if (filter.operator === "eq") return normalize(actual) === normalize(filter.value);
  if (filter.operator === "neq") return normalize(actual) !== normalize(filter.value);
  const left = numeric(actual);
  const right = numeric(filter.value);
  if (left === null || right === null) return false;
  if (filter.operator === "gt") return left > right;
  if (filter.operator === "gte") return left >= right;
  if (filter.operator === "lt") return left < right;
  return left <= right;
}

function sourceCitation(source: SourceFile, rows: TableRow[], excerpt?: string, includeRow = true): Citation {
  const row = rows[0];
  return {
    sourceId: source.id,
    sourceName: source.name,
    ...(includeRow && row?.__sheet ? { sheet: String(row.__sheet) } : {}),
    ...(includeRow && row?.__row ? { rowNumber: Number(row.__row) } : {}),
    ...(rows.length ? { matchedRows: rows.length } : {}),
    ...(excerpt ? { excerpt } : {}),
  };
}

function normalizedKey(value: unknown) {
  return normalize(value).replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit))).replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit))).trim();
}

function comparableValue(value: unknown) {
  if (value === null || value === undefined) return "";
  if (typeof value === "number") return Number.isFinite(value) ? String(value) : "";
  return normalizedKey(value);
}

function compareTables(
  tables: SourceFile[],
  keyColumn: string | null | undefined,
  compareColumns: string[] | undefined,
): { data: unknown; citations: Citation[]; matchedRows: number; note?: string } {
  if (tables.length !== 2) return { data: null, citations: [], matchedRows: 0, note: "برای مقایسه، دقیقاً دو فایل جدولی را انتخاب کنید." };
  const [left, right] = tables;
  const sharedColumns = (left.columns ?? []).filter((column) => (right.columns ?? []).some((item) => normalize(item) === normalize(column)));
  const resolvedKey = keyColumn ? sharedColumns.find((column) => normalize(column) === normalize(keyColumn)) : undefined;
  if (!resolvedKey) return { data: null, citations: [], matchedRows: 0, note: "ستون کلید مشترک پیدا نشد؛ نام ستون مشترک برای تطبیق را مشخص کنید، مثل شماره درخواست یا کد کالا." };
  const columns = (compareColumns ?? []).map((requested) => sharedColumns.find((column) => normalize(column) === normalize(requested))).filter((value): value is string => typeof value === "string" && normalize(value) !== normalize(resolvedKey));
  if (!columns.length) return { data: null, citations: [], matchedRows: 0, note: "ستون مشترکی برای مقایسه پیدا نشد؛ نام ستون‌هایی را که باید مقایسه شوند مشخص کنید." };

  const indexRows = (source: SourceFile) => {
    const index = new Map<string, TableRow[]>();
    const sourceKey = (source.columns ?? []).find((column) => normalize(column) === normalize(resolvedKey))!;
    for (const row of source.rows ?? []) {
      const key = normalizedKey(row[sourceKey]);
      if (!key) continue;
      const bucket = index.get(key);
      if (bucket) bucket.push(row);
      else index.set(key, [row]);
    }
    return index;
  };
  const leftIndex = indexRows(left);
  const rightIndex = indexRows(right);
  const duplicateLeft = [...leftIndex.entries()].filter(([, rows]) => rows.length > 1);
  const duplicateRight = [...rightIndex.entries()].filter(([, rows]) => rows.length > 1);
  const ambiguous = new Set([...duplicateLeft, ...duplicateRight].map(([key]) => key));
  const differences: Array<{ key: string; leftRow: number; rightRow: number; leftSheet?: string; rightSheet?: string; columns: Array<{ column: string; left: unknown; right: unknown }> }> = [];
  const leftOnly: Array<{ key: string; rowNumber: number; sheet?: string }> = [];
  const rightOnly: Array<{ key: string; rowNumber: number; sheet?: string }> = [];
  let matchedKeys = 0;
  let changedKeys = 0;

  for (const [key, leftRows] of leftIndex) {
    if (ambiguous.has(key)) continue;
    const rightRows = rightIndex.get(key);
    if (!rightRows) {
      const row = leftRows[0];
      leftOnly.push({ key, rowNumber: Number(row.__row ?? 0), ...(row.__sheet ? { sheet: String(row.__sheet) } : {}) });
      continue;
    }
    if (rightRows.length !== 1) continue;
    matchedKeys += 1;
    const leftRow = leftRows[0];
    const rightRow = rightRows[0];
    const changed = columns.flatMap((column) => {
      const rightColumn = (right.columns ?? []).find((item) => normalize(item) === normalize(column))!;
      const leftValue = leftRow[column];
      const rightValue = rightRow[rightColumn];
      return comparableValue(leftValue) === comparableValue(rightValue) ? [] : [{ column, left: leftValue ?? null, right: rightValue ?? null }];
    });
    if (changed.length) {
      changedKeys += 1;
      differences.push({ key, leftRow: Number(leftRow.__row ?? 0), rightRow: Number(rightRow.__row ?? 0), ...(leftRow.__sheet ? { leftSheet: String(leftRow.__sheet) } : {}), ...(rightRow.__sheet ? { rightSheet: String(rightRow.__sheet) } : {}), columns: changed });
    }
  }

  for (const [key, rightRows] of rightIndex) {
    if (ambiguous.has(key) || leftIndex.has(key)) continue;
    const row = rightRows[0];
    rightOnly.push({ key, rowNumber: Number(row.__row ?? 0), ...(row.__sheet ? { sheet: String(row.__sheet) } : {}) });
  }

  const citations: Citation[] = [];
  const addCitation = (source: SourceFile, rowNumber?: number, sheet?: string) => {
    const key = `${source.id}:${sheet ?? ""}:${rowNumber ?? ""}`;
    if (citations.some((item) => `${item.sourceId}:${item.sheet ?? ""}:${item.rowNumber ?? ""}` === key)) return;
    citations.push({ sourceId: source.id, sourceName: source.name, ...(rowNumber ? { rowNumber } : {}), ...(sheet ? { sheet } : {}) });
  };
  for (const item of differences.slice(0, 3)) {
    addCitation(left, item.leftRow, item.leftSheet);
    addCitation(right, item.rightRow, item.rightSheet);
  }
  for (const item of leftOnly.slice(0, 2)) addCitation(left, item.rowNumber, item.sheet);
  for (const item of rightOnly.slice(0, 2)) addCitation(right, item.rowNumber, item.sheet);

  return {
    data: {
      type: "file_comparison",
      left: { id: left.id, name: left.name, rows: left.rowCount ?? left.rows?.length ?? 0 },
      right: { id: right.id, name: right.name, rows: right.rowCount ?? right.rows?.length ?? 0 },
      keyColumn: resolvedKey,
      compareColumns: columns,
      summary: {
        matchedKeys,
        identicalKeys: matchedKeys - changedKeys,
        changedKeys,
        onlyLeft: leftOnly.length,
        onlyRight: rightOnly.length,
        duplicateKeysLeft: duplicateLeft.length,
        duplicateKeysRight: duplicateRight.length,
        rowsWithoutKeyLeft: (left.rows ?? []).filter((row) => !normalizedKey(row[resolvedKey])).length,
        rowsWithoutKeyRight: (right.rows ?? []).filter((row) => !normalizedKey(row[(right.columns ?? []).find((item) => normalize(item) === normalize(resolvedKey))!])).length,
      },
      differences: differences.slice(0, 100),
      leftOnly: leftOnly.slice(0, 100),
      rightOnly: rightOnly.slice(0, 100),
      duplicateKeysLeft: duplicateLeft.slice(0, 50).map(([key]) => key),
      duplicateKeysRight: duplicateRight.slice(0, 50).map(([key]) => key),
      truncated: differences.length > 100 || leftOnly.length > 100 || rightOnly.length > 100,
    },
    citations,
    matchedRows: matchedKeys,
  };
}

function matchedSourceRows(sources: SourceFile[], filters: QueryFilter[]) {
  return sources.flatMap((source) => {
    const rows = (source.rows ?? []).filter((row) => filters.every((filter) => matchesFilter(row, filter, source.columns ?? Object.keys(row))));
    return rows.map((row) => ({ source, row }));
  });
}

export function executePlan(question: string, plan: QueryPlan, sources: SourceFile[], seatMappings: SeatMappings = {}): AnalysisResult {
  const sourceIds = new Set(plan.sourceIds?.length ? plan.sourceIds : sources.map((source) => source.id));
  const scopedSources = sources.filter((source) => sourceIds.has(source.id));
  if (plan.intent === "unknown") {
    const tableNames = sources.filter((source) => source.kind === "table").map((source) => `«${source.name}»`);
    const fileHint = tableNames.length > 1 ? ` فایل‌های جدولی انتخاب‌شده: ${tableNames.join("، ")}.` : "";
    return { plan, answerData: null, citations: [], matchedRows: 0, note: `برای جلوگیری از ترکیب داده‌های نامرتبط، نام فایل و ستون موردنظر را در سؤال مشخص کنید.${fileHint} برای مقایسه، دو فایل و ستون کلید مشترک لازم است.` };
  }
  const tables = scopedSources.filter((source) => source.kind === "table");
  if (plan.intent === "seat_release") return planSeating(question, plan, tables, seatMappings);
  const columns = [...new Set(tables.flatMap((source) => source.columns ?? []))];
  const selectedColumn = resolveColumn(plan.column, columns, question);
  const filters = (plan.filters ?? []).filter((filter) => columns.some((column) => normalize(column) === normalize(filter.column)));
  const records = matchedSourceRows(tables, filters);
  const rows = records.map((item) => item.row);
  const limit = Math.min(Math.max(plan.limit ?? 20, 1), 100);
  const sourcesWithRows = (sourceId: string) => records.filter((item) => item.source.id === sourceId).map((item) => item.row);

  if (plan.intent === "compare") {
    const result = compareTables(tables, plan.keyColumn, plan.compareColumns);
    return { plan, answerData: result.data, citations: result.citations, matchedRows: result.matchedRows, note: result.note };
  }

  if (plan.intent === "table_answer") {
    const retrieval = retrieveTableEvidence(question, tables, limit);
    const evidence = retrieval.evidence.map((item) => ({ id: item.id, sourceId: item.sourceId, file: item.file, sectionNumber: item.sectionNumber, rowNumber: item.rowNumber, sheet: item.sheet, excerpt: item.excerpt }));
    const citations: Citation[] = retrieval.evidence.map((item) => ({
      sourceId: item.sourceId,
      sourceName: item.file,
      ...(item.rowNumber ? { rowNumber: item.rowNumber } : {}),
      ...(item.sheet ? { sheet: item.sheet } : {}),
      excerpt: item.excerpt.slice(0, 180),
    }));
    const note = !evidence.length
      ? `در ردیف‌های جدول واژهٔ مرتبطی پیدا نشد. ستون‌های موجود: ${[...new Set(tables.flatMap((source) => source.columns ?? []))].join("، ") || "نامشخص"}. نام ساختمان، طبقه یا ستون ظرفیت را دقیق‌تر بنویسید.`
      : evidence.length < retrieval.totalRows
        ? `برای پاسخ، ${evidence.length.toLocaleString("fa-IR")} ردیف مرتبط از مجموع ${retrieval.totalRows.toLocaleString("fa-IR")} ردیف بازیابی شد؛ این گزیده مبنای رتبه‌بندی کل جدول نیست.`
        : undefined;
    return { plan, answerData: evidence, citations, matchedRows: retrieval.candidateRows, note };
  }

  if (plan.intent === "schema") {
    const schema = scopedSources.map((source) => ({ file: source.name, kind: source.kind, rows: source.rowCount ?? 0, columns: source.columns ?? [], sheets: source.sheets ?? [] }));
    return { plan, answerData: schema, citations: scopedSources.map((source) => sourceCitation(source, sourcesWithRows(source.id), undefined, false)), matchedRows: rows.length };
  }

  if (plan.intent === "summarize") {
    const summary = profileSources(scopedSources);
    return { plan, answerData: summary, citations: scopedSources.map((source) => sourceCitation(source, sourcesWithRows(source.id), undefined, false)), matchedRows: rows.length };
  }

  if (["count", "grouped_count", "sum", "average", "min", "max", "grouped_sum"].includes(plan.intent)) {
    if (["sum", "average", "min", "max", "grouped_sum"].includes(plan.intent) && !selectedColumn) {
      return { plan, answerData: null, citations: [], matchedRows: rows.length, note: "ستون عددی مشخص نشد؛ نام دقیق ستونی را که می‌خواهید تحلیل شود بنویسید." };
    }
    if ((plan.intent === "grouped_count" || plan.intent === "grouped_sum") && !plan.groupBy) {
      return { plan, answerData: null, citations: [], matchedRows: rows.length, note: "برای تفکیک، نام ستون گروه‌بندی هم لازم است." };
    }
    if (plan.intent === "count") {
      return {
        plan,
        answerData: { count: selectedColumn ? rows.filter((row) => hasCellValue(row[selectedColumn])).length : rows.length, column: selectedColumn },
        citations: tables.filter((source) => sourcesWithRows(source.id).length).map((source) => sourceCitation(source, sourcesWithRows(source.id), undefined, false)),
        matchedRows: rows.length,
      };
    }
    if (plan.intent === "grouped_count" || plan.intent === "grouped_sum") {
      const groupBy = resolveColumn(plan.groupBy, columns, question);
      if (!groupBy) return { plan, answerData: null, citations: [], matchedRows: rows.length, note: "ستون گروه‌بندی در فایل پیدا نشد." };
      const grouped = new Map<string, { value: unknown; count: number; sum: number; numericValues: number; excludedValues: number }>();
      for (const row of rows) {
        const value = row[groupBy] ?? "(خالی)";
        const key = String(value);
        const current = grouped.get(key) ?? { value, count: 0, sum: 0, numericValues: 0, excludedValues: 0 };
        current.count += 1;
        if (plan.intent === "grouped_sum" && selectedColumn) {
          const amount = numeric(row[selectedColumn]);
          if (amount === null) current.excludedValues += 1;
          else { current.sum += amount; current.numericValues += 1; }
        }
        grouped.set(key, current);
      }
      const data = [...grouped.values()].map((item) => ({ group: item.value, count: item.count, ...(plan.intent === "grouped_sum" ? { sum: item.sum, numericValues: item.numericValues, excludedValues: item.excludedValues } : {}) }));
      data.sort((a, b) => plan.intent === "grouped_sum" ? (b.sum ?? 0) - (a.sum ?? 0) : b.count - a.count);
      return { plan: { ...plan, groupBy }, answerData: data.slice(0, limit), citations: tables.filter((source) => sourcesWithRows(source.id).length).map((source) => sourceCitation(source, sourcesWithRows(source.id), undefined, false)), matchedRows: rows.length };
    }
    const values = rows.map((row) => numeric(row[selectedColumn!])).filter((value): value is number => value !== null);
    const result = plan.intent === "sum" ? values.reduce((sum, value) => sum + value, 0)
      : plan.intent === "average" ? (values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null)
        : plan.intent === "min" ? (values.length ? Math.min(...values) : null)
          : plan.intent === "max" ? (values.length ? Math.max(...values) : null) : null;
    return { plan, answerData: { value: result, column: selectedColumn, numericValues: values.length, excludedValues: rows.length - values.length }, citations: tables.filter((source) => sourcesWithRows(source.id).length).map((source) => sourceCitation(source, sourcesWithRows(source.id), undefined, false)), matchedRows: rows.length };
  }

  if (plan.intent === "search" || plan.intent === "list") {
    const term = plan.searchText ? normalize(plan.searchText) : normalize(question);
    const searchTerms = term.split(/[^\p{L}\p{N}]+/u).filter((item) => item.length > 1);
    const matched = records.filter(({ row }) => !searchTerms.length || Object.entries(row).some(([key, value]) => !key.startsWith("__") && searchTerms.some((part) => normalize(value).includes(part))));
    return {
      plan,
      answerData: matched.slice(0, limit).map(({ row, source }) => ({ file: source.name, sheet: row.__sheet, row: row.__row, data: row })),
      citations: matched.slice(0, limit).map(({ source, row }) => sourceCitation(source, [row])),
      matchedRows: matched.length,
    };
  }

  const textSources = scopedSources.filter((source) => source.kind === "document" && source.text);
  const selected = retrieveDocumentEvidence(question, textSources);
  return {
    plan: { ...plan, intent: "document_answer" },
    answerData: selected.map(({ id, sourceId, file, sectionNumber, excerpt }) => ({ id, sourceId, file, sectionNumber, excerpt })),
    citations: selected.map(({ sourceId, file, sectionNumber, excerpt }) => ({ sourceId, sourceName: file, sectionNumber, excerpt: excerpt.slice(0, 180) })),
    matchedRows: selected.length,
    note: selected.length ? undefined : "در فایل‌های انتخاب‌شده متن مرتبطی پیدا نشد. بررسی کنید فایل کامل بارگذاری شده باشد یا عبارت پرسش را ساده‌تر کنید.",
  };
}
