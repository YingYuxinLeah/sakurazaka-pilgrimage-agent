import { Fragment } from 'react';
function inline(text:string) {
  return text.split(/(\*\*[^*]+\*\*|`[^`]+`|\[[^\]]+\]\(https?:\/\/[^)]+\))/g).map((part,i)=>{
    if(part.startsWith('**')) return <strong key={i}>{part.slice(2,-2).trim()}</strong>;
    if(part.startsWith('`')) return <code key={i}>{part.slice(1,-1)}</code>;
    const link=part.match(/^\[([^\]]+)\]\((https?:\/\/[^)]+)\)$/);
    if(link) return <a key={i} href={link[2]} target="_blank" rel="noreferrer">{link[1]}</a>;
    return <Fragment key={i}>{part}</Fragment>;
  });
}
export function MessageContent({text}:{text:string}) {
  const lines=text.replace(/\r/g,'').split('\n'); const blocks=[];
  for(let i=0;i<lines.length;i++) {
    const line=lines[i].trim(); if(!line || /^[-*_]{3,}$/.test(line)) continue;
    if(line.startsWith('|') && /^\|?[\s:|-]+$/.test(lines[i+1]?.trim()||'x')) {
      const cells=(row:string)=>row.replace(/^\||\|$/g,'').split('|').map(x=>x.trim());
      const headers=cells(line); i+=2; const rows=[];
      for(;i<lines.length && lines[i].trim().startsWith('|');i++) rows.push(cells(lines[i].trim())); i--;
      blocks.push(<div className="message-data-cards" key={i}>{rows.map((row,r)=><dl key={r}>{row.map((cell,c)=><div key={c}><dt>{inline(headers[c]||'详情')}</dt><dd>{inline(cell)}</dd></div>)}</dl>)}</div>); continue;
    }
    if(/^#{1,6}\s/.test(line)) {blocks.push(<h3 key={i}>{inline(line.replace(/^#{1,6}\s+/,''))}</h3>);continue;}
    if(/^(?:[-*•]|\d+[.、])\s/.test(line)) {
      const ordered=/^\d/.test(line); const items=[];
      for(;i<lines.length && /^(?:[-*•]|\d+[.、])\s/.test(lines[i].trim());i++) items.push(<li key={i}>{inline(lines[i].trim().replace(/^(?:[-*•]|\d+[.、])\s+/,''))}</li>); i--;
      blocks.push(ordered?<ol key={i}>{items}</ol>:<ul key={i}>{items}</ul>);continue;
    }
    blocks.push(<p key={i}>{inline(line.replace(/^>\s?/,''))}</p>);
  }
  return <div className="message-content">{blocks}</div>;
}
