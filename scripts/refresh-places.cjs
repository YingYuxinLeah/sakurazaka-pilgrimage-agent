require('./test-loader.cjs');
const fs=require('fs'); const {normalizeFeed,endpoint}=require('../lib/place-source.ts');
(async()=>{
 const response=await fetch(endpoint,{signal:AbortSignal.timeout(25000)}); if(!response.ok) throw new Error('刷新失败');
 const next=normalizeFeed(await response.json());
 const file='data/sakumap_places.json',old=JSON.parse(fs.readFileSync(file));
 if(next.places.length<old.places.length*.8) throw new Error('数量下降超过20%，保留原快照');
 const before=new Set(old.places.map(p=>p.id));
 fs.writeFileSync(file+'.tmp',JSON.stringify(next,null,2)+'\n');fs.renameSync(file+'.tmp',file);
 console.log(JSON.stringify({before:before.size,after:next.places.length,added:next.places.filter(p=>!before.has(p.id)).map(p=>p.name),fetched_at:next.metadata.fetched_at}));
})().catch(e=>{console.error(e.message);process.exit(1)});
