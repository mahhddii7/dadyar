import type { EvidenceResult } from "@/types/analysis";
import type { TableRow } from "../../storage/types";
import { cellText, exactColumn, isEmpty, normalizeText, numberValue } from "../values";
import { requireDataset, type Dataset } from "./datasets";
import type { Filter, Query } from "./schema";
import { dateValue } from "../dates";

function checkedNumber(value: number) {
  if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("مقدار محاسبه از محدودهٔ دقت عددی برنامه خارج است؛ نتیجهٔ تقریبی گزارش نشد.");
  return Number.isSafeInteger(value) ? value : Number(value.toPrecision(15));
}

function equality(left: unknown, right: unknown) {
  if (isEmpty(left) || isEmpty(right)) return isEmpty(left) && isEmpty(right);
  return typeof right === "number" ? numberValue(left) === right : normalizeText(cellText(left)) === normalizeText(cellText(right));
}

export function compileFilters(filters: Filter[], columns: string[]) {
  return filters.map(filter => {
    const column = exactColumn(filter.column, columns);
    if (!["is_empty", "not_empty"].includes(filter.operator) && filter.value === undefined) throw new Error(`مقدار فیلتر «${column}» مشخص نیست.`);
    if (filter.operator === "in" && !Array.isArray(filter.value)) throw new Error("عملگر in به فهرست مقدارها نیاز دارد.");
    if (["gt", "gte", "lt", "lte"].includes(filter.operator) && numberValue(filter.value) === null) throw new Error(`مقدار مقایسهٔ عددی «${column}» معتبر نیست.`);
    return (row: TableRow) => {
      const actual = row[column];
      if (filter.operator === "is_empty") return isEmpty(actual);
      if (filter.operator === "not_empty") return !isEmpty(actual);
      if (filter.operator === "eq") return equality(actual, filter.value);
      if (filter.operator === "neq") return !equality(actual, filter.value);
      if (filter.operator === "in") return (filter.value as unknown[]).some(value => equality(actual, value));
      if (filter.operator === "contains" || filter.operator === "not_contains") {
        const contains = normalizeText(cellText(actual)).includes(normalizeText(cellText(filter.value)));
        return filter.operator === "contains" ? contains : !contains;
      }
      const left = numberValue(actual), right = numberValue(filter.value);
      if (left === null || right === null) return false;
      if (filter.operator === "gt") return left > right;
      if (filter.operator === "gte") return left >= right;
      if (filter.operator === "lt") return left < right;
      return left <= right;
    };
  });
}

function combinedDataset(query: Query, datasets: Map<string, Dataset>) {
  if (new Set(query.datasetIds).size !== query.datasetIds.length) throw new Error("جدول تکراری در محدودهٔ تحلیل درخواست شده است.");
  const items = query.datasetIds.map(id => requireDataset(datasets, id));
  const columns = [...items[0].columns];
  if (items.some(item => item.columns.length !== columns.length || item.columns.some(col => !columns.includes(col)))) {
    throw new Error("برای ترکیب عمودی، ستون‌های جدول‌ها باید یکسان باشند. جدول‌ها را جدا تحلیل کنید یا اتصال با کلید مشترک تعریف کنید.");
  }
  const rows = items.flatMap(item => item.rows.map(row => ({ ...row, __dataset: item.id })));
  return { id: "", label: items.map(item => item.label).join(" + "), columns, rows,
    citations: items.flatMap(item => item.citations), complete: items.every(item => item.complete) };
}

export function runQuery(query: Query, datasets: Map<string, Dataset>, id: string): EvidenceResult {
  const input = combinedDataset(query, datasets);
  if (!input.complete) throw new Error("حداقل یک فایل کامل استخراج نشده است؛ برای محاسبهٔ قابل اتکا، هشدار استخراج را رفع و فایل را دوباره بارگذاری کنید.");
  let rows: TableRow[] = input.rows;
  const columns = [...input.columns];
  let scannedRows = rows.length;
  const warnings: string[] = [];
  const audits: Record<string, unknown> = {};

  if (query.join) {
    const right = requireDataset(datasets, query.join.datasetId);
    if (!right.complete) throw new Error("جدول مقصد کامل استخراج نشده است و فعلاً برای اتصال قابل استفاده نیست.");
    const leftKey = exactColumn(query.join.leftKey, columns);
    const rightKey = exactColumn(query.join.rightKey, right.columns);
    const lookup = new Map<string, TableRow>();
    let missingKeys = 0;
    for (const row of right.rows) {
      if (isEmpty(row[rightKey])) { missingKeys++; continue; }
      const key = normalizeText(cellText(row[rightKey]));
      if (lookup.has(key)) throw new Error(`کلید «${rightKey}» در جدول مقصد تکراری است؛ اتصال می‌تواند تعداد و مبلغ را چندبرابر کند. ابتدا کلید یکتا یا قاعدهٔ تجمیع را مشخص کنید.`);
      lookup.set(key, row);
    }
    if (right.columns.some(column => columns.includes(`right.${column}`))) throw new Error("نام ستون حاصل از اتصال با ستون موجود تداخل دارد.");
    let unmatched = 0;
    rows = rows.flatMap(row => {
      const other = isEmpty(row[leftKey]) ? undefined : lookup.get(normalizeText(cellText(row[leftKey])));
      if (!other) unmatched++;
      if (!other && query.join!.kind === "inner") return [];
      return [{ ...row, ...Object.fromEntries(right.columns.map(column => [`right.${column}`, other?.[column] ?? null])) }];
    });
    columns.push(...right.columns.map(column => `right.${column}`));
    scannedRows += right.rows.length;
    input.citations.push(...right.citations);
    input.complete &&= right.complete;
    audits.join = { leftRows: input.rows.length, rightRows: right.rows.length, unmatchedLeft: unmatched, emptyRightKeys: missingKeys, kind: query.join.kind };
    if (unmatched || missingKeys) warnings.push(`اتصال: ${unmatched} ردیف مبدأ بدون تطبیق و ${missingKeys} کلید خالی در مقصد.`);
  }

  for (const derived of query.derive) {
    if (columns.includes(derived.name) || derived.name.startsWith("__")) throw new Error("نام ستون محاسباتی باید جدید باشد.");
    if (derived.operation === "date_diff_days" && !derived.calendar) throw new Error("برای اختلاف تاریخ، تقویم jalali یا gregorian باید صریح باشد.");
    if (derived.operation === "date_diff_days" && (typeof derived.left === "number" || typeof derived.right === "number")) throw new Error("اختلاف تاریخ به دو ستون تاریخ نیاز دارد.");
    const operand = (value: number | { column: string }) => typeof value === "number"
      ? () => value : ((column: string) => (row: TableRow) => derived.operation === "date_diff_days" ? dateValue(row[column], derived.calendar!) : numberValue(row[column]))(exactColumn(value.column, columns));
    const left = operand(derived.left), right = operand(derived.right);
    let excluded = 0;
    rows = rows.map(row => {
      const a = left(row), b = right(row);
      if (a === null || b === null || (["divide", "percent"].includes(derived.operation) && b === 0)) {
        excluded++; return { ...row, [derived.name]: null };
      }
      const value = derived.operation === "date_diff_days" ? (a - b) / 86400000 : derived.operation === "add" ? a + b : derived.operation === "subtract" ? a - b
        : derived.operation === "multiply" ? a * b : derived.operation === "percent" ? a / b * 100 : a / b;
      return { ...row, [derived.name]: checkedNumber(value) };
    });
    columns.push(derived.name);
    if (derived.operation === "date_diff_days") warnings.push(`«${derived.name}»: فاصلهٔ روز تقویمی محاسبه شد، نه روز کاری؛ ساعت‌های بدون منطقهٔ زمانی هم‌منطقه فرض شدند.`);
    if (excluded) warnings.push(`«${derived.name}»: ${excluded} ردیف به علت مقدار نامعتبر یا تقسیم بر صفر محاسبه نشد.`);
  }

  const predicates = compileFilters(query.filters, columns);
  for (const filter of query.filters.filter(filter => ["gt", "gte", "lt", "lte"].includes(filter.operator))) {
    const column = exactColumn(filter.column, columns);
    const invalid = rows.filter(row => numberValue(row[column]) === null).length;
    if (invalid) warnings.push(`فیلتر عددی «${column}»: ${invalid} مقدار خالی یا غیرعددی قابل مقایسه نبود.`);
  }
  rows = rows.filter(row => predicates.every(test => test(row)));
  const matchedRows = rows.length;
  const groupBy = query.groupBy.map(column => exactColumn(column, columns));
  const metricNames = query.metrics.map(metric => metric.name);
  if (new Set([...groupBy, ...metricNames]).size !== groupBy.length + metricNames.length || metricNames.some(n => n.startsWith("__"))) throw new Error("نام شاخص‌ها و گروه‌ها باید یکتا باشد.");
  const metrics = query.metrics.map(metric => ({ ...metric,
    column: metric.operation === "count" ? undefined : exactColumn(metric.column ?? "", columns) }));
  if (groupBy.length && !metrics.length) throw new Error("برای گروه‌بندی، شاخصی مثل شمارش یا جمع مشخص کنید.");

  let outputColumns = columns;
  if (metrics.length) {
    const groups = new Map<string, { values: unknown[]; rows: TableRow[] }>();
    if (!groupBy.length) groups.set("[]", { values: [], rows: [] });
    for (const row of rows) {
      const values = groupBy.map(column => row[column] ?? null);
      const key = JSON.stringify(values.map(value => isEmpty(value) ? null : normalizeText(cellText(value))));
      if (!groups.has(key)) groups.set(key, { values, rows: [] });
      groups.get(key)!.rows.push(row);
    }
    const excluded: Record<string, number> = Object.create(null);
    rows = [...groups.values()].map(group => {
      const result: TableRow = Object.fromEntries(groupBy.map((column, i) => [column, group.values[i]]));
      for (const metric of metrics) {
        if (metric.operation === "count") { result[metric.name] = group.rows.length; continue; }
        const values = group.rows.map(row => row[metric.column!]);
        if (metric.operation === "count_values") { result[metric.name] = values.filter(value => !isEmpty(value)).length; continue; }
        if (metric.operation === "distinct_count") { result[metric.name] = new Set(values.filter(value => !isEmpty(value)).map(value => normalizeText(cellText(value)))).size; continue; }
        const numbers = values.map(numberValue).filter((value): value is number => value !== null);
        excluded[metric.name] = (excluded[metric.name] ?? 0) + values.length - numbers.length;
        if (!numbers.length) { result[metric.name] = null; continue; }
        let sum = 0, correction = 0, min = Infinity, max = -Infinity;
        for (const number of numbers) {
          const add = number - correction, next = sum + add;
          correction = (next - sum) - add; sum = next;
          min = Math.min(min, number); max = Math.max(max, number);
        }
        result[metric.name] = checkedNumber(metric.operation === "sum" ? sum : metric.operation === "average" ? sum / numbers.length : metric.operation === "min" ? min : max);
      }
      return result;
    });
    audits.excludedNumericValues = excluded;
    for (const [name, count] of Object.entries(excluded)) if (count) warnings.push(`«${name}»: ${count} مقدار خالی یا غیرعددی از محاسبه کنار گذاشته شد.`);
    outputColumns = [...groupBy, ...metricNames];
  }
  const having = compileFilters(query.having, outputColumns);
  rows = rows.filter(row => having.every(test => test(row)));
  const sorts = query.sort.map(sort => ({ ...sort, column: exactColumn(sort.column, outputColumns) }));
  if (sorts.length) rows.sort((a, b) => {
    for (const sort of sorts) {
      const left = a[sort.column], right = b[sort.column];
      if (isEmpty(left) || isEmpty(right)) { const diff = Number(isEmpty(left)) - Number(isEmpty(right)); if (diff) return diff; continue; }
      const n1 = numberValue(left), n2 = numberValue(right);
      const diff = n1 !== null && n2 !== null ? n1 - n2 : normalizeText(cellText(left)).localeCompare(normalizeText(cellText(right)), "fa");
      if (diff) return sort.direction === "asc" ? diff : -diff;
    }
    return 0;
  });
  if (query.columns) outputColumns = query.columns.map(column => exactColumn(column, outputColumns));
  const allRows = rows.map(row => ({ ...Object.fromEntries(outputColumns.map(column => [column, row[column] ?? null])),
    ...(row.__row ? { __row: row.__row, __sheet: row.__sheet, __dataset: row.__dataset } : {}) }));
  if (allRows.length > 200_000) throw new Error("نتیجهٔ میانی بیش از سقف ۲۰۰ هزار ردیف است؛ محدودهٔ سؤال را کوچک‌تر کنید.");
  datasets.set(id, { ...input, id, label: `نتیجهٔ ${id}`, columns: outputColumns, rows: allRows });
  const output = allRows.slice(0, query.limit);
  return { id, tool: "query", description: input.label, data: { rows: output, columns: outputColumns, audit: audits, reusableDatasetId: id },
    citations: input.citations, warnings,
    coverage: { scannedRows, matchedRows, returnedRows: output.length, totalResultRows: allRows.length, completeInput: input.complete, limitedOutput: allRows.length > output.length } };
}
