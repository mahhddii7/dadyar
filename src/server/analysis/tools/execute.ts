import type { EvidenceResult } from "@/types/analysis";
import type { SourceFile, TableRow } from "../../storage/types";
import { cellText, exactColumn, isEmpty, normalizeText, numberValue } from "../values";
import { requireDataset, type Dataset } from "./datasets";
import { runQuery } from "./query";
import { toolSchema, type ToolCall } from "./schema";

export function documentChunks(source: SourceFile) {
  const sections = source.sections?.length ? source.sections : [{ text: source.text ?? "", label: "متن" }];
  const chunks: Array<{ number: number; text: string; page?: number; label?: string }> = [];
  for (const section of sections) {
    for (let start = 0; start < section.text.length; start += 1400) {
      chunks.push({ number: chunks.length + 1, text: section.text.slice(start, start + 1400), page: section.page, label: section.label });
    }
  }
  return chunks;
}

function profile(call: Extract<ToolCall, { type: "profile" }>, datasets: Map<string, Dataset>, id: string): EvidenceResult {
  const items = [...new Set(call.datasetIds)].map(key => requireDataset(datasets, key));
  const warnings: string[] = [];
  const data = items.map(item => {
    const columns = call.columns ? call.columns.map(column => exactColumn(column, item.columns)) : item.columns.slice(0, 20);
    if (columns.length < item.columns.length) warnings.push(`${item.label}: آمار ${columns.length} ستون از ${item.columns.length} ستون گزارش شد؛ ستون‌های دیگر را جدا درخواست کنید.`);
    return { datasetId: item.id, file: item.label, rows: item.rows.length, columns: item.columns, statistics: columns.map(column => {
      let missing = 0, numeric = 0, sum = 0, correction = 0, min = Infinity, max = -Infinity;
      const frequencies = new Map<string, { value: string; count: number }>();
      for (const row of item.rows) {
        const value = row[column];
        if (isEmpty(value)) { missing++; continue; }
        const key = normalizeText(cellText(value));
        const current = frequencies.get(key) ?? { value: cellText(value), count: 0 }; current.count++;
        frequencies.set(key, current);
        const number = numberValue(value);
        if (number !== null) {
          numeric++;
          const add = number - correction, next = sum + add;
          correction = (next - sum) - add; sum = next;
          min = Math.min(min, number); max = Math.max(max, number);
        }
      }
      const identifier = /(شناسه|شماره|کد|پلاک|تاریخ|طبقه|floor|date|code|(^|[_\s])id($|[_\s]))/iu.test(column);
      const safe = numeric > 0 && !identifier && Number.isFinite(sum) && Math.abs(sum) <= Number.MAX_SAFE_INTEGER;
      return { column, populated: item.rows.length - missing, missing, missingPercent: item.rows.length ? missing / item.rows.length * 100 : null, distinct: frequencies.size, numericValues: numeric,
        ...(safe ? { numeric: { sum: Number.isSafeInteger(sum) ? sum : Number(sum.toPrecision(15)), min, max, average: Number.isSafeInteger(sum / numeric) ? sum / numeric : Number((sum / numeric).toPrecision(15)) } } : {}),
        ...(frequencies.size <= 50 ? { top: [...frequencies.values()].sort((a, b) => b.count - a.count).slice(0, 5).map(entry => ({ ...entry, value: entry.value.slice(0, 200), percentOfRows: entry.count / item.rows.length * 100 })) } : {}),
      };
    }) };
  });
  const total = items.reduce((sum, item) => sum + item.rows.length, 0);
  return { id, tool: "profile", description: "آمار ستون‌ها از همهٔ ردیف‌های جدول‌های درخواست‌شده", data,
    citations: items.flatMap(item => item.citations), warnings,
    coverage: { scannedRows: total, matchedRows: total, returnedRows: data.length, totalResultRows: data.length, completeInput: items.every(item => item.complete), limitedOutput: false } };
}

function compare(call: Extract<ToolCall, { type: "compare" }>, datasets: Map<string, Dataset>, id: string): EvidenceResult {
  const left = requireDataset(datasets, call.left), right = requireDataset(datasets, call.right);
  if (left.id === right.id) throw new Error("دو جدول متفاوت برای مقایسه انتخاب کنید.");
  const leftKey = exactColumn(call.key, left.columns), rightKey = exactColumn(call.key, right.columns);
  const columns = (call.columns.length ? call.columns : left.columns.filter(c => c !== leftKey && right.columns.includes(c)))
    .map(column => ({ left: exactColumn(column, left.columns), right: exactColumn(column, right.columns) }));
  if (!columns.length) throw new Error("ستون مشترکی برای مقایسهٔ مقدارها وجود ندارد؛ برای بررسی وجود کلیدها از اتصال استفاده کنید.");
  const index = (rows: TableRow[], key: string) => {
    const map = new Map<string, TableRow[]>(); let empty = 0;
    for (const row of rows) {
      if (isEmpty(row[key])) { empty++; continue; }
      const value = normalizeText(cellText(row[key]));
      if (!map.has(value)) map.set(value, []); map.get(value)!.push(row);
    }
    return { map, empty };
  };
  const a = index(left.rows, leftKey), b = index(right.rows, rightKey);
  let same = 0, different = 0, onlyLeft = 0, onlyRight = 0, ambiguous = 0;
  const differences: TableRow[] = [], leftOnly: TableRow[] = [], rightOnly: TableRow[] = [], duplicates: TableRow[] = [];
  for (const key of new Set([...a.map.keys(), ...b.map.keys()])) {
    const l = a.map.get(key), r = b.map.get(key);
    if ((l?.length ?? 0) > 1 || (r?.length ?? 0) > 1) { ambiguous++; duplicates.push({ key, leftCount: l?.length ?? 0, rightCount: r?.length ?? 0 }); continue; }
    if (!l) { onlyRight++; rightOnly.push(r![0]); continue; } if (!r) { onlyLeft++; leftOnly.push(l[0]); continue; }
    const changes = columns.filter(c => normalizeText(cellText(l[0][c.left])) !== normalizeText(cellText(r[0][c.right])));
    if (!changes.length) same++;
    else { different++; differences.push({ key, leftRow: l[0].__row, rightRow: r[0].__row, changes: changes.map(c => ({ column: c.left, left: l[0][c.left], right: r[0][c.right] })) }); }
  }
  const derived = [
    { suffix: "changes", rows: differences, columns: ["key", "leftRow", "rightRow", "changes"] },
    { suffix: "left_only", rows: leftOnly, columns: left.columns },
    { suffix: "right_only", rows: rightOnly, columns: right.columns },
    { suffix: "duplicates", rows: duplicates, columns: ["key", "leftCount", "rightCount"] },
  ];
  for (const result of derived) datasets.set(`${id}:${result.suffix}`, { id: `${id}:${result.suffix}`, label: `${left.label} ↔ ${right.label} / ${result.suffix}`, rows: result.rows, columns: result.columns, citations: [...left.citations, ...right.citations], complete: left.complete && right.complete });
  const examples = differences.slice(0, 20);
  return { id, tool: "compare", description: `${left.label} ↔ ${right.label}`, data: { same, different, onlyLeft, onlyRight, ambiguousKeys: ambiguous, emptyKeysLeft: a.empty, emptyKeysRight: b.empty, comparedColumns: columns.map(c => c.left), examples,
    reusableDatasets: derived.map(result => ({ id: `${id}:${result.suffix}`, columns: result.columns, rows: result.rows.length })) },
    citations: [...left.citations, ...right.citations], warnings: ambiguous ? [`${ambiguous} کلید تکراری از تطبیق کنار گذاشته شد؛ قاعدهٔ رفع تکرار لازم است.`] : [],
    coverage: { scannedRows: left.rows.length + right.rows.length, matchedRows: same + different, returnedRows: examples.length, totalResultRows: different, completeInput: left.complete && right.complete, limitedOutput: different > examples.length } };
}

export function executeTool(input: unknown, datasets: Map<string, Dataset>, sources: SourceFile[], id: string): EvidenceResult {
  const call = toolSchema.parse(input);
  if (call.type === "query") return runQuery(call, datasets, id);
  if (call.type === "profile") return profile(call, datasets, id);
  if (call.type === "compare") return compare(call, datasets, id);
  const ids = call.type === "read_document" ? [call.sourceId] : [...new Set(call.sourceIds)];
  const documents = ids.map(key => {
    const source = sources.find(source => source.id === key && (source.text || source.sections?.length));
    if (!source) throw new Error(`سند «${key}» متن قابل خواندن ندارد یا انتخاب نشده است.`);
    return source;
  });
  const chunks = documents.flatMap(source => documentChunks(source).map(chunk => ({ ...chunk, source })));
  const terms = call.type === "search_documents" ? [...new Set(normalizeText(call.query).split(/[^\p{L}\p{N}]+/u).filter(word => word.length >= 2 && !["از", "به", "در", "که", "این", "چه", "را", "با"].includes(word)))] : [];
  const chosen = call.type === "read_document" ? chunks.slice(call.start - 1, call.start - 1 + call.count)
    : chunks.map(chunk => ({ chunk, score: terms.reduce((sum, term) => sum + (normalizeText(chunk.text).includes(term) ? 1 : 0), 0) }))
      .filter(item => item.score > 0).sort((a, b) => b.score - a.score).slice(0, call.limit).map(item => item.chunk);
  const complete = documents.every(source => source.extraction?.complete ?? !(source.warnings ?? []).some(w => /بریده|استخراج نشد/.test(w)));
  return { id, tool: call.type, description: documents.map(source => source.name).join("، "),
    data: { totalChunks: chunks.length, chunks: chosen.map(chunk => ({ sourceId: chunk.source.id, file: chunk.source.name, section: chunk.number, page: chunk.page, label: chunk.label, text: chunk.text })),
      ...(call.type === "read_document" ? { nextStart: call.start - 1 + chosen.length < chunks.length ? call.start + chosen.length : null } : {}) },
    citations: chosen.map(chunk => ({ sourceId: chunk.source.id, sourceName: chunk.source.name, sectionNumber: chunk.number, page: chunk.page, excerpt: chunk.text.slice(0, 180) })),
    warnings: chosen.length < chunks.length ? ["شواهد این مرحله گزیده‌ای از سند است؛ برای ادعای پوشش کامل، بخش‌های باقی‌مانده باید خوانده شوند."] : [],
    coverage: { scannedRows: 0, matchedRows: chosen.length, returnedRows: chosen.length, totalResultRows: chunks.length, completeInput: complete, limitedOutput: chosen.length < chunks.length } };
}
