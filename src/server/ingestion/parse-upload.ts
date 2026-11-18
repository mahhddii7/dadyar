import "server-only";

import ExcelJS from "exceljs";
import mammoth from "mammoth";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import type { SourceKind, TableRow } from "../storage/types";

const MAX_ROWS = 100_000;
const MAX_TEXT_CHARS = 1_500_000;

function boundedText(text: string, warnings: string[]) {
  if (text.length > MAX_TEXT_CHARS) warnings.push(`متن پس از ${MAX_TEXT_CHARS.toLocaleString("fa-IR")} نویسه برای کنترل حافظه بریده شد؛ پاسخ ممکن است بخش‌های پایانی سند را پوشش ندهد.`);
  return text.slice(0, MAX_TEXT_CHARS);
}

export interface ParsedUpload {
  kind: SourceKind;
  rows?: TableRow[];
  columns?: string[];
  text?: string;
  sheets?: string[];
  rowCount?: number;
  warnings: string[];
}

function cellValue(value: ExcelJS.CellValue): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("result" in value) return cellValue(value.result as ExcelJS.CellValue);
    if ("formula" in value || "sharedFormula" in value) return null;
    if ("text" in value) return value.text;
    if ("richText" in value && Array.isArray(value.richText)) {
      return value.richText.map((part) => part.text).join("");
    }
    return JSON.stringify(value);
  }
  return value;
}

function makeUniqueHeaders(headers: string[]) {
  const seen = new Map<string, number>();
  return headers.map((header) => {
    const count = seen.get(header) ?? 0;
    seen.set(header, count + 1);
    return count ? `${header} (${count + 1})` : header;
  });
}

async function parseWorkbook(buffer: Buffer): Promise<ParsedUpload> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const rows: TableRow[] = [];
  let columns: string[] = [];
  const sheets: string[] = [];
  const warnings: string[] = [];

  workbook.worksheets.forEach((sheet) => {
    sheets.push(sheet.name);
    const headerRow = sheet.getRow(1);
    const headers = makeUniqueHeaders(Array.from({ length: Math.max(headerRow.cellCount, sheet.columnCount) }, (_, i) => {
      const header = cellValue(headerRow.getCell(i + 1).value as ExcelJS.CellValue);
      return String(header ?? "").trim() || `ستون ${i + 1}`;
    }));
    columns = [...new Set([...columns, ...headers])];
    if (sheet.rowCount > 1 && rows.length > 0) {
      warnings.push(`شیت «${sheet.name}» نیز خوانده شد؛ نام شیت در ردیف‌های آن حفظ شده است.`);
    }
    sheet.eachRow((row, rowNumber) => {
      if (rowNumber === 1) return;
      if (rows.length >= MAX_ROWS) return;
      const record: TableRow = { "__sheet": sheet.name, "__row": rowNumber };
      headers.forEach((header, index) => {
        record[header] = cellValue(row.getCell(index + 1).value as ExcelJS.CellValue);
      });
      if (Object.values(record).some((value) => value !== null && value !== "")) rows.push(record);
    });
  });

  if (rows.length >= MAX_ROWS) warnings.push(`برای کنترل مصرف حافظه، خواندن داده پس از ${MAX_ROWS.toLocaleString("fa-IR")} ردیف متوقف شد.`);
  return { kind: "table", rows, columns, sheets, rowCount: rows.length, warnings };
}

function parseCsv(text: string, delimiter: string): TableRow[] {
  const records: string[][] = [];
  let record: string[] = [];
  let cell = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (char === '"') {
      if (quoted && text[i + 1] === '"') { cell += '"'; i += 1; }
      else quoted = !quoted;
    } else if (char === delimiter && !quoted) {
      record.push(cell); cell = "";
    } else if ((char === "\n" || char === "\r") && !quoted) {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      record.push(cell); cell = "";
      if (record.some((value) => value.trim() !== "")) records.push(record);
      record = [];
    } else cell += char;
  }
  record.push(cell);
  if (record.some((value) => value.trim() !== "")) records.push(record);

  const headers = makeUniqueHeaders((records.shift() ?? []).map((header, i) => header.trim() || `ستون ${i + 1}`));
  return records.slice(0, MAX_ROWS).map((values, index) => {
    const row: TableRow = { "__sheet": "CSV", "__row": index + 2 };
    headers.forEach((header, i) => { row[header] = values[i] ?? ""; });
    return row;
  });
}

function detectCsvDelimiter(text: string) {
  const firstLine = text.split(/\r?\n/u).find((line) => line.trim()) ?? "";
  const candidates = [",", ";", "\t", "|"];
  const counts = new Map(candidates.map((candidate) => [candidate, 0]));
  let quoted = false;
  for (let i = 0; i < firstLine.length; i += 1) {
    if (firstLine[i] === '"') {
      if (quoted && firstLine[i + 1] === '"') i += 1;
      else quoted = !quoted;
    } else if (!quoted && counts.has(firstLine[i])) {
      counts.set(firstLine[i], (counts.get(firstLine[i]) ?? 0) + 1);
    }
  }
  const best = candidates.sort((left, right) => (counts.get(right) ?? 0) - (counts.get(left) ?? 0))[0];
  return best && (counts.get(best) ?? 0) > 0 ? best : null;
}

function jsonMatrixToTable(data: unknown[][], warnings: string[]): ParsedUpload {
  const headerValues = data[0] ?? [];
  const headers = makeUniqueHeaders(headerValues.map((value, index) => String(value ?? "").trim() || "ستون " + (index + 1)));
  const rows = data.slice(1, MAX_ROWS + 1).map((values, index) => {
    const row: TableRow = { "__sheet": "JSON", "__row": index + 2 };
    headers.forEach((header, columnIndex) => { row[header] = values[columnIndex] ?? null; });
    return row;
  });
  if (data.length - 1 > MAX_ROWS) warnings.push("فایل JSON بیش از " + MAX_ROWS.toLocaleString("fa-IR") + " ردیف داشت؛ ردیف‌های پایانی بارگذاری نشدند.");
  return { kind: "table", rows, columns: headers, rowCount: rows.length, warnings };
}

function parseJsonValue(value: unknown, warnings: string[]): ParsedUpload {
  let data: unknown[] | null = Array.isArray(value) ? value : null;
  const isRecordArray = (candidate: unknown): candidate is unknown[] =>
    Array.isArray(candidate) && candidate.every((item) => typeof item === "object" && item !== null && !Array.isArray(item));
  const isMatrix = (candidate: unknown): candidate is unknown[][] =>
    Array.isArray(candidate) && candidate.length > 0 && candidate.every(Array.isArray);
  if (!data && typeof value === "object" && value !== null) {
    const object = value as Record<string, unknown>;
    const preferredKeys = ["data", "rows", "records", "items"];
    const preferred = preferredKeys.find((key) => isRecordArray(object[key]) || isMatrix(object[key]));
    const arrays = Object.values(object).filter((item) => isRecordArray(item) || isMatrix(item));
    if (preferred) data = object[preferred] as unknown[];
    else if (arrays.length === 1) data = arrays[0];
    else if (arrays.length > 1) warnings.push("JSON چند آرایهٔ داده دارد؛ برای جلوگیری از حذف یا ادغام اشتباه، به‌صورت سند نگه داشته شد.");
    else if (!arrays.length && Object.values(object).every((item) => item === null || ["string", "number", "boolean"].includes(typeof item))) data = [object];
  }
  if (isMatrix(data)) return jsonMatrixToTable(data, warnings);
  if (data?.every((item) => typeof item === "object" && item !== null && !Array.isArray(item))) {
    const rows = data.slice(0, MAX_ROWS) as TableRow[];
    if (data.length > MAX_ROWS) warnings.push("فایل JSON بیش از " + MAX_ROWS.toLocaleString("fa-IR") + " ردیف داشت؛ ردیف‌های پایانی بارگذاری نشدند.");
    return { kind: "table", rows, columns: [...new Set(rows.flatMap(Object.keys).filter((key) => !key.startsWith("__")))], rowCount: rows.length, warnings };
  }
  return { kind: "document", text: boundedText(JSON.stringify(value, null, 2), warnings), warnings };
}

function parseCsvUpload(text: string, warnings: string[]): ParsedUpload {
  const rows = parseCsv(text, detectCsvDelimiter(text) ?? ",");
  return {
    kind: "table",
    rows,
    columns: Object.keys(rows[0] ?? {}).filter((key) => !key.startsWith("__")),
    rowCount: rows.length,
    warnings: rows.length >= MAX_ROWS ? [...warnings, "خواندن تا سقف " + MAX_ROWS.toLocaleString("fa-IR") + " ردیف محدود شد."] : warnings,
  };
}

export async function parseUpload(fileName: string, buffer: Buffer): Promise<ParsedUpload> {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  const warnings: string[] = [];
  if (["xlsx", "xlsm"].includes(extension)) return parseWorkbook(buffer);
  if (extension === "csv") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    const trimmed = text.trimStart();
    if (trimmed.startsWith("[") || trimmed.startsWith("{")) {
      try {
        const parsed = parseJsonValue(JSON.parse(text), warnings);
        warnings.push("محتوای JSON با پسوند CSV شناسایی شد و بر اساس ساختار محتوا خوانده شد.");
        return { ...parsed, warnings };
      } catch {
        // Not valid JSON; continue with the CSV parser.
      }
    }
    return parseCsvUpload(text, warnings);
  }
  if (extension === "json") {
    const text = buffer.toString("utf8").replace(/^\uFEFF/, "");
    try {
      return parseJsonValue(JSON.parse(text), warnings);
    } catch {
      const delimiter = detectCsvDelimiter(text);
      if (delimiter) {
        warnings.push("محتوای فایل CSV بود؛ با وجود پسوند JSON به‌صورت جدول خوانده شد.");
        return parseCsvUpload(text, warnings);
      }
      throw new Error("محتوای فایل نه JSON معتبر بود و نه CSV قابل‌تشخیص.");
    }
  }
  if (["txt", "md"].includes(extension)) {
    return { kind: "document", text: boundedText(buffer.toString("utf8"), warnings), warnings };
  }
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    if (result.messages.length) warnings.push("ممکن است بخشی از قالب‌بندی یا جدول‌های پیچیدهٔ Word به متن ساده تبدیل شده باشد.");
    return { kind: "document", text: boundedText(result.value, warnings), warnings };
  }
  if (extension === "pdf") {
    const parser = new PDFParse({ data: buffer });
    try {
      const result = await parser.getText();
      if (!result.text.trim()) warnings.push("متنی از PDF استخراج نشد؛ اگر فایل اسکن‌شده است، در نسخهٔ بعدی باید OCR اضافه شود.");
      return { kind: "document", text: boundedText(result.text, warnings), warnings };
    } finally {
      await parser.destroy();
    }
  }
  throw new Error("نوع فایل پشتیبانی نمی‌شود. قالب‌های قابل‌قبول: XLSX، XLSM، CSV، JSON، PDF، DOCX، TXT و MD.");
}
