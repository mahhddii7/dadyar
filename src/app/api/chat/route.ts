import { NextResponse } from "next/server";
import { z } from "zod";
import { getModelStatus } from "@/server/ai/provider";
import { sourceRepository } from "@/server/storage/local-store";
import { assistantInfo } from "@/server/analysis/assistant-info";
import { isSeatReleaseQuestion, planSeating } from "@/server/analysis/seating";
import { analyzeFiles } from "@/server/analysis/workflow";
import type { SeatReport } from "@/types/seating";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 180;

const columnName = z.string().max(1000).optional();
const seatMapping = z.object({
  mode: z.enum(["counts", "seats"]), building: columnName, floor: columnName, seat: columnName,
  capacity: columnName, people: columnName, free: columnName, status: columnName, occupant: columnName,
});
const requestSchema = z.object({
  seatMappings: z.record(z.string().uuid(), seatMapping).optional(),
  question: z.string().trim().min(2).max(2_000),
  sourceIds: z.array(z.string().uuid()).max(30).default([]),
  history: z.array(z.object({ role: z.enum(["user", "assistant"]), content: z.string().max(4000), sourceIds: z.array(z.string().uuid()).max(30) })).max(8).default([]),
});

export async function POST(request: Request) {
  try {
    const body = requestSchema.parse(await request.json());
    const introduction = assistantInfo(body.question);
    if (introduction) return NextResponse.json({
      answer: introduction, result: null, plan: { intent: "assistant_info", sourceIds: [] }, sources: [], citations: [],
      matchedRows: 0, usedModel: false, modelAvailable: false,
    });
    if (!body.sourceIds.length) return NextResponse.json({ error: "برای تحلیل، دست‌کم یک فایل را انتخاب کنید." }, { status: 400 });
    const sources = await sourceRepository.getMany(body.sourceIds);
    if (!sources.length) return NextResponse.json({ error: "فایل معتبری برای تحلیل انتخاب نشده است." }, { status: 400 });
    if (sources.length !== new Set(body.sourceIds).size) return NextResponse.json({ error: "یکی از فایل‌های انتخاب‌شده پیدا نشد؛ فهرست منابع را تازه‌سازی کنید." }, { status: 404 });
    const publicSources = sources.map(({ id, name, kind, rowCount }) => ({ id, name, kind, rowCount }));
    const simpleSeatQuestion = isSeatReleaseQuestion(body.question) && /(سیت|صندلی|ظرفیت|seat|capacity)/iu.test(body.question)
      && !/(هزینه|اجاره|هم.?مکان|بودجه|cost|rent|budget)/iu.test(body.question);
    if (sources.some(s => s.kind === "table") && simpleSeatQuestion) {
      if (sources.some(s => s.extraction?.complete === false || (s.warnings ?? []).some(w => /بریده|متوقف|محدود شد|بارگذاری نشد/.test(w)))) {
        return NextResponse.json({ error: "حداقل یک فایل ناقص استخراج شده است؛ برای برنامهٔ واگذاری، هشدار استخراج را رفع و فایل را دوباره بارگذاری کنید." }, { status: 400 });
      }
      const result = planSeating(body.question, { intent: "seat_release", sourceIds: body.sourceIds }, sources.filter(s => s.kind === "table"), body.seatMappings ?? {});
      return NextResponse.json({ answer: (result.answerData as SeatReport).answer, result: result.answerData, plan: result.plan,
        sources: publicSources, citations: result.citations, matchedRows: result.matchedRows, usedModel: false, modelAvailable: false, note: result.note });
    }
    const ids = new Set(body.sourceIds);
    const history = body.history.filter(item => item.sourceIds.length === ids.size && item.sourceIds.every(id => ids.has(id)))
      .map(({ role, content }) => ({ role, content }));
    const analysis = await analyzeFiles(body.question, sources, history, request.signal);
    const citations = [...new Map(analysis.result.evidence.flatMap(item => item.citations).map(item => [JSON.stringify(item), item])).values()];
    const modelStatus = await getModelStatus();
    return NextResponse.json({ ...analysis, plan: { intent: "analysis", sourceIds: body.sourceIds },
      sources: publicSources, citations, matchedRows: 0, modelAvailable: modelStatus.available,
      note: sources.flatMap(source => (source.warnings ?? []).map(warning => `${source.name}: ${warning}`)).join("\n") || undefined });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "متن سؤال یا فایل‌های انتخاب‌شده معتبر نیست." }, { status: 400 });
    const message = error instanceof Error ? error.message : "پاسخ‌گویی انجام نشد.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
