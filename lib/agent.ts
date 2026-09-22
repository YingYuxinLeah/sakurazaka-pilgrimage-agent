import snapshot from "@/data/sakumap_places.json";

export type ChatMessage = { role: "user" | "assistant"; content: string };
export type TripState = {
  area: string | null;
  start_point: string | null;
  available_minutes: number | null;
  need_meal: boolean | null;
  member: string;
  member_explicit: boolean;
  start_latitude: number | null;
  start_longitude: number | null;
  start_display_name: string | null;
  ordinary_restaurant_consent: boolean | null;
};
export type Candidate = {
  id: string; name: string; summary: string; address: string;
  latitude: number; longitude: number; category: "景点" | "餐厅";
  tags: string[]; source_url: string; source_type: "pilgrimage" | "ordinary_restaurant";
  straight_line_km?: number;
};
export type AgentContext = {
  messages: ChatMessage[];
  tripState: TripState;
  candidates: Candidate[];
  route: Record<string, unknown> | null;
};

const placeData = snapshot.places as Array<Record<string, any>>;
const restaurantKeywords = ["カフェ", "喫茶", "レストラン", "食堂", "うどん", "そば", "ラーメン", "ダイニング", "焼肉", "鮨", "寿司", "居酒屋"];
const requiredFields: Array<[keyof TripState, string]> = [
  ["area", "巡礼区域"], ["start_point", "出发地点"], ["available_minutes", "可用时长"], ["need_meal", "是否需要用餐"],
];

export function freshContext(): AgentContext {
  return {
    messages: [], candidates: [], route: null,
    tripState: {
      area: null, start_point: null, available_minutes: null, need_meal: null,
      member: "不限", member_explicit: false, start_latitude: null,
      start_longitude: null, start_display_name: null,
      ordinary_restaurant_consent: null,
    },
  };
}

function normalize(value: unknown) { return String(value ?? "").normalize("NFKC").replace(/\s/g, "").toLowerCase(); }
function canonicalArea(value: unknown) {
  return normalize(value)
    .replace(/^东京都/, "")
    .replace(/(?:附近|周边|范围内|范围|一带|区域)$/g, "");
}
function canonicalMember(value: unknown) {
  const cleaned = normalize(value)
    .replace(/^(?:成员|推し|限定|只看|仅看)/g, "")
    .replace(/(?:相关的?地点|相关地点|成员|推し|限定|只看|仅看)$/g, "")
    .replace(/[。,.，、！!？?]/g, "");
  const aliases: Record<string, string> = {
    "中岛优月": "中嶋優月", "中岛優月": "中嶋優月",
    "中嶋优月": "中嶋優月", "中嶋優月": "中嶋優月",
  };
  return aliases[cleaned] ?? cleaned;
}
function missingFields(state: TripState) { return requiredFields.filter(([key]) => state[key] == null).map(([, label]) => label); }
function haversine(lat1: number, lon1: number, lat2: number, lon2: number) {
  const rad = (v: number) => v * Math.PI / 180; const radius = 6371.0088;
  const dLat = rad(lat2 - lat1); const dLon = rad(lon2 - lon1);
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLon / 2) ** 2;
  return radius * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}
function category(place: Record<string, any>): "景点" | "餐厅" {
  if (place.planning_category === "餐厅") return "餐厅";
  return restaurantKeywords.some((word) => normalize(place.name).includes(normalize(word))) ? "餐厅" : "景点";
}

function updateRequirements(context: AgentContext, args: Record<string, any>) {
  const state = context.tripState;
  for (const key of ["area", "start_point", "available_minutes", "need_meal", "member"] as const) {
    if (args[key] === undefined || args[key] === null) continue;
    if (new Set<string>(["area", "start_point", "need_meal", "member"]).has(key) && args[key] !== state[key]) state.ordinary_restaurant_consent = null;
    if (key === "start_point" && args[key] !== state.start_point) {
      state.start_latitude = null; state.start_longitude = null; state.start_display_name = null;
    }
    (state as any)[key] = args[key];
    if (key === "member") state.member_explicit = true;
  }
  const missing = missingFields(state);
  return { status: missing.length ? "incomplete" : "complete", trip_state: state, missing_fields: missing };
}

async function resolveStartPoint(context: AgentContext) {
  const state = context.tripState;
  if (!state.start_point) return { error: "start_point_missing", message: "尚未提供出发地点。" };
  const key = normalize(state.start_point);
  if (["六本木站", "六本木车站", "六本木車站", "六本木駅", "六本木"].map(normalize).includes(key)) {
    state.start_latitude = 35.662746; state.start_longitude = 139.731438; state.start_display_name = "六本木站";
    return { status: "resolved", display_name: "六本木站", latitude: state.start_latitude, longitude: state.start_longitude };
  }
  const response = await fetch(`https://msearch.gsi.go.jp/address-search/AddressSearch?q=${encodeURIComponent(state.start_point)}`);
  if (!response.ok) return { error: "start_point_resolution_failed", message: "起点解析服务暂时不可用。" };
  const items = await response.json() as any[];
  if (!items.length) return { error: "start_point_resolution_failed", message: "没有找到该起点，请补充更完整的日本地名。" };
  const first = items.find((item) => normalize(item.properties?.title) === key) ?? items[0];
  const [longitude, latitude] = first.geometry.coordinates;
  state.start_latitude = Number(latitude); state.start_longitude = Number(longitude); state.start_display_name = first.properties.title;
  return { status: "resolved", display_name: state.start_display_name, latitude, longitude, attribution: "国土地理院" };
}

function searchSakumap(context: AgentContext, args: Record<string, any>) {
  const state = context.tripState; const missing = missingFields(state);
  if (missing.length) return { error: "trip_requirements_incomplete", missing_fields: missing, message: "必要信息不完整。" };
  if (state.start_latitude == null || state.start_longitude == null) return { error: "start_point_not_resolved", message: "起点尚未解析。" };
  // 地点类别由已确认的产品状态决定。不能让模型生成的“巡礼地点/景点”等
  // 同义词直接参与数据库精确匹配，否则会把真实地点错误过滤为 0 条。
  const categories = state.need_meal ? ["景点", "餐厅"] : ["景点"];
  const max = Math.max(1, Math.min(Number(args.max_results ?? 6), 6));
  const area = canonicalArea(state.area); const member = canonicalMember(state.member);
  const candidates = placeData.flatMap((place): Candidate[] => {
    if (!normalize(place.address).includes(area)) return [];
    const inferred = category(place); if (!categories.includes(inferred)) return [];
    if (canonicalMember(state.member) !== "不限" && !(place.tags ?? []).some((tag: string) => canonicalMember(tag) === member)) return [];
    const distance = haversine(state.start_latitude!, state.start_longitude!, Number(place.latitude), Number(place.longitude));
    if (distance > 5) return [];
    return [{ id: String(place.id), name: place.name, summary: place.summary, address: place.address,
      latitude: Number(place.latitude), longitude: Number(place.longitude), category: inferred,
      tags: place.tags ?? [], source_url: place.source_url, source_type: "pilgrimage", straight_line_km: Math.round(distance * 100) / 100 }];
  }).sort((a, b) => (a.straight_line_km ?? 0) - (b.straight_line_km ?? 0));
  const restaurants = candidates.filter((p) => p.category === "餐厅"); const sights = candidates.filter((p) => p.category === "景点");
  context.candidates = state.need_meal && restaurants.length ? [...sights.slice(0, max - 1), restaurants[0]] : candidates.slice(0, state.need_meal ? Math.max(1, max - 1) : max);
  return { source: "sakumap_read_only_snapshot", count: context.candidates.length, places: context.candidates,
    pilgrimage_restaurant_count: restaurants.length,
    ordinary_restaurant_fallback_needed: Boolean(state.need_meal && !restaurants.length),
    ordinary_restaurant_consent: state.ordinary_restaurant_consent };
}

function setConsent(context: AgentContext, args: Record<string, any>) {
  context.tripState.ordinary_restaurant_consent = Boolean(args.allowed);
  return { status: "recorded", ordinary_restaurant_consent: context.tripState.ordinary_restaurant_consent };
}

async function searchOrdinaryRestaurants(context: AgentContext) {
  const state = context.tripState;
  if (state.ordinary_restaurant_consent !== true) return { error: "ordinary_restaurant_consent_required", message: "用户尚未明确同意，后端拒绝查询普通餐厅。" };
  const query = `[out:json][timeout:15];nwr(around:1200,${state.start_latitude},${state.start_longitude})["amenity"~"^(restaurant|cafe|fast_food)$"]["name"];out center tags 30;`;
  const response = await fetch(`https://overpass-api.de/api/interpreter?data=${encodeURIComponent(query)}`);
  if (!response.ok) return { error: "ordinary_restaurant_service_unavailable", message: "普通餐厅服务暂时不可用。" };
  const payload = await response.json() as any;
  const parsed: Candidate[] = (payload.elements ?? []).flatMap((item: any): Candidate[] => {
    const lat = item.lat ?? item.center?.lat; const lon = item.lon ?? item.center?.lon;
    const name = item.tags?.["name:zh"] ?? item.tags?.["name:ja"] ?? item.tags?.name;
    if (lat == null || lon == null || !name) return [];
    return [{ id: `osm_${item.type}_${item.id}`, name, summary: "OpenStreetMap附近普通餐厅（非巡礼地点）",
      address: item.tags?.["addr:full"] ?? "地址请在出行前核实", latitude: Number(lat), longitude: Number(lon),
      category: "餐厅", tags: [], source_url: `https://www.openstreetmap.org/${item.type}/${item.id}`,
      source_type: "ordinary_restaurant", straight_line_km: haversine(state.start_latitude!, state.start_longitude!, Number(lat), Number(lon)) }];
  }).sort((a, b) => (a.straight_line_km ?? 0) - (b.straight_line_km ?? 0));
  const slots = Math.max(0, 6 - context.candidates.length); const selected = parsed.slice(0, slots);
  context.candidates = [...context.candidates, ...selected];
  return { source: "OpenStreetMap", count: selected.length, restaurants: selected };
}

function permutations<T>(items: T[], length: number): T[][] {
  if (length === 0) return [[]];
  return items.flatMap((item, index) => permutations([...items.slice(0, index), ...items.slice(index + 1)], length - 1).map((rest) => [item, ...rest]));
}
async function osrm(path: "table" | "route", points: Array<{latitude:number; longitude:number}>) {
  const coords = points.map((p) => `${p.longitude},${p.latitude}`).join(";");
  const suffix = path === "table" ? "?annotations=duration,distance" : "?overview=full&geometries=geojson&steps=false";
  const response = await fetch(`https://routing.openstreetmap.de/routed-foot/${path}/v1/driving/${coords}${suffix}`, { headers: { "User-Agent": "SakamichiPilgrimageAgent/0.2" } });
  if (!response.ok) throw new Error("步行路线服务暂时不可用");
  return response.json() as Promise<any>;
}

async function planItinerary(context: AgentContext) {
  const state = context.tripState; if (!context.candidates.length) return { error: "candidate_places_missing", message: "尚未获得候选地点。" };
  const points: any[] = [{ name: state.start_point!, latitude: state.start_latitude!, longitude: state.start_longitude! }, ...context.candidates];
  let matrix: any; try { matrix = await osrm("table", points); } catch (error: any) { return { error: "walking_route_service_unavailable", message: error.message }; }
  const indices = context.candidates.map((_, i) => i + 1); const restaurantIndices = new Set(indices.filter((i) => points[i].category === "餐厅"));
  const requireRestaurant = Boolean(state.need_meal && restaurantIndices.size); let best: any = null;
  for (let count = 1; count <= indices.length; count++) for (const order of permutations(indices, count)) {
    const restaurantCount = order.filter((i) => restaurantIndices.has(i)).length; if (requireRestaurant && restaurantCount !== 1) continue;
    let prev = 0, travel = 0, valid = true;
    for (const index of order) { const duration = matrix.durations?.[prev]?.[index]; if (duration == null) { valid = false; break; } travel += duration; prev = index; }
    if (!valid) continue; const visit = order.reduce((sum, i) => sum + (points[i].category === "餐厅" ? 60 : 25), 0);
    const total = travel / 60 + visit; if (total > state.available_minutes!) continue;
    const score = [order.length, -total]; if (!best || score[0] > best.score[0] || (score[0] === best.score[0] && score[1] > best.score[1])) best = { score, order, travel, visit, total };
  }
  if (!best) return { error: "no_feasible_itinerary", message: "当前条件下没有可行路线。" };
  const stops: any[] = [], legs: any[] = []; let prev = 0;
  best.order.forEach((index: number, position: number) => {
    const place = points[index]; legs.push({ from: points[prev].name, to: place.name,
      walking_minutes: Math.round(matrix.durations[prev][index] / 60), walking_meters: Math.round(matrix.distances[prev][index]) });
    stops.push({ sequence: position + 1, ...place, assumed_visit_minutes: place.category === "餐厅" ? 60 : 25 }); prev = index;
  });
  const selected = [{ name: state.start_point!, latitude: state.start_latitude!, longitude: state.start_longitude! }, ...stops];
  let coordinates = selected.map((p) => [p.longitude, p.latitude]); let geometrySource = "straight_line_fallback"; let geometryNotice: string | null = "步行线路暂时不可用，地图仅用直线连接地点。";
  try { await new Promise((r) => setTimeout(r, 1050)); const route = await osrm("route", selected); coordinates = route.routes[0].geometry.coordinates; geometrySource = "OSRM walking route / OpenStreetMap"; geometryNotice = null; } catch {}
  const total = Math.ceil(best.total); const pilgrimageCount = stops.filter((s) => s.source_type === "pilgrimage").length;
  const result = { status: "planned", start_point: state.start_point, available_minutes: state.available_minutes,
    total_walking_minutes: Math.round(best.travel / 60), total_visit_minutes: best.visit, estimated_total_minutes: total,
    buffer_minutes: state.available_minutes! - total, used_time_percent: Math.round(total / state.available_minutes! * 100),
    pilgrimage_stop_count: pilgrimageCount, expansion_suggested: state.member !== "不限" && (pilgrimageCount < 2 || total / state.available_minutes! < .6),
    meal_requirement_satisfied: !state.need_meal || stops.some((s) => s.category === "餐厅"), stops, legs,
    map: { geometry_source: geometrySource, geometry_notice: geometryNotice, route_coordinates: coordinates,
      markers: selected.map((p, i) => ({ sequence: i, name: p.name, kind: i === 0 ? "start" : p.category === "餐厅" ? "restaurant" : "pilgrimage", latitude: p.latitude, longitude: p.longitude })) } };
  context.route = result; return result;
}

const tools = [
  { type: "function", function: { name: "update_trip_requirements", description: "从用户最新消息提取并保存明确提供的区域、起点、时长、用餐需求和成员偏好。成员没有限制时必须传member为不限。只传用户明确表达的字段。", parameters: { type: "object", properties: { area:{type:"string"}, start_point:{type:"string"}, available_minutes:{type:"integer"}, need_meal:{type:"boolean"}, member:{type:"string"} }, additionalProperties:false } } },
  { type: "function", function: { name: "resolve_start_point", description: "将已保存起点解析为坐标。条件完整后、地点查询前使用。", parameters:{type:"object",properties:{},additionalProperties:false} } },
  { type: "function", function: { name: "search_sakumap_places", description: "按已保存的区域、成员和用餐需求，查询起点5公里内的SakuMap巡礼地点。地点类别由后端根据行程状态决定。", parameters:{type:"object",properties:{max_results:{type:"integer",minimum:1,maximum:6}},required:["max_results"],additionalProperties:false} } },
  { type: "function", function: { name: "set_ordinary_restaurant_consent", description: "记录用户是否明确同意查询普通餐厅。", parameters:{type:"object",properties:{allowed:{type:"boolean"}},required:["allowed"],additionalProperties:false} } },
  { type: "function", function: { name: "search_ordinary_restaurants", description: "获得用户同意后查询普通餐厅。", parameters:{type:"object",properties:{},additionalProperties:false} } },
  { type: "function", function: { name: "plan_walking_itinerary", description: "依据真实步行矩阵选择路线并返回地图线路。", parameters:{type:"object",properties:{},additionalProperties:false} } },
];

const handlers: Record<string, (context:AgentContext,args:any)=>any> = {
  update_trip_requirements: updateRequirements, resolve_start_point: resolveStartPoint,
  search_sakumap_places: searchSakumap, set_ordinary_restaurant_consent: setConsent,
  search_ordinary_restaurants: searchOrdinaryRestaurants, plan_walking_itinerary: planItinerary,
};

const systemPrompt = `你是坂道圣地巡礼规划助手。用户提供或修改条件时先调用update_trip_requirements；必须理解同义表达和上下文，不得要求用户重复已经保存的条件。用户说成员不限、没有限制、不限定成员时，member必须设为“不限”，覆盖旧成员。信息不全时只补问missing_fields。条件完整后依次解析起点、查询地点并规划路线。没有巡礼餐厅时必须先征得同意，后端也会校验。只能依据工具结果回答，不得编造地点。路线成功后用简洁自然语言说明，并在结果过少时询问是否放宽成员限制。禁止向用户输出工具名、内部字段、JSON或英文变量名。`;

function publicState(state: TripState) {
  const values: Array<{key:string;label:string;value:string}> = [];
  if (state.area) values.push({key:"area",label:"区域",value:state.area});
  if (state.start_point) values.push({key:"start_point",label:"起点",value:state.start_point});
  if (state.available_minutes != null) values.push({key:"available_minutes",label:"时长",value:state.available_minutes % 60 === 0 ? `${state.available_minutes / 60}小时` : `${state.available_minutes}分钟`});
  if (state.need_meal != null) values.push({key:"need_meal",label:"用餐",value:state.need_meal ? "需要" : "不需要"});
  if (state.member_explicit || state.member !== "不限") values.push({key:"member",label:"成员",value:state.member});
  return values;
}
function quickReplies(context: AgentContext, last: any) {
  const missing = missingFields(context.tripState);
  if (missing.includes("出发地点")) return ["六本木站", "赤坂站"];
  if (missing.includes("可用时长")) return ["2小时", "半日", "一天"];
  if (missing.includes("是否需要用餐")) return ["需要安排用餐", "不需要用餐"];
  if (last?.ordinary_restaurant_fallback_needed && context.tripState.ordinary_restaurant_consent == null) return ["查询普通餐厅", "暂不安排用餐"];
  if ((last?.expansion_suggested || (context.route as any)?.expansion_suggested)) return ["放宽成员限制", "保持当前方案"];
  return [];
}

export async function runAgent(message: string, incoming?: Partial<AgentContext>) {
  const apiKey = process.env.DASHSCOPE_API_KEY; if (!apiKey) throw new Error("服务端尚未配置模型密钥");
  const base = freshContext(); const context: AgentContext = {
    ...base, ...incoming,
    messages: Array.isArray(incoming?.messages) ? incoming!.messages.slice(-20) : [],
    tripState: {...base.tripState, ...(incoming?.tripState ?? {})},
    candidates: Array.isArray(incoming?.candidates) ? incoming!.candidates.slice(0, 6) : [],
  };
  // 否定式成员偏好必须稳定覆盖旧状态，不能完全依赖模型是否准确抽取。
  // 模型仍负责理解其余自由表达与决定后续工具调用。
  if (/(?:成员|偶像|推し).{0,6}(?:不限|没有限制|不限制|不限定)|(?:不限|不限制|不限定).{0,6}(?:成员|偶像|推し)/i.test(message)) {
    updateRequirements(context, { member: "不限" });
  }
  context.messages.push({role:"user",content:message}); let last:any = null;
  const modelMessages:any[] = [{role:"system",content:`${systemPrompt}\n当前已保存条件：${JSON.stringify(context.tripState)}`}, ...context.messages];
  for (let step=0; step<6; step++) {
    const response = await fetch("https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions", { method:"POST", headers:{"Content-Type":"application/json",Authorization:`Bearer ${apiKey}`}, body:JSON.stringify({model:"qwen3.7-plus",messages:modelMessages,tools,tool_choice:"auto",temperature:0}) });
    if (!response.ok) throw new Error(`模型服务返回 ${response.status}`); const payload = await response.json() as any; const output = payload.choices?.[0]?.message;
    if (!output) throw new Error("模型没有返回有效内容");
    if (!output.tool_calls?.length) {
      const assistant = output.content || "本轮已完成。"; context.messages.push({role:"assistant",content:assistant});
      return { assistant, tripState: publicState(context.tripState), quickReplies: quickReplies(context,last), route: context.route, context };
    }
    modelMessages.push({role:"assistant",content:output.content ?? "",tool_calls:output.tool_calls});
    for (const call of output.tool_calls) {
      const name = call.function.name; const args = JSON.parse(call.function.arguments || "{}");
      if (!handlers[name]) last = {error:"tool_not_allowed"}; else last = await handlers[name](context,args);
      modelMessages.push({role:"tool",tool_call_id:call.id,content:JSON.stringify(last)});
    }
  }
  throw new Error("本轮工具调用步骤过多");
}
