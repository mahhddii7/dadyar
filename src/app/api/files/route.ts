import { NextResponse } from "next/server";
import { parseUpload } from "@/server/ingestion/parse-upload";
import { sourceRepository } from "@/server/storage/local-store";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_FILE_SIZE = 25 * 1024 * 1024;
const MAX_BATCH_SIZE = 100 * 1024 * 1024;
const ALLOWED = new Set(["xlsx", "xlsm", "csv", "json", "pdf", "docx", "txt", "md"]);

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

    for (const file of files) {
      if (file.size > MAX_FILE_SIZE) throw new Error(`حجم فایل «${file.name}» از سقف ۲۵ مگابایت بیشتر است.`);
      const extension = file.name.toLowerCase().split(".").pop() ?? "";
      if (!ALLOWED.has(extension)) throw new Error(`قالب فایل «${file.name}» پشتیبانی نمی‌شود.`);
    }
    const parsedFiles = [];
    for (const file of files) {
      const buffer = Buffer.from(await file.arrayBuffer());
      const parsed = await parseUpload(file.name, buffer);
      parsedFiles.push({ file, parsed });
    }
    const saved = [];
    for (const { file, parsed } of parsedFiles) {
      const source = await sourceRepository.save({
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
      });
      saved.push(source);
    }
    return NextResponse.json({ sources: saved }, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "بارگذاری فایل انجام نشد.";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
