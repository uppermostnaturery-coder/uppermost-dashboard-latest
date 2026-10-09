"use client";
import { useRef,useState } from 'react';
import { api,Badge,date,Field,styles,Table } from './shared';
type Row={id:string|number;created_at:string;source:string;[key:string]:unknown};
type Link={id:string;visitor_id:string;confidence:string;valid_from:string;valid_until:string|null};
type Cursor={before:string;before_id:string};
type Page={source:string;extra:Record<string,string>;cursor:Cursor|null};
export default function CustomerJourney(){
 const [customer,setCustomer]=useState('');const [active,setActive]=useState('');const [links,setLinks]=useState<Link[]>([]);const [linkCursor,setLinkCursor]=useState<string|null>(null);
 const [timeline,setTimeline]=useState<Row[]>([]);const [pages,setPages]=useState<Record<string,Page>>({});const [notice,setNotice]=useState('');const [busy,setBusy]=useState(false);const generation=useRef(0);
 async function loadPage(id:string,source:string,extra:Record<string,string>={},cursor?:Cursor,token=generation.current){
  const params=new URLSearchParams({customer_id:id,source,...extra,...cursor});const result=await api(`/api/admin/analytics?${params}`);
  if(token!==generation.current)return;
  const key=source+JSON.stringify(extra);
  setTimeline(previous=>{const entries=new Map(previous.map(row=>[`${row.source}:${row.id}`,row]));for(const row of result.data)entries.set(`${source}:${row.id}`,{...row,source});return [...entries.values()].sort((a,b)=>b.created_at.localeCompare(a.created_at));});
  setPages(previous=>({...previous,[key]:{source,extra,cursor:result.next_cursor}}));
 }
 async function inspect(id:string){const token=++generation.current;setBusy(true);setNotice('');setActive(id);setTimeline([]);setPages({});setLinks([]);setLinkCursor(null);
  try{const identity=await api(`/api/admin/analytics?${new URLSearchParams({customer_id:id,source:'identity'})}`);if(token!==generation.current)return;setLinks(identity.data);setLinkCursor(identity.next_link_cursor);await Promise.all(['orders','subscriptions','communications'].map(source=>loadPage(id,source,{},undefined,token)));}catch(e){if(token===generation.current)setNotice((e as Error).message);}finally{if(token===generation.current)setBusy(false);}
 }
 async function run(work:()=>Promise<unknown>){setBusy(true);try{await work();setNotice('');}catch(e){setNotice((e as Error).message);}finally{setBusy(false);}}
 return <section className={styles.panel}><h2>Customer journey</h2><p>Support view of identified browser history and commerce events. Every source loads at most 50 records per page; rules do not use this timeline.</p>
  <form onSubmit={e=>{e.preventDefault();inspect(customer);}}><Field label="Customer UUID"><input required value={customer} onChange={e=>setCustomer(e.target.value)} placeholder="Customer UUID"/></Field><button disabled={busy}>Inspect journey</button></form>
  {notice&&<p role="status">{notice}</p>}{busy&&<p role="status">Loading journey…</p>}
  {links.length>0&&<><h3>Identity history</h3><Table columns={['Visitor','Confidence','Valid from','Valid until','History']} rows={links.map(link=>[link.visitor_id,<Badge key={link.id} value={link.confidence}/>,date(link.valid_from),date(link.valid_until),<button key={link.id} disabled={busy} onClick={()=>run(()=>loadPage(active,'analytics',{visitor_id:link.visitor_id,link_id:link.id}))}>Load browser events</button>])}/></>}
  {linkCursor&&<button disabled={busy} onClick={()=>run(async()=>{const result=await api(`/api/admin/analytics?${new URLSearchParams({customer_id:active,source:'identity',link_cursor:linkCursor})}`);setLinks(previous=>[...previous,...result.data]);setLinkCursor(result.next_link_cursor);})}>Next 50 identity links</button>}
  <Table columns={['Time','Source','Event / status','Context','More']} rows={timeline.map(row=>[date(row.created_at),row.source,String(row.event_name||row.title||row.status||'Event'),row.identity_confidence?String(row.identity_confidence):row.total_paise!==undefined?`${row.total_paise} paise`:String(row.order_id||row.id),row.source==='orders'?<button key={row.id} disabled={busy} onClick={()=>run(()=>Promise.all(['payments','shipments'].map(source=>loadPage(active,source,{order_id:String(row.id)}))))}>Load payments / shipments</button>:null])}/>
  <div className={styles.toolbar}>{Object.entries(pages).filter(([,page])=>page.cursor).map(([key,page])=><button key={key} disabled={busy} onClick={()=>run(()=>loadPage(active,page.source,page.extra,page.cursor!))}>Next 50 {page.source} {page.extra.visitor_id?`(${page.extra.visitor_id.slice(0,10)})`:''}</button>)}</div>
 </section>;
}
