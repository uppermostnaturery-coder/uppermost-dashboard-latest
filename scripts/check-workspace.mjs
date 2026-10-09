// Read-only fallback when Git is unavailable; never changes the index or working tree.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { inflateSync } from 'node:zlib';
import { createHash } from 'node:crypto';
const index=readFileSync('.git/index');const version=index.readUInt32BE(4);
if(![2,3].includes(version))throw new Error(`Unsupported Git index version ${version}; use git diff --check.`);
let position=12;const entries=new Map();
for(let i=0;i<index.readUInt32BE(8);i++){
 const start=position,sha=index.subarray(position+40,position+60).toString('hex'),flags=index.readUInt16BE(position+60);
 position+=62;if(flags&0x4000)position+=2;
 const end=index.indexOf(0,position),path=index.subarray(position,end).toString('utf8');
 position=start+Math.ceil((end+1-start)/8)*8;entries.set(path,sha);
}
const packs=[];const packDirectory='.git/objects/pack';
if(existsSync(packDirectory))for(const name of readdirSync(packDirectory).filter(n=>n.endsWith('.idx'))){
 const idx=readFileSync(join(packDirectory,name));if(idx.readUInt32BE(0)!==0xff744f63||idx.readUInt32BE(4)!==2)continue;
 const count=idx.readUInt32BE(8+255*4),offsets=8+1024+count*24,map=new Map();
 for(let i=0;i<count;i++){let offset=idx.readUInt32BE(offsets+i*4);if(offset&0x80000000)offset=Number(idx.readBigUInt64BE(offsets+count*4+(offset&0x7fffffff)*8));map.set(idx.subarray(1032+i*20,1052+i*20).toString('hex'),offset);}
 packs.push({data:readFileSync(join(packDirectory,name.replace(/\.idx$/,'.pack'))),map,cache:new Map()});
}
const applyDelta=(base,delta)=>{let p=0;const integer=()=>{let n=0,shift=0,b;do{b=delta[p++];n+=(b&127)*2**shift;shift+=7;}while(b&128);return n;};integer();const size=integer(),parts=[];
 while(p<delta.length){const command=delta[p++];if(command&128){let offset=0,length=0;for(let b=0;b<4;b++)if(command&(1<<b))offset+=delta[p++]*2**(8*b);for(let b=0;b<3;b++)if(command&(16<<b))length+=delta[p++]*2**(8*b);parts.push(base.subarray(offset,offset+(length||65536)));}else if(command){parts.push(delta.subarray(p,p+command));p+=command;}else throw new Error('Invalid Git delta');}
 const result=Buffer.concat(parts);if(result.length!==size)throw new Error('Git delta size mismatch');return result;};
const objectAt=(pack,start)=>{if(pack.cache.has(start))return pack.cache.get(start);let p=start,b=pack.data[p++],type=(b>>4)&7;while(b&128)b=pack.data[p++];let base;
 if(type===6){b=pack.data[p++];let offset=b&127;while(b&128){b=pack.data[p++];offset=(offset+1)*128+(b&127);}base=objectAt(pack,start-offset);}
 if(type===7){base=objectBySha(pack.data.subarray(p,p+20).toString('hex'));p+=20;}
 let value=inflateSync(pack.data.subarray(p));if(base)value=applyDelta(base,value);else if(type!==3)throw new Error('Requested non-blob object');pack.cache.set(start,value);return value;};
const objectBySha=sha=>{const loose=join('.git','objects',sha.slice(0,2),sha.slice(2));let value;
 if(existsSync(loose)){const data=inflateSync(readFileSync(loose));value=data.subarray(data.indexOf(0)+1);}else{const pack=packs.find(p=>p.map.has(sha));if(!pack)return null;value=objectAt(pack,pack.map.get(sha));}
 if(createHash('sha1').update(`blob ${value.length}\0`).update(value).digest('hex')!==sha)throw new Error('Git baseline integrity mismatch');return value;};
const baseline=path=>{const sha=entries.get(path);return sha?objectBySha(sha)?.toString('utf8')??null:null;};
const path='components/Dashboard.tsx',before=baseline(path),after=readFileSync(path,'utf8');
console.log(JSON.stringify({dashboardBaselineAvailable:before!==null,baselineMojibake:before?.split('\u00e2').length-1,currentMojibake:after.split('\u00e2').length-1,baselineArrows:before?.split('\u2192').length-1,currentArrows:after.split('\u2192').length-1}));
const walk=(directory)=>readdirSync(directory).flatMap(name=>{const p=join(directory,name);if(['.git','node_modules','.next','.agents','.codex'].includes(name))return [];return statSync(p).isDirectory()?walk(p):[p.replaceAll('\\','/')];});
const changed=[];let whitespace=0;
for(const file of walk('.').map(p=>p.replace(/^\.\//,''))){
 if(!/\.(ts|tsx|js|mjs|css|sql|md|json)$/.test(file)||file==='package-lock.json'||file==='tsconfig.tsbuildinfo')continue;
 const source=readFileSync(file,'utf8'),old=baseline(file);
 if(old===source)continue;
 if(entries.has(file)&&old===null)continue;
 changed.push(file);
 const oldMojibake=old?.split('\u00e2').length-1,newMojibake=source.split('\u00e2').length-1;
 if(old!==null&&newMojibake>oldMojibake)console.log(`Encoding review ${file}: baseline=${oldMojibake}, current=${newMojibake}`);
 // Only new/changed lines: pre-existing whitespace is outside this task.
 const prior=new Set(old?.split(/\r?\n/)||[]);
 source.split(/\r?\n/).forEach((line,i)=>{if(/[\t ]+$/.test(line)&&!prior.has(line)){console.log(`Trailing whitespace ${file}:${i+1}`);whitespace++;}});
}
console.log(JSON.stringify({changedFiles:process.env.CHECK_VERBOSE==='true'?changed:changed.length,whitespaceFindings:whitespace},null,2));
if(whitespace)process.exitCode=1;
