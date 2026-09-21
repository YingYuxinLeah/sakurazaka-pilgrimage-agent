const messagesEl = document.querySelector("#messages");
const quickRepliesEl = document.querySelector("#quickReplies");
const composer = document.querySelector("#composer");
const input = document.querySelector("#messageInput");
const sendButton = document.querySelector("#sendButton");
const resetButton = document.querySelector("#resetButton");
const modeLabel = document.querySelector("#modeLabel");
const memoryBar = document.querySelector("#memoryBar");
const routeSummary = document.querySelector("#routeSummary");
const routeStops = document.querySelector("#routeStops");
const routeStatus = document.querySelector("#routeStatus");
const resultTitle = document.querySelector("#resultTitle");
const mapEmpty = document.querySelector("#mapEmpty");
const aboutDialog = document.querySelector("#aboutDialog");
const loadingTemplate = document.querySelector("#loadingTemplate");

let map;
let routeLayer;
let markerLayer;
let liveBackend = false;
let busy = false;
let demoState = 0;
let conversation = [];

const demoRoute = {
  status: "planned",
  start_point: "六本木站",
  available_minutes: 240,
  total_walking_minutes: 26,
  total_visit_minutes: 85,
  estimated_total_minutes: 111,
  buffer_minutes: 129,
  used_time_percent: 46,
  pilgrimage_stop_count: 1,
  expansion_suggested: true,
  meal_requirement_satisfied: true,
  meal_source: "ordinary_restaurant",
  stops: [
    { sequence: 1, name: "スペイン坂（六本木）", category: "景点", address: "港区六本木一丁目スペイン坂", assumed_visit_minutes: 25, source_type: "pilgrimage" },
    { sequence: 2, name: "六本木附近普通餐厅", category: "餐厅", address: "六本木站附近", assumed_visit_minutes: 60, source_type: "ordinary_restaurant" }
  ],
  legs: [
    { from: "六本木站", to: "スペイン坂（六本木）", walking_minutes: 14, walking_meters: 1037 },
    { from: "スペイン坂（六本木）", to: "六本木附近普通餐厅", walking_minutes: 12, walking_meters: 560 }
  ],
  map: {
    attribution: "© OpenStreetMap contributors",
    geometry_source: "OSRM walking route / OpenStreetMap",
    geometry_notice: null,
    route_coordinates: [
      [139.731438, 35.662746], [139.7338, 35.6641], [139.7371, 35.6654], [139.740133, 35.666168], [139.7383, 35.6647], [139.7358, 35.6632]
    ],
    markers: [
      { sequence: 0, name: "六本木站", kind: "start", latitude: 35.662746, longitude: 139.731438 },
      { sequence: 1, name: "スペイン坂（六本木）", kind: "pilgrimage", latitude: 35.666168, longitude: 139.740133 },
      { sequence: 2, name: "六本木附近普通餐厅", kind: "restaurant", latitude: 35.6632, longitude: 139.7358 }
    ],
    bounds: { south: 35.662746, west: 139.731438, north: 35.666168, east: 139.740133 },
    distance_meters: 1597,
    duration_minutes: 26
  }
};

function initMap() {
  if (!window.L) return;
  map = L.map("map", { zoomControl: true, attributionControl: true }).setView([35.665, 139.736], 14);
  L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
    maxZoom: 19,
    attribution: '&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
  }).addTo(map);
  markerLayer = L.layerGroup().addTo(map);
}

function addMessage(role, text, variant = "") {
  const row = document.createElement("article");
  row.className = `message-row ${role === "user" ? "user-row" : "assistant-row"}`;
  if (role !== "user") {
    const avatar = document.createElement("div");
    avatar.className = "avatar";
    avatar.setAttribute("aria-hidden", "true");
    avatar.textContent = "坂";
    row.append(avatar);
  }
  const bubble = document.createElement("div");
  bubble.className = `message ${role === "user" ? "user-message" : "assistant-message"} ${variant}`.trim();
  const paragraph = document.createElement("p");
  paragraph.textContent = text;
  bubble.append(paragraph);
  row.append(bubble);
  messagesEl.append(row);
  messagesEl.scrollTop = messagesEl.scrollHeight;
  conversation.push({ role, text, variant });
  persistConversation();
  return row;
}

function showLoading() {
  const node = loadingTemplate.content.cloneNode(true);
  messagesEl.append(node);
  messagesEl.scrollTop = messagesEl.scrollHeight;
}

function hideLoading() {
  document.querySelector(".loading-row")?.remove();
}

function renderQuickReplies(items = []) {
  quickRepliesEl.replaceChildren();
  items.forEach((label) => {
    const button = document.createElement("button");
    button.type = "button";
    button.textContent = label;
    button.dataset.message = label === "体验示例"
      ? "我想从六本木站出发，在港区巡礼4小时，需要安排用餐，只看中嶋優月相关地点。"
      : label === "只说部分条件"
        ? "我想在港区巡礼"
        : label;
    quickRepliesEl.append(button);
  });
}

function renderMemory(items = []) {
  memoryBar.replaceChildren();
  if (!items.length) {
    const empty = document.createElement("span");
    empty.textContent = "尚未确认规划条件";
    memoryBar.append(empty);
    return;
  }
  items.forEach((item) => {
    const chip = document.createElement("span");
    chip.className = "memory-chip";
    chip.textContent = `${item.label}：${item.value}`;
    memoryBar.append(chip);
  });
}

function markerIcon(marker) {
  return L.divIcon({
    className: `numbered-marker ${marker.kind}`,
    html: String(marker.sequence),
    iconSize: [32, 32],
    iconAnchor: [16, 16]
  });
}

function renderRoute(route) {
  if (!route?.map || !map) return;
  mapEmpty.hidden = true;
  routeSummary.hidden = false;
  routeStops.hidden = false;
  resultTitle.textContent = `${route.start_point}巡礼路线`;
  routeStatus.textContent = `${route.stops.length}站 · 约${route.estimated_total_minutes}分钟`;

  markerLayer.clearLayers();
  if (routeLayer) routeLayer.remove();
  const latLngs = route.map.route_coordinates.map(([longitude, latitude]) => [latitude, longitude]);
  routeLayer = L.polyline(latLngs, {
    color: "#65459a",
    weight: 6,
    opacity: 0.9,
    dashArray: route.map.geometry_source === "straight_line_fallback" ? "10 9" : null,
    lineCap: "round"
  }).addTo(map);
  route.map.markers.forEach((marker) => {
    L.marker([marker.latitude, marker.longitude], { icon: markerIcon(marker) })
      .bindPopup(`<strong>${escapeHtml(marker.name)}</strong>`)
      .addTo(markerLayer);
  });
  const bounds = L.latLngBounds(latLngs);
  map.fitBounds(bounds, { padding: [42, 42], maxZoom: 16 });

  routeSummary.innerHTML = "";
  [
    ["步行", `${route.total_walking_minutes}分钟`],
    ["停留与用餐", `${route.total_visit_minutes}分钟`],
    ["剩余缓冲", `${route.buffer_minutes}分钟`]
  ].forEach(([label, value]) => {
    const card = document.createElement("div");
    card.className = "stat-card";
    const caption = document.createElement("span");
    caption.textContent = label;
    const strong = document.createElement("strong");
    strong.textContent = value;
    card.append(caption, strong);
    routeSummary.append(card);
  });
  if (route.map.geometry_notice) {
    const notice = document.createElement("div");
    notice.className = "map-notice";
    notice.textContent = route.map.geometry_notice;
    routeSummary.append(notice);
  }

  routeStops.innerHTML = "";
  route.stops.forEach((stop, index) => {
    const card = document.createElement("article");
    card.className = "stop-card";
    const number = document.createElement("span");
    number.className = `stop-number ${stop.category === "餐厅" ? "restaurant" : ""}`;
    number.textContent = stop.sequence;
    const copy = document.createElement("div");
    const title = document.createElement("strong");
    title.textContent = stop.name;
    const detail = document.createElement("small");
    detail.textContent = stop.source_type === "ordinary_restaurant" ? "普通餐厅 · 非巡礼地点" : stop.address;
    copy.append(title, detail);
    const time = document.createElement("span");
    time.className = "stop-time";
    time.textContent = index === 0 ? `${route.legs[0]?.walking_minutes ?? 0}分钟步行` : `${stop.assumed_visit_minutes}分钟停留`;
    card.append(number, copy, time);
    routeStops.append(card);
  });
  setTimeout(() => map.invalidateSize(), 80);
}

function escapeHtml(value) {
  return String(value).replace(/[&<>'"]/g, (character) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;"
  })[character]);
}

function setBusy(value) {
  busy = value;
  input.disabled = value;
  sendButton.disabled = value;
}

async function detectBackend() {
  try {
    const response = await fetch("/api/health", { cache: "no-store" });
    const data = await response.json();
    liveBackend = Boolean(response.ok && data.mode === "live-agent");
  } catch {
    liveBackend = false;
  }
  modeLabel.textContent = liveBackend ? "在线 · 真实 Agent 模式" : "在线 · 作品演示模式";
}

function demoResponse(text) {
  const normalized = text.replace(/\s/g, "");
  if (normalized.includes("保持当前方案")) {
    return { assistant: "好的，已保留当前成员限制和路线。你仍可以继续修改时长、用餐需求或出发地点。", quickReplies: [], tripState: demoMemory(), route: demoRoute };
  }
  if (normalized.includes("放宽成员限制")) {
    return { assistant: "已取消成员限制。我会补充港区内其他成员相关地点并重新计算路线。演示版暂时展示原路线，真实后端会重新查询并规划。", quickReplies: [], tripState: [...demoMemory().filter((item) => item.key !== "member"), { key: "member", label: "成员", value: "不限" }], route: demoRoute };
  }
  if (normalized.includes("普通餐厅") && demoState >= 1) {
    demoState = 2;
    return { assistant: "已获得你的同意。我查询了附近普通餐厅，并完成步行路线计算。普通餐厅不是巡礼地点，出行前请核实营业状态。", quickReplies: ["放宽成员限制", "保持当前方案"], tripState: demoMemory(), route: demoRoute };
  }
  if (normalized.includes("暂不安排用餐")) {
    demoState = 2;
    const routeWithoutMeal = structuredClone(demoRoute);
    routeWithoutMeal.stops = routeWithoutMeal.stops.filter((stop) => stop.category !== "餐厅");
    routeWithoutMeal.map.markers = routeWithoutMeal.map.markers.filter((marker) => marker.kind !== "restaurant");
    routeWithoutMeal.map.route_coordinates = routeWithoutMeal.map.route_coordinates.slice(0, 4);
    routeWithoutMeal.estimated_total_minutes = 39;
    routeWithoutMeal.total_visit_minutes = 25;
    routeWithoutMeal.buffer_minutes = 201;
    routeWithoutMeal.meal_requirement_satisfied = false;
    return { assistant: "好的，我不会查询普通餐厅。已保留严格满足成员条件的巡礼路线，但本次行程没有安排用餐。", quickReplies: ["放宽成员限制", "保持当前方案"], tripState: demoMemory(), route: routeWithoutMeal };
  }
  if (normalized.includes("港区") && (normalized.includes("4小时") || normalized.includes("半日"))) {
    demoState = 1;
    return { assistant: "条件已记录。在六本木站附近只找到1处中嶋優月相关巡礼点，没有找到相关巡礼餐厅。是否允许我查询附近普通餐厅？", quickReplies: ["查询普通餐厅", "暂不安排用餐"], tripState: demoMemory(), route: null };
  }
  if (normalized.includes("港区")) {
    demoState = 0;
    return { assistant: "已记录港区。为了计算可执行路线，请再告诉我：从哪里出发、可用多长时间，以及是否需要安排用餐？", quickReplies: ["六本木站，半日，需要用餐", "六本木站，2小时，不需要用餐"], tripState: [{ key: "area", label: "区域", value: "港区" }], route: null };
  }
  return { assistant: "请告诉我巡礼区域、出发地点、可用时长和用餐需求。例如：从六本木站出发，在港区巡礼4小时，需要安排用餐。", quickReplies: ["体验示例"], tripState: [], route: null };
}

function demoMemory() {
  return [
    { key: "area", label: "区域", value: "港区" },
    { key: "start_point", label: "起点", value: "六本木站" },
    { key: "available_minutes", label: "时长", value: "4小时" },
    { key: "need_meal", label: "用餐", value: "需要" },
    { key: "member", label: "成员", value: "中嶋優月" }
  ];
}

async function sendMessage(text) {
  const trimmed = text.trim();
  if (!trimmed || busy) return;
  addMessage("user", trimmed);
  input.value = "";
  autoResize();
  renderQuickReplies([]);
  setBusy(true);
  showLoading();
  let data;
  try {
    if (liveBackend) {
      const response = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ message: trimmed })
      });
      data = await response.json();
      if (!response.ok) throw new Error(data.error || "规划服务暂时不可用。 ");
    } else {
      await new Promise((resolve) => setTimeout(resolve, 520));
      data = demoResponse(trimmed);
    }
    hideLoading();
    addMessage("assistant", data.assistant || "本轮已完成。", liveBackend ? "" : "mode-message");
    renderMemory(data.tripState || []);
    renderQuickReplies(data.quickReplies || []);
    if (data.route) renderRoute(data.route);
  } catch (error) {
    hideLoading();
    addMessage("assistant", `${error.message}\n你仍可以点击“新对话”重试，或使用公开演示模式体验完整流程。`, "error-message");
    modeLabel.textContent = "连接异常 · 可刷新重试";
  } finally {
    setBusy(false);
    input.focus();
  }
}

function autoResize() {
  input.style.height = "auto";
  input.style.height = `${Math.min(input.scrollHeight, 128)}px`;
}

function persistConversation() {
  try { localStorage.setItem("sakamichi-agent-history", JSON.stringify(conversation.slice(-30))); } catch {}
}

function restoreConversation() {
  try {
    const stored = JSON.parse(localStorage.getItem("sakamichi-agent-history") || "[]");
    if (!Array.isArray(stored) || !stored.length) return;
    messagesEl.innerHTML = "";
    conversation = [];
    stored.forEach((item) => addMessage(item.role, item.text, item.variant));
  } catch {}
}

async function resetConversation() {
  if (busy) return;
  if (liveBackend) {
    try { await fetch("/api/reset", { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" }); } catch {}
  }
  localStorage.removeItem("sakamichi-agent-history");
  conversation = [];
  demoState = 0;
  messagesEl.innerHTML = "";
  addMessage("assistant", "新对话已开始。告诉我区域、起点和可用时间，我会从确认条件开始规划。 ");
  renderMemory([]);
  renderQuickReplies(["体验示例", "只说部分条件"]);
  routeSummary.hidden = true;
  routeStops.hidden = true;
  routeStatus.textContent = "尚无路线";
  resultTitle.textContent = "等待规划";
  mapEmpty.hidden = false;
  markerLayer?.clearLayers();
  routeLayer?.remove();
  routeLayer = null;
  map?.setView([35.665, 139.736], 14);
}

composer.addEventListener("submit", (event) => { event.preventDefault(); sendMessage(input.value); });
input.addEventListener("input", autoResize);
input.addEventListener("keydown", (event) => {
  if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); composer.requestSubmit(); }
});
quickRepliesEl.addEventListener("click", (event) => {
  const button = event.target.closest("button[data-message]");
  if (button) sendMessage(button.dataset.message);
});
resetButton.addEventListener("click", resetConversation);
document.querySelector("#aboutButton").addEventListener("click", () => aboutDialog.showModal());

initMap();
restoreConversation();
detectBackend();
