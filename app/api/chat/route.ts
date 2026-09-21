import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const message = String(body.message ?? "").trim();
    if (!message) return NextResponse.json({error:"请输入巡礼需求。"},{status:400});
    return NextResponse.json(await runAgent(message, body.context));
  } catch (error) {
    const message = error instanceof Error ? error.message : "服务暂时不可用";
    return NextResponse.json({error:message},{status:500});
  }
}
