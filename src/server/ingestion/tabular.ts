import type { SourceFile, TableRow } from "../storage/types";

export const MAX_ROWS = 100_000;
export const MAX_TEXT = 1_500_000;
export type ParsedUpload = Pick<SourceFile, "kind" | "rows" | "columns" | "text" | "sheets" | "sheetColumns" | "rowCount" | "sections" | "extraction"> & { warnings: string[] };

export function assertRows(count: number) {
  if (count > MAX_ROWS) throw new Error("فایل بیش از ۱۰۰ هزار ردیف دارد. برای جلوگیری از تحلیل ناقص، بارگذاری نشد؛ آن را به چند فایل تقسیم کنید.");
}

export function completeText(text: string) {
  if (text.length > MAX_TEXT) throw new Error("متن فایل بیش از ۱٫۵ میلیون نویسه است؛ برای جلوگیری از بریدن متن، فایل را تقسیم کنید.");
  if (!text.trim()) throw new Error("متن قابل خواندنی در فایل پیدا نشد؛ فایل خالی یا نیازمند OCR است.");
  return text;
}

export function decodeText(buffer: Buffer, warnings: string[]) {
  if (buffer[0] === 0xff && buffer[1] === 0xfe) return new TextDecoder("utf-16le", { fatal: true }).decode(buffer);
  if (buffer[0] === 0xfe && buffer[1] === 0xff) return new TextDecoder("utf-16be", { fatal: true }).decode(buffer);
  try { return new TextDecoder("utf-8", { fatal: true }).decode(buffer); }
  catch {
    warnings.push("کدگذاری UTF-8 نبود؛ متن با Windows-1256 خوانده شد. خوانایی نام‌ها را در پیش‌نمایش بررسی کنید.");
    return new TextDecoder("windows-1256", { fatal: true }).decode(buffer);
  }
}

export function uniqueHeaders(raw: unknown[], warnings: string[]) {
  const used = new Set<string>();
  return raw.map((value, index) => {
    const original = String(value ?? "").trim();
    const base = !original ? `ستون ${index + 1}` : original.startsWith("__") || ["__proto__", "constructor", "prototype"].includes(original) ? `داده:${original}` : original;
    let header = base, suffix = 2;
    while (used.has(header)) header = `${base} (${suffix++})`;
    used.add(header);
    if (header !== original) warnings.push(`نام ستون ${index + 1} برای حفظ داده به «${header}» تغییر کرد.`);
    return header;
  });
}

export function detectDelimiter(text: string) {
  const line = text.split(/\r?\n/).find(line => line.trim()) ?? "";
  const options = [",", ";", "\t", "|"];
  const counts = options.map(() => 0); let quoted = false;
  for (let i = 0; i < line.length; i++) {
    if (line[i] === '"') { if (quoted && line[i + 1] === '"') i++; else quoted = !quoted; }
    else if (!quoted) { const index = options.indexOf(line[i]); if (index >= 0) counts[index]++; }
  }
  const max = Math.max(...counts);
  return max > 0 ? options[counts.indexOf(max)] : null;
}

export function safeJsonParse(text: string): unknown {
  // Reject numeric JSON values that JavaScript would round before analysis.
  let quoted = false;
  for (let i = 0; i < text.length; i++) {
    if (quoted && text[i] === "\\") { i++; continue; }
    if (text[i] === '"') { quoted = !quoted; continue; }
    if (!quoted && /[-0-9]/.test(text[i])) {
      const token = text.slice(i).match(/^-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?/)?.[0];
      if (token) {
        const value = Number(token);
        if (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER) throw new Error("JSON دارای عدد بزرگ‌تر از محدودهٔ دقت است؛ شناسه‌ها و عددهای بسیار بزرگ را به‌صورت رشتهٔ متنی ارسال کنید.");
        i += token.length - 1;
      }
    }
  }
  return JSON.parse(text);
}

function flattenObject(object: Record<string, unknown>, prefix = "", depth = 0): Record<string, unknown> {
  if (depth > 20) throw new Error("عمق سلول JSON بیش از حد است.");
  const result: Record<string, unknown> = Object.create(null);
  for (const [key, value] of Object.entries(object)) {
    const escaped = key.replace(/\\/g, "\\\\").replace(/\./g, "\\.");
    const name = prefix ? `${prefix}.${escaped}` : escaped;
    if (value && typeof value === "object" && !Array.isArray(value) && Object.keys(value).length) Object.assign(result, flattenObject(value as Record<string, unknown>, name, depth + 1));
    else result[name] = value;
  }
  return result;
}

export function parseDelimited(text: string, delimiter: string, warnings: string[] = []): ParsedUpload {
  const records: Array<{ values: string[]; line: number }> = [];
  let values: string[] = [], cell = "", quoted = false, closed = false, line = 1, startLine = 1;
  const finishCell = () => { values.push(cell); cell = ""; closed = false; };
  const finishRow = () => {
    finishCell();
    if (values.some(value => value.trim())) records.push({ values, line: startLine });
    values = []; assertRows(Math.max(0, records.length - 1));
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i++; }
      else if (quoted) { quoted = false; closed = true; }
      else if (!cell && !closed) quoted = true;
      else throw new Error(`CSV در خط ${line} علامت نقل‌قول نامعتبر دارد.`);
    } else if (char === delimiter && !quoted) finishCell();
    else if ((char === "\r" || char === "\n") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i++;
      finishRow(); line++; startLine = line;
    } else {
      if (closed && !/\s/.test(char)) throw new Error(`CSV در خط ${line} پس از نقل‌قول، جداکننده ندارد.`);
      if (!closed) cell += char;
      if (char === "\n") line++;
    }
  }
  if (quoted) throw new Error("نقل‌قول CSV بسته نشده است؛ هیچ ردیفی از این فایل ذخیره نشد.");
  finishRow();
  if (!records.length) throw new Error("فایل جدولی خالی است.");
  const first = records[0];
  const numericFirst = first.values.every(value => /^[+-]?[0-9۰-۹٠-٩]+(?:[.,٫٬][0-9۰-۹٠-٩]+)*$/.test(value.trim()));
  const header = numericFirst ? { values: first.values.map((_, i) => `ستون ${i + 1}`), line: 0 } : records.shift()!;
  assertRows(records.length);
  if (numericFirst) warnings.push("سطر اول فقط عدد داشت؛ به‌عنوان داده حفظ شد و نام ستون‌ها خودکار تعیین شدند.");
  const width = records.reduce((max, record) => Math.max(max, record.values.length), header.values.length);
  if (width > 500) throw new Error("جدول بیش از ۵۰۰ ستون دارد؛ آن را به جدول‌های کوچک‌تر تقسیم کنید.");
  if (width > header.values.length) warnings.push("بعضی ردیف‌ها ستون اضافه داشتند؛ همهٔ مقدارها با نام ستون جدید حفظ شدند.");
  const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => header.values[i]), warnings);
  const uneven = records.filter(record => record.values.length !== header.values.length).length;
  if (uneven) warnings.push(`${uneven} ردیف تعداد ستون متفاوت داشت؛ مقدارهای غایب خالی ثبت شدند.`);
  const rows = records.map(record => Object.assign(Object.fromEntries(headers.map((header, i) => [header, record.values[i] ?? ""])), { __row: record.line, __sheet: "جدول" }));
  return { kind: "table", rows, columns: headers, rowCount: rows.length, sheets: ["جدول"], sheetColumns: { "جدول": headers }, warnings,
    extraction: { complete: true, method: "delimited" } };
}

export function parseJson(value: unknown, warnings: string[] = []): ParsedUpload {
  const rows: TableRow[] = [], sheetColumns: Record<string, string[]> = Object.create(null);
  const sections: NonNullable<SourceFile["sections"]> = [];
  const record = (item: unknown): item is Record<string, unknown> => !!item && typeof item === "object" && !Array.isArray(item);
  function visit(item: unknown, location: string, depth: number) {
    if (depth > 20) throw new Error("عمق JSON بیش از حد است؛ بخش‌های موردنیاز را جداگانه ارسال کنید.");
    if (Array.isArray(item) && item.length && item.every(record)) {
      const flattened = item.map(object => flattenObject(object));
      const rawHeaders = [...new Set(flattened.flatMap(Object.keys))];
      if (rawHeaders.length > 500) throw new Error("جدول JSON بیش از ۵۰۰ ستون دارد.");
      const headers = uniqueHeaders(rawHeaders, warnings); sheetColumns[location] = headers;
      flattened.forEach((object, index) => {
        rows.push({ ...Object.fromEntries(headers.map((header, i) => [header, object[rawHeaders[i]] ?? null])), __row: index + 1, __sheet: location });
        assertRows(rows.length);
      });
      if (item.some(object => Object.values(object).some(value => value && typeof value === "object"))) warnings.push(`«${location}» دادهٔ تو در تو دارد؛ فیلدهای شیء با مسیر نقطه‌ای و آرایه‌های داخل سلول به‌صورت کامل حفظ شدند.`);
      return;
    }
    if (Array.isArray(item) && item.length > 1 && item.every(Array.isArray)) {
      const width = item.reduce((max, row) => Math.max(max, row.length), 0);
      if (width > 500) throw new Error("جدول JSON بیش از ۵۰۰ ستون دارد.");
      const hasHeader = item[0].every(value => typeof value === "string" && value.trim() && !/^[+-]?[0-9۰-۹٠-٩]+(?:[.,٫٬][0-9۰-۹٠-٩]+)*$/.test(value.trim()));
      const headers = uniqueHeaders(Array.from({ length: width }, (_, i) => hasHeader ? item[0][i] : `ستون ${i + 1}`), warnings); sheetColumns[location] = headers;
      item.slice(hasHeader ? 1 : 0).forEach((values, index) => { rows.push({ ...Object.fromEntries(headers.map((header, i) => [header, values[i] ?? null])), __row: index + (hasHeader ? 2 : 1), __sheet: location }); assertRows(rows.length); });
      warnings.push(`«${location}» آرایهٔ سطری بود؛ ${hasHeader ? "سطر اول به‌عنوان نام ستون خوانده شد" : "سرستون متنی مشخص نبود؛ همهٔ سطرها به‌عنوان داده حفظ شدند"}. این فرض را در پیش‌نمایش بررسی کنید.`);
      return;
    }
    if (record(item) && Object.values(item).some(value => value && typeof value === "object")) {
      const meta: Record<string, unknown> = Object.create(null);
      for (const [key, value] of Object.entries(item)) {
        if (value && typeof value === "object") visit(value, `${location}/${key.replace(/~/g, "~0").replace(/\//g, "~1")}`, depth + 1);
        else meta[key] = value;
      }
      if (Object.keys(meta).length) sections.push({ label: location, text: JSON.stringify(meta, null, 2) });
      return;
    }
    if (record(item)) { visit([item], location, depth + 1); return; }
    sections.push({ label: location, text: JSON.stringify(item, null, 2) ?? "null" });
  }
  visit(value, "JSON", 0);
  const text = sections.map(section => `${section.label}\n${section.text}`).join("\n\n");
  if (text.length > MAX_TEXT) completeText(text);
  if (!rows.length) return { kind: "document", text: completeText(text || JSON.stringify(value, null, 2)), sections, warnings, extraction: { complete: true, method: "json" } };
  if (Object.keys(sheetColumns).length > 1) warnings.push("همهٔ آرایه‌های جدول در JSON به‌صورت جدول‌های مستقل حفظ شدند؛ برای اتصال، کلید مشترک لازم است.");
  return { kind: "table", rows, columns: [...new Set(Object.values(sheetColumns).flat())], rowCount: rows.length,
    sheets: Object.keys(sheetColumns), sheetColumns, ...(text ? { text, sections } : {}), warnings, extraction: { complete: true, method: "json" } };
}
