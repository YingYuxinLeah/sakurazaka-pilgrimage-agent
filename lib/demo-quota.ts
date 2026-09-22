import { env } from "cloudflare:workers";

export const VISITOR_DAILY_LIMIT = 8;
export const SITE_DAILY_LIMIT = 120;

export class DemoQuotaError extends Error {
  constructor(public code:"visitor_limit"|"site_limit"|"quota_unavailable", message:string) {
    super(message);
  }
}

async function digest(value:string) {
  const bytes = new TextEncoder().encode(`sakurazaka-demo-v1:${value}`);
  const hash = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(hash)].map((byte)=>byte.toString(16).padStart(2,"0")).join("");
}

function visitorFingerprint(request:Request) {
  const signedInId=request.headers.get("oai-authenticated-user-id");
  const ip=request.headers.get("cf-connecting-ip") ?? request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  const agent=request.headers.get("user-agent")?.slice(0,160) ?? "unknown";
  return signedInId ? `user:${signedInId}` : `anonymous:${ip}:${agent}`;
}

export async function consumeDemoQuota(request:Request) {
  const db=env.DB;
  if(!db) throw new DemoQuotaError("quota_unavailable","公开 Demo 的限额服务暂时不可用，请稍后再试。");
  const day=new Date().toISOString().slice(0,10);
  const clientHash=await digest(visitorFingerprint(request));
  const visitor=await db.prepare(`
    INSERT INTO demo_client_usage (day, client_hash, request_count) VALUES (?, ?, 1)
    ON CONFLICT(day, client_hash) DO UPDATE SET request_count=request_count+1
    WHERE request_count < ? RETURNING request_count
  `).bind(day,clientHash,VISITOR_DAILY_LIMIT).first<{request_count:number}>();
  if(!visitor) throw new DemoQuotaError("visitor_limit",`今日体验次数已用完（每位访客 ${VISITOR_DAILY_LIMIT} 次），明天可以继续体验。`);
  const total=await db.prepare(`
    INSERT INTO demo_daily_usage (day, request_count) VALUES (?, 1)
    ON CONFLICT(day) DO UPDATE SET request_count=request_count+1
    WHERE request_count < ? RETURNING request_count
  `).bind(day,SITE_DAILY_LIMIT).first<{request_count:number}>();
  if(!total) throw new DemoQuotaError("site_limit",`今日公开 Demo 总额度已用完（${SITE_DAILY_LIMIT} 次），请明天再试。`);
  return {visitorRemaining:Math.max(0,VISITOR_DAILY_LIMIT-visitor.request_count),visitorLimit:VISITOR_DAILY_LIMIT};
}
