"use client";
import { featureFields,type Condition,type Field as FeatureField } from '../../lib/communications/dsl';
import { Field,styles } from './shared';
const leaf:Condition={field:'order_count',op:'gte',value:1};
export default function ConditionEditor({value,onChange,depth=0}:{value:Condition;onChange:(v:Condition)=>void;depth?:number}){
 const group='all' in value?'all':'any' in value?'any':'none' in value?'none':null;
 if(group){const children=(value as Record<string,Condition[]>)[group];return <div className={styles.condition}>
  <div className={styles.toolbar}><label>Match <select aria-label="Condition group" value={group} onChange={e=>onChange({[e.target.value]:children} as Condition)}><option value="all">All conditions</option><option value="any">Any condition</option><option value="none">None of these</option></select></label>
  <button type="button" onClick={()=>onChange({[group]:[...children,{...leaf}]} as Condition)}>Add condition</button>{depth<4&&<button type="button" onClick={()=>onChange({[group]:[...children,{all:[]}]} as Condition)}>Add group</button>}</div>
  {children.map((child,index)=><div key={index}><ConditionEditor depth={depth+1} value={child} onChange={updated=>onChange({[group]:children.map((v,i)=>i===index?updated:v)} as Condition)}/><button type="button" onClick={()=>onChange({[group]:children.filter((_,i)=>i!==index)} as Condition)}>Remove condition {index+1}</button></div>)}
 </div>;}
 const v=value as Extract<Condition,{field:FeatureField}>;const type=featureFields[v.field];
 const ops=type==='array'?['contains','exists']:type==='boolean'?['eq','neq','exists']:type==='date'?['before','after','days_since_gte','days_since_lte','exists']:['eq','neq','in','not_in','exists',...(type==='number'?['gt','gte','lt','lte']:[])];
 return <div className={`${styles.grid} ${styles.condition}`}>
  <Field label="Feature"><select value={v.field} onChange={e=>{const field=e.target.value as FeatureField;const t=featureFields[field];onChange({field,op:t==='array'?'contains':'eq',value:t==='boolean'?false:t==='number'?0:t==='date'?new Date().toISOString():''});}}>{Object.keys(featureFields).map(f=><option key={f}>{f}</option>)}</select></Field>
  <Field label="Operator"><select value={v.op} onChange={e=>onChange({...v,op:e.target.value,value:e.target.value.startsWith('days_since')?30:e.target.value==='exists'?true:['in','not_in'].includes(e.target.value)?[]:type==='boolean'?false:type==='number'?0:''})}>{ops.map(o=><option key={o}>{o}</option>)}</select></Field>
  <Field label="Value">{type==='boolean'||v.op==='exists'?<select value={String(v.value??true)} onChange={e=>onChange({...v,value:e.target.value==='true'})}><option value="true">True</option><option value="false">False</option></select>:<input value={Array.isArray(v.value)?v.value.join(', '):String(v.value??'')} type={type==='number'||v.op.startsWith('days_since')?'number':'text'} placeholder={['in','not_in'].includes(v.op)?'Comma-separated values':type==='date'?'ISO date/time':''} onChange={e=>onChange({...v,value:['in','not_in'].includes(v.op)?e.target.value.split(',').map(s=>type==='number'?Number(s.trim()):s.trim()):type==='number'||v.op.startsWith('days_since')?Number(e.target.value):e.target.value})}/>}</Field>
 </div>;
}
