import { NextResponse } from "next/server";
import { getModelStatus } from "@/server/ai/provider";

export const dynamic = "force-dynamic";

export async function GET() {
  return NextResponse.json({ status: await getModelStatus() });
}
