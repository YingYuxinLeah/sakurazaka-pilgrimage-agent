import { NextRequest, NextResponse } from "next/server";
import { runAgent } from "@/lib/agent";
import { consumeDemoQuota, DemoQuotaError } from "@/lib/demo-quota";

export async function POST(request: NextRequest) {
  try {
    const contentLength=Number(request.headers.get("content-length") ?? 0);
    if(contentLength>120_000) return NextResponse.json({error:"对话内容过长，请点击“新对话”后重试。"},{status:413});
    const body: any = await request.json();
    const message = String(body.message ?? "").trim();
    if (!message) return NextResponse.json({error:"请输入巡礼需求。"},{status:400});
    if(message.length>500) return NextResponse.json({error:"单条消息最多 500 字。"},{status:400});
    const usage=await consumeDemoQuota(request);
    return NextResponse.json({...await runAgent(message, body.context),usage});
  } catch (error) {
    if(error instanceof DemoQuotaError) return NextResponse.json({error:error.message,code:error.code},{status:error.code==="quota_unavailable"?503:429,headers:{"Retry-After":"86400"}});
    const message = error instanceof Error ? error.message : "服务暂时不可用";
    return NextResponse.json({error:message},{status:500});
  }
}
