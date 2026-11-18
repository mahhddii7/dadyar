import { NextResponse } from "next/server";
import { z } from "zod";
import { createAnswer } from "@/server/analysis/answer";
import { executePlan } from "@/server/analysis/engine";
import { createQueryPlan } from "@/server/analysis/query-plan";
import { getModelStatus } from "@/server/ai/provider";
import { sourceRepository } from "@/server/storage/local-store";
import { assistantInfo } from "@/server/analysis/assistant-info";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const columnName = z.string().max(1000).optional();
const seatMapping = z.object({
  mode: z.enum(["counts", "seats"]), building: columnName, floor: columnName, seat: columnName,
  capacity: columnName, people: columnName, free: columnName, status: columnName, occupant: columnName,
});
const requestSchema = z.object({
  seatMappings: z.record(z.string().uuid(), seatMapping).optional(),
  question: z.string().trim().min(2).max(2_000),
  sourceIds: z.array(z.string().uuid()).max(30).default([]),
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
    const { plan, usedModel } = await createQueryPlan(body.question, sources);
    const result = executePlan(body.question, plan, sources, body.seatMappings);
    let modelResponded = usedModel;
    let modelIssue: string | undefined;
    const answer = await createAnswer(body.question, result, sources, () => { modelResponded = true; }, reason => { modelIssue = reason; });
    const modelStatus = await getModelStatus();
    const usedSourceIds = new Set(result.plan.sourceIds?.length ? result.plan.sourceIds : body.sourceIds);
    const usedSources = sources.filter((source) => usedSourceIds.has(source.id)).map(({ id, name, kind, rowCount }) => ({ id, name, kind, rowCount }));
    return NextResponse.json({
      answer,
      result: result.answerData,
      plan: result.plan,
      sources: usedSources,
      citations: result.citations,
      matchedRows: result.matchedRows,
      usedModel: modelResponded,
      modelIssue,
      modelAvailable: modelStatus.available,
      note: result.note,
    });
  } catch (error) {
    if (error instanceof z.ZodError) return NextResponse.json({ error: "متن سؤال یا فایل‌های انتخاب‌شده معتبر نیست." }, { status: 400 });
    const message = error instanceof Error ? error.message : "پاسخ‌گویی انجام نشد.";
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
