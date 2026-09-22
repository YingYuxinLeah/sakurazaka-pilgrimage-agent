import snapshot from '@/data/sakumap_places.json';
export const endpoint = 'https://buddies46.stars.ne.jp/satellite/sakumap/api.php?action=spots_list';
export function normalizeFeed(payload: any, fetchedAt = new Date().toISOString()) {
  if (payload?.ok !== true || !Array.isArray(payload.data) || !payload.data.length) throw new Error('地点列表格式异常');
  const ids = new Set();
  const places = payload.data.map((p: any) => {
    const latitude = Number(p.lat), longitude = Number(p.lng);
    if (!p.id || !p.title || !p.address || p.lat == null || p.lng == null || !Number.isFinite(latitude) || !Number.isFinite(longitude) || Math.abs(latitude)>90 || Math.abs(longitude)>180 || ids.has(p.id)) throw new Error('地点记录缺失或重复');
    ids.add(p.id);
    return {id:`sakumap_${p.id}`,source_id:p.id,name:p.title,summary:p.summary||'',address:p.address,latitude,longitude,
      planning_category:p.cat==='gourmet'?'餐厅':'景点',source_category:p.cat,source_category_label:p.cat_label,
      tags:Array.isArray(p.tags)?p.tags.filter((x:any)=>typeof x==='string'):[],source_url:`https://buddies46.stars.ne.jp/satellite/sakumap/?spot=${p.id}`};
  });
  return {metadata:{source_name:'SakuMap',source_page:'https://buddies46.stars.ne.jp/satellite/sakumap/',source_endpoint:endpoint,fetched_at:fetchedAt,record_count:places.length},places};
}
let cached: any = snapshot;
let nextCheck = 0;
let inFlight: Promise<any> | null = null;
let failed = false;
export async function loadPlaces() {
  if (Date.now() >= nextCheck) {
    if (!inFlight) inFlight = (async()=>{
      try {
        const response = await fetch(endpoint,{signal:AbortSignal.timeout(10000)});
        if(!response.ok) throw new Error('source unavailable');
        const next=normalizeFeed(await response.json());
        if(next.places.length < cached.places.length*.8) throw new Error('地点数量异常下降');
        cached=next; failed=false; nextCheck=Date.now()+15*60*1000;
      } catch { failed=true; nextCheck=Date.now()+60*1000; }
      finally { inFlight=null; }
    })();
    await inFlight;
  }
  return {...cached,refresh_failed:failed};
}
