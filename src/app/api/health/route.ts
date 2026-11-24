import { NextResponse } from "next/server";
import { getModelStatus, requestModel, modelErrorMessage } from "@/server/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: await getModelStatus() });
}

export async function POST() {
  try {
    await requestModel([{ role: "user", content: "Reply with OK. This is a connection test." }]);
    return NextResponse.json({ connected: true, message: "مدل به درخواست آزمایشی پاسخ داد." });
  } catch (error) { return NextResponse.json({ connected: false, message: modelErrorMessage(error) }, { status: 503 }); }
}
