import { NextResponse } from "next/server";
import { parseUpload, SUPPORTED_EXTENSIONS } from "@/server/ingestion/parse-upload";
import { sourceRepository } from "@/server/storage/local-store";
import { createHash } from "node:crypto";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_BATCH_SIZE = 100 * 1024 * 1024;
const ALLOWED = new Set(SUPPORTED_EXTENSIONS);

export async function GET() {
  const sources = await sourceRepository.list();
  return NextResponse.json({ sources });
}

export async function POST(request: Request) {
  try {
    const contentLength = Number(request.headers.get("content-length"));
    if (Number.isFinite(contentLength) && contentLength > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: "حجم مجموع فایل‌های این نوبت نمی‌تواند بیشتر از ۱۰۰ مگابایت باشد." }, { status: 413 });
    }
    const form = await request.formData();
    const files = form.getAll("files").filter((item): item is File => item instanceof File);
    if (!files.length) return NextResponse.json({ error: "فایلی برای بارگذاری انتخاب نشده است." }, { status: 400 });
    if (files.length > 10) return NextResponse.json({ error: "در هر نوبت حداکثر ۱۰ فایل بارگذاری کنید." }, { status: 400 });
    if (files.reduce((total, file) => total + file.size, 0) > MAX_BATCH_SIZE) {
      return NextResponse.json({ error: "حجم مجموع فایل‌های این نوبت نمی‌تواند بیشتر از ۱۰۰ مگابایت باشد." }, { status: 413 });
    }

    const saved = [];
    const errors: Array<{ file: string; message: string }> = [];
    for (const file of files) {
      try {
        if (file.size > MAX_FILE_SIZE) throw new Error("حجم فایل از سقف ۲۵ مگابایت بیشتر است.");
        const extension = file.name.toLowerCase().split(".").pop() ?? "";
        if (!ALLOWED.has(extension)) throw new Error("قالب فایل پشتیبانی نمی‌شود؛ از XLSX، CSV، JSON، PDF، DOCX، متن یا تصویر استفاده کنید.");
        const buffer = Buffer.from(await file.arrayBuffer());
        const parsed = await parseUpload(file.name, buffer);
        const source = await sourceRepository.save({
        ...parsed,
        name: file.name.replace(/[\\/]/g, "_").slice(0, 180),
        kind: parsed.kind,
        mimeType: file.type || "application/octet-stream",
        size: file.size,
        rows: parsed.rows,
        columns: parsed.columns,
        text: parsed.text,
        sheets: parsed.sheets,
        rowCount: parsed.rowCount,
        warnings: parsed.warnings,
        contentHash: createHash("sha256").update(buffer).digest("hex"),
      }, buffer);
        saved.push(source);
      } catch (error) { errors.push({ file: file.name, message: error instanceof Error ? error.message : "خواندن این فایل انجام نشد." }); }
    }
    return NextResponse.json({ sources: saved, errors, ...(!saved.length ? { error: errors.map(item => `${item.file}: ${item.message}`).join("\n") } : {}) }, { status: saved.length ? 201 : 400 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "بارگذاری فایل انجام نشد.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
