"use client";
import type { ReactNode } from 'react';
import styles from './operations.module.css';
export { styles };
export function Field({label,children}:{label:string;children:ReactNode}){return <label className={styles.field}><span>{label}</span>{children}</label>;}
export function Badge({value}:{value:string}){const tone=/ACTIVE|APPROVED|DELIVERED|HEALTHY|COMPLETED|READY/.test(value)?styles.success:/FAILED|DOWN|REJECTED|DISABLED/.test(value)?styles.error:styles.warning;return <span className={`${styles.badge} ${tone}`}>{value.replace(/_/g,' ')}</span>;}
export function Table({columns,rows}:{columns:string[];rows:ReactNode[][]}){return <div className={styles.tableWrap}><table><thead><tr>{columns.map(c=><th key={c} scope="col">{c}</th>)}</tr></thead><tbody>{rows.length?rows.map((r,i)=><tr key={i}>{r.map((c,j)=><td key={j}>{c}</td>)}</tr>):<tr><td colSpan={columns.length}>No records yet.</td></tr>}</tbody></table></div>;}
export async function api(path:string,body?:unknown){const response=await fetch(path,{...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{}),cache:'no-store'});const result=await response.json();if(!response.ok)throw new Error(result.error||'Request failed');return result;}
export function date(value:unknown){return value?new Date(String(value)).toLocaleString('en-IN',{timeZone:'Asia/Kolkata'}):'—';}
