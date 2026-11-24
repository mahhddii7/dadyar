import { NextResponse } from "next/server";
import { sourceRepository } from "@/server/storage/local-store";

export const runtime = "nodejs";

export async function GET(request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await sourceRepository.get(id);
  if (!source) return NextResponse.json({ error: "فایل پیدا نشد." }, { status: 404 });
  if (new URL(request.url).searchParams.get("download") === "1") {
    const original = await sourceRepository.original(id);
    if (!original) return NextResponse.json({ error: "اصل فایل در این نسخه موجود نیست؛ آن را دوباره بارگذاری کنید." }, { status: 404 });
    return new Response(new Uint8Array(original), { headers: { "Content-Type": "application/octet-stream", "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(source.name)}`, "Cache-Control": "no-store" } });
  }
  return NextResponse.json({ source: sourceRepository.toPublic(source) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = await sourceRepository.remove(id);
  if (!deleted) return NextResponse.json({ error: "فایل پیدا نشد." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
