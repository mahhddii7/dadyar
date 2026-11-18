import "server-only";

import type { SourceFile } from "../storage/types";

type Category = { column: string; populated: number; distinct: number; top: Array<{ value: string; count: number }> };
type Measure = { column: string; count: number; min: number; max: number; average: number };
type Missing = { column: string; count: number };

export type FileProfile = {
  id: string;
  file: string;
  kind: SourceFile["kind"];
  rows: number;
  columns: string[];
  categories: Category[];
  measures: Measure[];
  missing: Missing[];
  textExcerpts: string[];
  coverage: string;
};

function numeric(value: unknown) {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value !== "string") return null;
  const digits = value.trim().replace(/[۰-۹]/g, (digit) => String("۰۱۲۳۴۵۶۷۸۹".indexOf(digit)))
    .replace(/[٠-٩]/g, (digit) => String("٠١٢٣٤٥٦٧٨٩".indexOf(digit)));
  if (!/^[+-]?(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d+)?$/.test(digits)) return null;
  const number = Number(digits.replace(/,/g, ""));
  return Number.isFinite(number) ? number : null;
}

function documentExcerpts(text: string) {
  const paragraphs = text.split(/\n{2,}/).map((part) => part.trim()).filter(Boolean);
  if (paragraphs.length <= 3) {
    if (text.length <= 4_800) return paragraphs.map((part) => part.slice(0, 1_200));
    const starts = [0, Math.floor(text.length / 3), Math.floor(2 * text.length / 3), Math.max(0, text.length - 1_200)];
    return starts.map((start) => text.slice(start, start + 1_200).trim());
  }
  const indexes = [0, Math.floor(paragraphs.length / 3), Math.floor(2 * paragraphs.length / 3), paragraphs.length - 1];
  return [...new Set(indexes)].map((index) => paragraphs[index].slice(0, 1_200));
}

function profileSource(source: SourceFile): FileProfile {
  const columns = (source.columns ?? []).filter((column) => !column.startsWith("__"));
  const rows = source.rows ?? [];
  if (source.kind === "document") return {
    id: source.id, file: source.name, kind: source.kind, rows: 0, columns: [], categories: [], measures: [], missing: [],
    textExcerpts: documentExcerpts(source.text ?? ""),
    coverage: "چند بخش از ابتدای، میانه و انتهای متن؛ برای نتیجهٔ جامع بررسی کل سند لازم است.",
  };

  const categories: Category[] = [];
  const measures: Measure[] = [];
  const missing: Missing[] = [];
  for (const column of columns) {
    let empty = 0;
    let numericCount = 0;
    let min = Infinity;
    let max = -Infinity;
    let sum = 0;
    const values = new Map<string, number>();
    for (const row of rows) {
      const value = row[column];
      if (value === null || value === undefined || String(value).trim() === "") { empty++; continue; }
      const number = numeric(value);
      if (number !== null) { numericCount++; sum += number; min = Math.min(min, number); max = Math.max(max, number); }
      const label = typeof value === "object" ? JSON.stringify(value) : String(value).trim();
      if (values.size < 101 || values.has(label)) values.set(label, (values.get(label) ?? 0) + 1);
    }
    const populated = rows.length - empty;
    if (empty) missing.push({ column, count: empty });
    const idOrDate = /(شماره|شناسه|کد|تاریخ|ردیف|پلاک|\bid\b|code|date|number)/iu.test(column);
    const dimension = /(طبقه|ساختمان|واحد|گروه|نوع|وضعیت|floor|building|unit|status|category)/iu.test(column);
    const measurement = /(تعداد|مقدار|مبلغ|قیمت|هزینه|ظرفیت|نفر|بها|ارزش|زمان|ساعت|روز|درصد|capacity|people|count|amount|price|cost|value|duration|total)/iu.test(column);
    if (populated && !idOrDate && !dimension && numericCount / populated >= 0.85 && (measurement || values.size > 20)) {
      measures.push({ column, count: numericCount, min, max, average: Number((sum / numericCount).toFixed(2)) });
    } else if (populated && !idOrDate && values.size <= 20 && values.size > 1) {
      categories.push({ column, populated, distinct: values.size,
        top: [...values].sort((a, b) => b[1] - a[1]).slice(0, 5).map(([value, count]) => ({ value: value.slice(0, 80), count })) });
    }
  }
  categories.sort((a, b) => b.populated - a.populated || a.distinct - b.distinct);
  missing.sort((a, b) => b.count - a.count);
  return {
    id: source.id, file: source.name, kind: source.kind, rows: rows.length, columns,
    categories: categories.slice(0, 8), measures: measures.slice(0, 8), missing: missing.slice(0, 6), textExcerpts: [],
    coverage: `تمام ${rows.length} ردیف برای شمارش و آمار ستون‌ها بررسی شد؛ دسته‌ها فقط برای ستون‌های دارای حداکثر ۲۰ مقدار متمایز گزارش شده‌اند.`,
  };
}

export function profileSources(sources: SourceFile[]) {
  return sources.map(profileSource);
}
