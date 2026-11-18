import { NextResponse } from "next/server";
import { sourceRepository } from "@/server/storage/local-store";

export const runtime = "nodejs";

export async function GET(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const source = await sourceRepository.get(id);
  if (!source) return NextResponse.json({ error: "فایل پیدا نشد." }, { status: 404 });
  return NextResponse.json({ source: sourceRepository.toPublic(source) });
}

export async function DELETE(_request: Request, context: { params: Promise<{ id: string }> }) {
  const { id } = await context.params;
  const deleted = await sourceRepository.remove(id);
  if (!deleted) return NextResponse.json({ error: "فایل پیدا نشد." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
