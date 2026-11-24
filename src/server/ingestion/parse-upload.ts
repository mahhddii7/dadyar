import "server-only";
import ExcelJS from "exceljs";
import mammoth from "mammoth";
import "pdf-parse/worker";
import { PDFParse } from "pdf-parse";
import type { TableRow } from "../storage/types";
import { assertRows, completeText, decodeText, detectDelimiter, parseDelimited, parseJson, safeJsonParse, uniqueHeaders, type ParsedUpload } from "./tabular";
import { parseImage, visionConfigured } from "./vision";
export type { ParsedUpload } from "./tabular";

export const SUPPORTED_EXTENSIONS = ["xlsx", "xlsm", "csv", "tsv", "json", "jsonl", "ndjson", "pdf", "docx", "txt", "md", "log", "png", "jpg", "jpeg", "webp"];

function cellValue(value: ExcelJS.CellValue, warnings: Set<string>): unknown {
  if (value === null || value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object") {
    if ("formula" in value || "sharedFormula" in value) {
      if ("result" in value && value.result !== undefined && value.result !== null) return cellValue(value.result as ExcelJS.CellValue, warnings);
      warnings.add("فرمول بدون نتیجهٔ ذخیره‌شده پیدا شد؛ مقدار آن خالی است. فایل را در Excel محاسبه و ذخیره، سپس دوباره بارگذاری کنید."); return null;
    }
    if ("error" in value) { warnings.add("سلول دارای خطای Excel پیدا شد؛ متن خطا حفظ شده و عدد محسوب نمی‌شود."); return String(value.error); }
    if ("text" in value) return value.text;
    if ("richText" in value) return value.richText.map(part => part.text).join("");
    return JSON.stringify(value);
  }
  if (typeof value === "number" && (!Number.isFinite(value) || Math.abs(value) > Number.MAX_SAFE_INTEGER)) warnings.add("عدد Excel خارج از محدودهٔ دقت پیدا شد؛ اعداد بزرگ و شناسه‌ها را در مبدأ به متن تبدیل کنید.");
  return value;
}

async function parseWorkbook(buffer: Buffer): Promise<ParsedUpload> {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer as never);
  const rows: TableRow[] = [], sheetColumns: Record<string, string[]> = Object.create(null), warnings: string[] = [];
  const cellWarnings = new Set<string>();
  const sections: NonNullable<ParsedUpload["sections"]> = [];
  for (const sheet of workbook.worksheets) {
    if (!sheet.actualRowCount) { warnings.push(`شیت «${sheet.name}» خالی است.`); continue; }
    if (sheet.columnCount > 500) throw new Error(`شیت «${sheet.name}» بیش از ۵۰۰ ستون دارد.`);
    let headerLine = 0;
    sheet.eachRow((row, number) => { if (!headerLine && row.actualCellCount) headerLine = number; });
    if (!headerLine) continue;
    const first = sheet.getRow(headerLine);
    // A one-cell report title followed by a wider header is retained as document metadata.
    if (first.actualCellCount === 1 && sheet.getRow(headerLine + 1).actualCellCount > 1) {
      sections.push({ label: sheet.name, text: String(cellValue(first.getCell(1).value, cellWarnings) ?? first.values) });
      warnings.push(`عنوان شیت «${sheet.name}» جدا حفظ شد؛ ردیف ${headerLine + 1} به‌عنوان سرستون خوانده شد.`);
      headerLine++;
    }
    const header = sheet.getRow(headerLine);
    const headers = uniqueHeaders(Array.from({ length: sheet.columnCount }, (_, i) => cellValue(header.getCell(i + 1).value, cellWarnings)), warnings);
    sheetColumns[sheet.name] = headers;
    sheet.eachRow((row, number) => {
      if (number <= headerLine) return;
      const values = headers.map((_, i) => cellValue(row.getCell(i + 1).value, cellWarnings));
      if (!values.some(value => value !== null && String(value).trim() !== "")) return;
      rows.push({ ...Object.fromEntries(headers.map((header, i) => [header, values[i]])), __row: number, __sheet: sheet.name });
      assertRows(rows.length);
    });
  }
  if (!Object.keys(sheetColumns).length) throw new Error("فایل Excel جدول قابل خواندنی ندارد.");
  warnings.push(...cellWarnings);
  if (Object.keys(sheetColumns).length > 1) warnings.push("شیت‌ها جداگانه حفظ شدند؛ جدول‌های متفاوت بدون دستور صریح با هم جمع نمی‌شوند.");
  return { kind: "table", rows, columns: [...new Set(Object.values(sheetColumns).flat())], sheets: Object.keys(sheetColumns), sheetColumns, rowCount: rows.length,
    ...(sections.length ? { sections, text: sections.map(s => `${s.label}\n${s.text}`).join("\n\n") } : {}), warnings,
    extraction: { complete: !cellWarnings.size, method: "xlsx", notes: [...cellWarnings] } };
}

export async function parseUpload(fileName: string, buffer: Buffer): Promise<ParsedUpload> {
  const extension = fileName.toLowerCase().split(".").pop() ?? "";
  if (!SUPPORTED_EXTENSIONS.includes(extension)) throw new Error(`قالب .${extension} پشتیبانی نمی‌شود. برای جدول از XLSX/CSV/JSON و برای سند از PDF/DOCX/TXT یا تصویر استفاده کنید.`);
  if (!buffer.length) throw new Error("فایل خالی است.");
  if (["xlsx", "xlsm"].includes(extension)) return parseWorkbook(buffer);
  if (["png", "jpg", "jpeg", "webp"].includes(extension)) return parseImage(buffer, `image/${extension === "jpg" ? "jpeg" : extension}`);
  const warnings: string[] = [];
  if (["csv", "tsv", "json", "jsonl", "ndjson", "txt", "md", "log"].includes(extension)) {
    const text = decodeText(buffer, warnings).replace(/^\uFEFF/, "");
    if (["jsonl", "ndjson"].includes(extension)) {
      const records = text.split(/\r?\n/).filter(line => line.trim()).map((line, index) => {
        try { return safeJsonParse(line); } catch (error) { if (!(error instanceof SyntaxError)) throw error; throw new Error(`JSONL در سطر ${index + 1} معتبر نیست؛ فایل ذخیره نشد.`); }
      });
      return parseJson(records, warnings);
    }
    if (["csv", "tsv", "json"].includes(extension)) {
      if (/^[\s]*[\[{]/u.test(text)) {
        let value: unknown;
        try { value = safeJsonParse(text); } catch (error) { if (!(error instanceof SyntaxError)) throw error; if (extension === "json") throw new Error("JSON معتبر نیست؛ فایل ذخیره نشد."); }
        if (value !== undefined) {
          if (extension !== "json") warnings.push("محتوا JSON بود و با وجود پسوند متفاوت، بر اساس JSON خوانده شد.");
          return parseJson(value, warnings);
        }
      }
      if (extension === "json") {
        try { return parseJson(safeJsonParse(text), warnings); } catch (error) {
          if (!(error instanceof SyntaxError)) throw error;
          if (!detectDelimiter(text)) throw new Error("محتوا JSON معتبر یا جدول قابل‌تشخیص نیست.");
          warnings.push("محتوا با وجود پسوند JSON، CSV تشخیص داده شد.");
        }
      }
      return parseDelimited(text, extension === "tsv" ? "\t" : detectDelimiter(text) ?? ",", warnings);
    }
    return { kind: "document", text: completeText(text), warnings, extraction: { complete: true, method: "text" } };
  }
  if (extension === "docx") {
    const result = await mammoth.extractRawText({ buffer });
    warnings.push("متن Word استخراج شد؛ جدول‌ها و تصاویر به جدول محاسباتی تبدیل نشده‌اند. برای محاسبهٔ دقیق از فایل جدولی استفاده کنید.");
    if (result.messages.length) warnings.push("استخراج Word هشدار داشت؛ قالب‌بندی پیچیده ممکن است قابل خواندن نباشد.");
    return { kind: "document", text: completeText(result.value), warnings, extraction: { complete: !result.messages.length, method: "docx-text" } };
  }
  const parser = new PDFParse({ data: buffer });
  try {
    const result = await parser.getText({ pageJoiner: "" });
    const emptyPages = result.pages.filter(page => !page.text.trim()).map(page => page.num);
    if (emptyPages.length && !visionConfigured()) throw new Error(`${emptyPages.length} صفحه از PDF متن قابل استخراج ندارد (احتمالاً اسکن). برای جلوگیری از حذف صفحه، فایل ذخیره نشد؛ OCR را تنظیم کنید یا PDF متنی ارسال کنید.`);
    if (emptyPages.length > 12) throw new Error("PDF بیش از ۱۲ صفحهٔ نیازمند OCR دارد؛ فایل را به بخش‌های کوچک‌تر تقسیم کنید.");
    const sections = result.pages.map(page => ({ page: page.num, text: page.text, label: `صفحه ${page.num}` }));
    const ocrRows: TableRow[] = [], sheetColumns: Record<string, string[]> = Object.create(null);
    let complete = true;
    for (const page of emptyPages) {
      const rendered = await parser.getScreenshot({ partial: [page], desiredWidth: 1600 });
      if (!rendered.pages[0]) throw new Error(`تصویر صفحه ${page} استخراج نشد.`);
      const parsed = await parseImage(Buffer.from(rendered.pages[0].data), "image/png");
      complete &&= parsed.extraction?.complete ?? false;
      warnings.push(...parsed.warnings.map(w => `صفحه ${page}: ${w}`));
      sections.find(section => section.page === page)!.text = parsed.text ?? "";
      for (const [name, columns] of Object.entries(parsed.sheetColumns ?? {})) sheetColumns[`صفحه ${page}/${name}`] = columns;
      for (const row of parsed.rows ?? []) ocrRows.push({ ...row, __sheet: `صفحه ${page}/${row.__sheet}` });
      assertRows(ocrRows.length);
    }
    warnings.push("PDF بر پایهٔ متن خوانده شد؛ نمودارها و تصاویر داخل صفحه‌های متنی ممکن است در استخراج متن نیامده باشند.");
    const text = sections.map(section => `${section.label}\n${section.text}`).join("\n\n");
    completeText(text);
    return { kind: ocrRows.length ? "table" : "document", text, sections, warnings,
      ...(ocrRows.length ? { rows: ocrRows, columns: [...new Set(Object.values(sheetColumns).flat())], sheetColumns, sheets: Object.keys(sheetColumns), rowCount: ocrRows.length } : {}),
      extraction: { complete, method: emptyPages.length ? "pdf-with-ocr" : "pdf-text" } };
  } finally { await parser.destroy(); }
}
