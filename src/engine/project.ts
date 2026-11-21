import {inflateSync,strToU8,unzipSync,zipSync} from 'fflate';
import type {DocumentModel,Layer,LayerGroup} from './document';
import {DOCUMENT_WORKING_SET_BUDGET_BYTES,estimateWorkingSetBytes,isLayerBlendMode,isValidDocumentSize,MAX_DOCUMENT_LAYERS} from './document';
import {normalizeClippingLayers} from './layers';
import {normalizeTextData} from './text';

/**
 * Version 3 adds per-layer blend modes and version 4 adds editable text layers (SG-19). Each is
 * written only when a project uses that feature, so other projects stay readable by older builds.
 */
export const PROJECT_FORMAT_VERSION=4;
export type ProjectFile={version:1|2|3|4;width:number;height:number;layers:{id:string;name:string;visible:boolean;locked:boolean;opacity:number;alphaLocked?:boolean;clipped?:boolean;groupId?:string;blendMode?:string;text?:unknown;path:string}[];activeId:string;groups?:LayerGroup[]};
export const PROJECT_ARCHIVE_LIMIT_BYTES=512*1024*1024;
export const PROJECT_UNCOMPRESSED_LIMIT_BYTES=768*1024*1024;
export const PROJECT_MANIFEST_LIMIT_BYTES=4*1024*1024;
export const PROJECT_LOAD_MEMORY_BUDGET_BYTES=DOCUMENT_WORKING_SET_BUDGET_BYTES;
const PROJECT_MAX_LAYERS=MAX_DOCUMENT_LAYERS;

/** Estimates all raster surfaces plus compressed and inflated ZIP payloads held during load. */
export function estimateProjectLoadBytes(width:number,height:number,layerCount:number,archiveBytes=0,uncompressedBytes=0){
 if(!isValidDocumentSize(width,height)||!Number.isInteger(layerCount)||layerCount<1||layerCount>PROJECT_MAX_LAYERS||!Number.isSafeInteger(archiveBytes)||archiveBytes<0||!Number.isSafeInteger(uncompressedBytes)||uncompressedBytes<0)return null;
 return estimateWorkingSetBytes(width,height,layerCount)+archiveBytes+uncompressedBytes;
}
/**
 * Pre-encoding check against the shared working set (the layers already exist). Encoding then
 * holds every layer's PNG bytes plus the ZIP output, so after encoding the writer applies the
 * reader's full estimate to the real sizes and refuses a file that could not be reopened.
 */
export function estimateProjectEncodeBytes(width:number,height:number,layerCount:number){
 if(!isValidDocumentSize(width,height)||!Number.isInteger(layerCount)||layerCount<1||layerCount>PROJECT_MAX_LAYERS)return null;
 return estimateWorkingSetBytes(width,height,layerCount);
}
export function isProjectArchiveSizeSafe(size:number){return Number.isSafeInteger(size)&&size>=0&&size<=PROJECT_ARCHIVE_LIMIT_BYTES;}

const canvasBlob=(canvas:HTMLCanvasElement)=>new Promise<Blob>((resolve,reject)=>canvas.toBlob(blob=>blob?resolve(blob):reject(new Error('Could not encode layer image.')),'image/png'));
export const PROJECT_SAVE_RETRY_MESSAGE='Artwork changed while preparing the save. Save again to include the latest edits.';
export class StaleProjectRevisionError extends Error {
 constructor(){super(PROJECT_SAVE_RETRY_MESSAGE);}
}

/** Callers encoding live artwork supply a guard for its identity, revision and pending operations. */
export async function encodeProject(doc:DocumentModel,isCurrent:()=>boolean=()=>true){
 const requireCurrent=()=>{if(!isCurrent())throw new StaleProjectRevisionError();};
 requireCurrent();
 if(doc.layers.length<1||doc.layers.length>PROJECT_MAX_LAYERS||!isValidDocumentSize(doc.width,doc.height)||(doc.groups?.length??0)>PROJECT_MAX_LAYERS)throw new Error('Project dimensions, layer count, or group count exceed the supported limits.');
 const estimate=estimateProjectEncodeBytes(doc.width,doc.height,doc.layers.length);if(estimate===null||estimate>PROJECT_LOAD_MEMORY_BUDGET_BYTES)throw new Error(`Saving this project needs an estimated ${estimate===null?'unknown':`${Math.ceil(estimate/1024/1024)} MiB`}, above the 1024 MiB safety budget. No project file was created.`);
 if(doc.layers.some(layer=>(layer.canvas.width!==undefined&&layer.canvas.width!==doc.width)||(layer.canvas.height!==undefined&&layer.canvas.height!==doc.height)))throw new Error('Project layer dimensions do not match the document.');
 const canvases=doc.layers.map(layer=>layer.canvas);
 const manifest:ProjectFile={
  version:doc.layers.some(layer=>layer.text)?4:doc.layers.some(layer=>layer.blendMode&&layer.blendMode!=='normal')?3:2,width:doc.width,height:doc.height,activeId:doc.activeId,
  groups:(doc.groups??[]).map(group=>({...group})),
  layers:doc.layers.map((layer,i)=>({
   id:layer.id,name:layer.name,visible:layer.visible,locked:layer.locked,opacity:layer.opacity,
   alphaLocked:layer.alphaLocked===true,clipped:layer.clipped===true,
   ...(layer.groupId?{groupId:layer.groupId}:{}),...(layer.blendMode&&layer.blendMode!=='normal'?{blendMode:layer.blendMode}:{}),...(layer.text?{text:{...layer.text}}:{}),path:`layers/${i}.png`,
  })),
 };
 const entries:Record<string,Uint8Array>={};
 for(const [i,canvas] of canvases.entries()){
  const blob=await canvasBlob(canvas);
  requireCurrent();
  const buffer=await blob.arrayBuffer();
  requireCurrent();
  entries[manifest.layers[i].path]=new Uint8Array(buffer);
 }
 entries['manifest.json']=strToU8(JSON.stringify(manifest));
 const bytes=zipSync(entries,{level:1});
 if(bytes.byteLength>PROJECT_ARCHIVE_LIMIT_BYTES)throw new Error('Saved project archive exceeds the 512 MiB file limit. No project file was created.');
 // SG-17: refuse to produce a file this app could not reopen. Apply the reader's own estimate
 // to the actual archive and entry sizes.
 const entryBytes=Object.values(entries).reduce((sum,entry)=>sum+entry.byteLength,0);
 const reopen=estimateProjectLoadBytes(doc.width,doc.height,doc.layers.length,bytes.byteLength,entryBytes);
 if(reopen===null||reopen>PROJECT_LOAD_MEMORY_BUDGET_BYTES)throw new Error(`Reopening this project would need about ${reopen===null?'unknown':Math.ceil(reopen/1024/1024)} MiB, above the 1024 MiB safety budget. No project file was created; delete or merge layers, or use a smaller canvas.`);
 requireCurrent();
 return bytes;
}

type ZipDirectoryEntry={name:string;uncompressedSize:number;compressedSize:number;method:number;localOffset:number};
function inspectZipDirectory(bytes:Uint8Array):ZipDirectoryEntry[]{
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),minimum=Math.max(0,bytes.length-65_557);let end=-1;
 for(let offset=bytes.length-22;offset>=minimum;offset--)if(view.getUint32(offset,true)===0x06054b50){const commentLength=view.getUint16(offset+20,true);if(offset+22+commentLength===bytes.length){end=offset;break;}}
 if(end<0)throw new Error('Project archive is damaged or incomplete.');
 const disk=view.getUint16(end+4,true),directoryDisk=view.getUint16(end+6,true),diskEntries=view.getUint16(end+8,true),entryCount=view.getUint16(end+10,true),directorySize=view.getUint32(end+12,true),directoryOffset=view.getUint32(end+16,true);
 if(disk!==0||directoryDisk!==0||diskEntries!==entryCount||entryCount===0xffff||directorySize===0xffffffff||directoryOffset===0xffffffff)throw new Error('This project uses an unsupported multi-disk or ZIP64 archive.');
 if(entryCount>PROJECT_MAX_LAYERS+32)throw new Error('Project archive contains too many entries.');
 if(directoryOffset+directorySize>end)throw new Error('Project archive directory is damaged.');
 const decoder=new TextDecoder(),entries:ZipDirectoryEntry[]=[];let position=directoryOffset,totalUncompressed=0;
 for(let index=0;index<entryCount;index++){
  if(position+46>directoryOffset+directorySize||view.getUint32(position,true)!==0x02014b50)throw new Error('Project archive directory is damaged.');
  const flags=view.getUint16(position+8,true),method=view.getUint16(position+10,true),compressedSize=view.getUint32(position+20,true),uncompressedSize=view.getUint32(position+24,true),nameLength=view.getUint16(position+28,true),extraLength=view.getUint16(position+30,true),commentLength=view.getUint16(position+32,true),localOffset=view.getUint32(position+42,true);
  if((flags&1)!==0)throw new Error('Encrypted project archives are not supported.');
  if(compressedSize===0xffffffff||uncompressedSize===0xffffffff||localOffset===0xffffffff)throw new Error('ZIP64 projects are not supported by this browser build.');
  const next=position+46+nameLength+extraLength+commentLength;if(next>directoryOffset+directorySize)throw new Error('Project archive directory is damaged.');
  const name=decoder.decode(bytes.subarray(position+46,position+46+nameLength));
  if(method!==0&&method!==8)throw new Error('Project contains a layer image using an unsupported compression method.');
  totalUncompressed+=uncompressedSize;if(!Number.isSafeInteger(totalUncompressed)||totalUncompressed>PROJECT_UNCOMPRESSED_LIMIT_BYTES)throw new Error('Project archive expands beyond the 768 MiB safety limit. The current document was not changed.');
  if(entries.some(entry=>entry.name===name))throw new Error('Project archive contains duplicate file references.');
  entries.push({name,uncompressedSize,compressedSize,method,localOffset});position=next;
 }
 if(position!==directoryOffset+directorySize)throw new Error('Project archive directory is damaged.');
 return entries;
}

function readZipEntry(bytes:Uint8Array,entry:ZipDirectoryEntry){
 const view=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength),offset=entry.localOffset;
 if(offset+30>bytes.length||view.getUint32(offset,true)!==0x04034b50)throw new Error('Project archive layer directory is damaged.');
 const nameLength=view.getUint16(offset+26,true),extraLength=view.getUint16(offset+28,true),dataOffset=offset+30+nameLength+extraLength,end=dataOffset+entry.compressedSize;
 if(end>bytes.length)throw new Error('Project archive layer data is truncated.');
 const compressed=bytes.subarray(dataOffset,end),result=entry.method===0?compressed:inflateSync(compressed);
 if(result.byteLength!==entry.uncompressedSize)throw new Error('Project archive entry size does not match its directory.');
 return result;
}

function validateLayerRecord(item:unknown,index:number,files:Set<string>):asserts item is ProjectFile['layers'][number]{
 if(!item||typeof item!=='object')throw new Error(`Project layer ${index+1} metadata is invalid.`);
 const layer=item as Record<string,unknown>;
 if(typeof layer.name!=='string'||!layer.name.trim()||typeof layer.path!=='string'||!files.has(layer.path))throw new Error(`Project layer ${index+1} image reference is missing or invalid.`);
 for(const property of ['visible','locked','alphaLocked','clipped'])if(layer[property]!==undefined&&typeof layer[property]!=='boolean')throw new Error(`Project layer ${index+1} has invalid ${property} metadata.`);
 if(layer.opacity!==undefined&&(typeof layer.opacity!=='number'||!Number.isFinite(layer.opacity)))throw new Error(`Project layer ${index+1} has invalid opacity metadata.`);
 if(layer.id!==undefined&&(typeof layer.id!=='string'||!layer.id))throw new Error(`Project layer ${index+1} has invalid identity metadata.`);
 if(layer.groupId!==undefined&&layer.groupId!==null&&typeof layer.groupId!=='string')throw new Error(`Project layer ${index+1} has invalid group metadata.`);
}

export async function decodeProject(bytes:Uint8Array):Promise<DocumentModel>{
 if(!isProjectArchiveSizeSafe(bytes.byteLength))throw new Error('Project archive exceeds the 512 MiB safety limit. The current document was not changed.');
 const directory=inspectZipDirectory(bytes),filesByName=new Map(directory.map(entry=>[entry.name,entry])),manifestEntry=filesByName.get('manifest.json');
 if(!manifestEntry)throw new Error('Project manifest is missing.');
 if(manifestEntry.uncompressedSize>PROJECT_MANIFEST_LIMIT_BYTES)throw new Error('Project manifest exceeds the 4 MiB metadata limit. The current document was not changed.');
 let raw:Uint8Array;try{raw=readZipEntry(bytes,manifestEntry);}catch(error){console.error('Project manifest inflate failed',error);throw new Error('Project manifest could not be read; the current document was not changed.');}
 let m:ProjectFile;try{m=JSON.parse(new TextDecoder().decode(raw)) as ProjectFile;}catch(error){console.error('Project manifest parse failed',error);throw new Error('Project manifest is damaged or is not valid JSON. The current document was not changed.');}
 if(m&&typeof m==='object'&&typeof m.version==='number'&&Number.isInteger(m.version)&&m.version>PROJECT_FORMAT_VERSION)throw new Error('Project was saved by a newer version of SeaGlass Studio and cannot be opened here. The current document was not changed.');
 if(!m||typeof m!=='object'||(m.version!==1&&m.version!==2&&m.version!==3&&m.version!==4)||!isValidDocumentSize(m.width,m.height)||!Array.isArray(m.layers)||m.layers.length<1||m.layers.length>PROJECT_MAX_LAYERS)throw new Error('Project dimensions or layer list are invalid.');
 if(m.version>=2&&(!Array.isArray(m.groups)||m.groups.length>PROJECT_MAX_LAYERS))throw new Error('Project group data is invalid.');
 const estimated=estimateProjectLoadBytes(m.width,m.height,m.layers.length,bytes.byteLength,directory.reduce((sum,entry)=>sum+entry.uncompressedSize,0));
 if(estimated===null||estimated>PROJECT_LOAD_MEMORY_BUDGET_BYTES){const amount=estimated===null?'unknown':`${Math.ceil(estimated/1024/1024)} MiB`;throw new Error(`Project needs an estimated ${amount} during loading, above the 1024 MiB safety budget. The current document was not changed.`);}
 const groups:LayerGroup[]=m.version>=2?(m.groups??[]).map(group=>{if(!group||typeof group.id!=='string'||!group.id||typeof group.name!=='string'||!group.name.trim()||typeof group.visible!=='boolean'||typeof group.locked!=='boolean'||typeof group.opacity!=='number'||!Number.isFinite(group.opacity))throw new Error('Project contains an invalid layer group.');return{id:group.id,name:group.name,visible:group.visible,locked:group.locked,opacity:Math.max(0,Math.min(1,group.opacity))};}):[];
 if(new Set(groups.map(group=>group.id)).size!==groups.length||new Set(groups.map(group=>group.name.toLowerCase())).size!==groups.length)throw new Error('Project contains duplicate layer groups.');
 const groupIds=new Set(groups.map(group=>group.id)),entryNames=new Set(filesByName.keys()),layerIds=new Set<string>();
 for(let index=0;index<m.layers.length;index++){
  const item=m.layers[index];validateLayerRecord(item,index,entryNames);
  if(item.id&&layerIds.has(item.id))throw new Error('Project contains duplicate layer identities.');if(item.id)layerIds.add(item.id);
  if(item.groupId!==undefined&&item.groupId!==null&&!groupIds.has(item.groupId))throw new Error('Project layer references a missing group.');
 }
 const supportedEntries=new Set(['manifest.json',...m.layers.map(item=>item.path)]);if(directory.some(entry=>!supportedEntries.has(entry.name)))throw new Error('Project contains data this version cannot preserve. It was not opened.');
 let previousGroupId:string|undefined;const closedGroupIds=new Set<string>();
 for(const item of m.layers){const groupId=typeof item.groupId==='string'?item.groupId:undefined;if(groupId!==previousGroupId){if(previousGroupId)closedGroupIds.add(previousGroupId);if(groupId&&closedGroupIds.has(groupId))throw new Error('Project group members must be contiguous in the layer stack.');previousGroupId=groupId;}}
 let files:Record<string,Uint8Array>;try{files=unzipSync(bytes);}catch(error){console.error('Project ZIP decode failed',error);throw new Error('Project archive could not be read; it may be damaged. The current document was not changed.');}
 if(m.layers.some(item=>!files[item.path]))throw new Error('Project layer image data is missing. The current document was not changed.');
 const layers:Layer[]=[];
 try{
  for(const item of m.layers){
   if(item.blendMode!==undefined&&(m.version<3||!isLayerBlendMode(item.blendMode)))throw new Error(`Project layer “${item.name}” uses an unsupported blend mode. The current document was not changed.`);
   const text=item.text===undefined?undefined:m.version>=4?normalizeTextData(item.text,m.width,m.height):null;
   if(text===null)throw new Error(`Project layer “${item.name}” has invalid text data. The current document was not changed.`);
   const blob=new Blob([files[item.path]],{type:'image/png'}),bitmap=await createImageBitmap(blob);
   try{
    if(bitmap.width!==m.width||bitmap.height!==m.height)throw new Error(`Project layer “${item.name}” has image dimensions that do not match the manifest.`);
    const canvas=document.createElement('canvas');canvas.width=m.width;canvas.height=m.height;const context=canvas.getContext('2d');if(!context)throw new Error('Canvas memory is unavailable while loading this project.');context.drawImage(bitmap,0,0);
    const opacity=typeof item.opacity==='number'?Math.max(0,Math.min(1,item.opacity)):1;
    layers.push({id:typeof item.id==='string'&&item.id?item.id:crypto.randomUUID(),name:item.name,visible:item.visible===undefined?true:item.visible,locked:item.locked===undefined?false:item.locked,opacity,alphaLocked:item.alphaLocked===true,clipped:item.clipped===true,groupId:typeof item.groupId==='string'?item.groupId:undefined,blendMode:item.blendMode==='multiply'||item.blendMode==='screen'?item.blendMode:undefined,...(text?{text}:{}),canvas});
   }finally{bitmap.close();}
  }
 }catch(error){for(const layer of layers){layer.canvas.width=0;layer.canvas.height=0;}if(error instanceof Error&&error.message.startsWith('Project layer'))throw error;console.error('Project layer image decode failed',error);throw new Error('A project layer image could not be decoded. The current document was not changed.');}
 const doc:DocumentModel={width:m.width,height:m.height,layers,activeId:layers.some(layer=>layer.id===m.activeId)?m.activeId:layers[layers.length-1].id,groups};normalizeClippingLayers(doc);return doc;
}

// ---------------------------------------------------------------------------
// Local crash recovery
//
// Each live document owns its own records, so documents and browser tabs never overwrite
// one another's recoverable artwork:
//   doc:<documentId>  -> RecoveryRecord (archive bytes)
//   meta:<documentId> -> RecoveryMeta (small, for listing and ordering)
// A live document also holds a Web Lock lease named after its id. At startup a tab only
// offers a record whose lease it can claim immediately, so another tab's live work is
// never offered and two tabs cannot restore the same session. The single 'latest' value
// written by earlier versions is migrated in place.
// ---------------------------------------------------------------------------

type RecoveryVersion={documentId:string;revision:number};
export type RecoveryMeta=RecoveryVersion&{savedAt:number};
export type RecoveryRecord=RecoveryMeta&{bytes:Uint8Array};
type Lease={release:()=>void};
type RecoverySession={
 documentId:string;
 clearedThrough:number;
 requestedRevision:number;
 writeRequest:number;
 pendingClears:Set<{revision:number}>;
 inherited?:RecoveryVersion&{lease:Lease|null;retired:boolean};
 lease:Lease|null;
 retired:boolean;
};
const DB='seaglass-studio-recovery',STORE='session',LEGACY_LATEST='latest';
const LEASE_PREFIX='seaglass-recovery:';
/** Upper bound on stored sessions; the oldest records of other documents are evicted first. */
export const MAX_RECOVERY_RECORDS=8;
const recordKey=(id:string)=>`doc:${id}`,metaKey=(id:string)=>`meta:${id}`;
const recoverySessions=new WeakMap<DocumentModel,RecoverySession>();
const pendingClaims=new Map<string,Lease>();

type LockManagerLike={request:(name:string,options:{ifAvailable?:boolean},callback:(lock:unknown)=>Promise<void>|void)=>Promise<unknown>};
const lockManager=()=>(globalThis.navigator as {locks?:LockManagerLike}|undefined)?.locks;

/** Hold a Web Lock until released. Without Web Locks, coordination falls back to a single tab. */
function acquireLease(id:string,wait:boolean):Promise<Lease|null>{
 const locks=lockManager();
 if(!locks)return Promise.resolve({release(){}});
 return new Promise(resolve=>{
  let release:()=>void=()=>{};
  const held=new Promise<void>(done=>{release=done;});
  locks.request(LEASE_PREFIX+id,{ifAvailable:!wait},lock=>{
   if(!lock){resolve(null);return;}
   resolve({release});
   return held;
  }).catch(()=>resolve(null));
 });
}

function recoverySession(doc:DocumentModel){
 let session=recoverySessions.get(doc);
 if(!session){
  const created:RecoverySession={documentId:crypto.randomUUID(),clearedThrough:-1,requestedRevision:-1,writeRequest:0,pendingClears:new Set(),lease:null,retired:false};
  session=created;
  recoverySessions.set(doc,created);
  void acquireLease(created.documentId,true).then(lease=>{if(created.retired)lease?.release();else created.lease=lease;});
 }
 return session;
}

/** A restored document supersedes the exact record it came from while keeping its own identity. */
export function setRecoveryOrigin(doc:DocumentModel,{documentId,revision}:RecoveryVersion){
 const lease=pendingClaims.get(documentId)??null;
 pendingClaims.delete(documentId);
 recoverySession(doc).inherited={documentId,revision,lease,retired:false};
}

/** Return a claimed record to other tabs and later launches when the user declines it. */
export function releaseRecoveryClaim({documentId}:RecoveryVersion){
 pendingClaims.get(documentId)?.release();
 pendingClaims.delete(documentId);
}

function openDb(){return new Promise<IDBDatabase>((resolve,reject)=>{const req=indexedDB.open(DB,1);req.onupgradeneeded=()=>req.result.createObjectStore(STORE);req.onsuccess=()=>resolve(req.result);req.onerror=()=>reject(req.error);});}
const isVersion=(entry:Partial<RecoveryVersion>)=>typeof entry.documentId==='string'&&entry.documentId.length>0&&
 typeof entry.revision==='number'&&Number.isSafeInteger(entry.revision)&&entry.revision>=0;
function isRecoveryMeta(value:unknown):value is RecoveryMeta{
 return !!value&&typeof value==='object'&&isVersion(value as Partial<RecoveryMeta>)&&typeof (value as RecoveryMeta).savedAt==='number';
}
function isRecoveryRecord(value:unknown):value is RecoveryRecord{
 return isRecoveryMeta(value)&&(value as RecoveryRecord).bytes instanceof Uint8Array;
}
const metaRange=()=>IDBKeyRange.bound('meta:','meta:￿');

type Guard=<A extends unknown[]>(handler:(...args:A)=>void)=>(...args:A)=>void;
/** Run requests in one transaction. Handlers wrapped in `guard` abort it on an exception. */
async function inStore<T>(mode:IDBTransactionMode,body:(store:IDBObjectStore,set:(value:T)=>void,guard:Guard)=>void,initial:T):Promise<T>{
 const db=await openDb();
 try{
  return await new Promise<T>((resolve,reject)=>{
   const tx=db.transaction(STORE,mode),store=tx.objectStore(STORE);
   let result=initial,failure:unknown;
   const fail=(error:unknown)=>{failure??=error;try{tx.abort();}catch{/* already finished */}};
   const guard:Guard=handler=>(...args)=>{try{handler(...args);}catch(error){fail(error);}};
   tx.oncomplete=()=>resolve(result);
   tx.onerror=()=>reject(failure??tx.error);
   tx.onabort=()=>reject(failure??tx.error??new Error('Recovery storage transaction was aborted.'));
   guard(()=>body(store,value=>{result=value;},guard))();
  });
 }finally{db.close();}
}

function deleteRecord(store:IDBObjectStore,id:string){store.delete(recordKey(id));store.delete(metaKey(id));}

export async function saveRecovery(doc:DocumentModel,revision:number,isCurrent:()=>boolean=()=>true){
 const session=recoverySession(doc);
 if(revision<session.requestedRevision)return false;
 session.requestedRevision=revision;
 const writeRequest=++session.writeRequest;
 const isLatest=()=>!session.retired&&writeRequest===session.writeRequest&&revision>session.clearedThrough&&
  !Array.from(session.pendingClears).some(clear=>revision<=clear.revision)&&isCurrent();
 let bytes:Uint8Array;
 try{bytes=await encodeProject(doc,isLatest);}catch(error){if(error instanceof StaleProjectRevisionError)return false;throw error;}
 if(!isLatest())return false;
 const id=session.documentId,inherited=session.inherited;
 const candidates=(await listRecoveryRecords()).map(entry=>entry.documentId).filter(other=>other!==id&&other!==inherited?.documentId);
 const live=candidates.length+1>MAX_RECOVERY_RECORDS?await liveDocumentIds(candidates):new Set<string>();
 if(!isLatest())return false;
 let supersededOrigin=false;
 const saved=await inStore<boolean>('readwrite',(store,set,guard)=>{
  const own=store.get(metaKey(id));
  own.onsuccess=guard(()=>{
   if(!isLatest()||(isRecoveryMeta(own.result)&&own.result.revision>revision))return;
   const meta:RecoveryMeta={documentId:id,revision,savedAt:Date.now()};
   const record:RecoveryRecord={...meta,bytes};
   store.put(record,recordKey(id));
   store.put(meta,metaKey(id));
   set(true);
   if(inherited&&!inherited.retired){
    const origin=store.get(metaKey(inherited.documentId));
    origin.onsuccess=guard(()=>{
     if(isRecoveryMeta(origin.result)&&origin.result.revision===inherited.revision){deleteRecord(store,inherited.documentId);supersededOrigin=true;}
    });
   }
   const metas=store.getAll(metaRange());
   metas.onsuccess=guard(()=>{
    const others=(metas.result as unknown[]).filter(isRecoveryMeta)
     .filter(entry=>entry.documentId!==id&&entry.documentId!==inherited?.documentId&&!live.has(entry.documentId))
     .sort((a,b)=>a.savedAt-b.savedAt);
    const excess=others.length+1-MAX_RECOVERY_RECORDS;
    for(const entry of others.slice(0,Math.max(0,excess)))deleteRecord(store,entry.documentId);
   });
  });
 },false);
 if(supersededOrigin&&inherited){inherited.retired=true;inherited.lease?.release();}
 return saved;
}

/** Move a single-slot record written by an earlier version into the per-document layout. */
function migrateLegacy(store:IDBObjectStore,guard:Guard){
 const legacy=store.get(LEGACY_LATEST);
 legacy.onsuccess=guard(()=>{
  const value=legacy.result as unknown;
  let record:RecoveryRecord|null=null;
  if(value instanceof Uint8Array)record={documentId:crypto.randomUUID(),revision:0,savedAt:0,bytes:value};
  else if(value&&typeof value==='object'&&isVersion(value as Partial<RecoveryRecord>)&&(value as RecoveryRecord).bytes instanceof Uint8Array){
   const old=value as RecoveryRecord;
   record={documentId:old.documentId,revision:old.revision,savedAt:typeof old.savedAt==='number'?old.savedAt:0,bytes:old.bytes};
  }
  // An unreadable value is left untouched rather than deleted.
  if(!record)return;
  const migrated=record;
  const existing=store.get(metaKey(migrated.documentId));
  existing.onsuccess=guard(()=>{
   if(!(isRecoveryMeta(existing.result)&&existing.result.revision>=migrated.revision)){
    const meta:RecoveryMeta={documentId:migrated.documentId,revision:migrated.revision,savedAt:migrated.savedAt};
    store.put(migrated,recordKey(migrated.documentId));
    store.put(meta,metaKey(migrated.documentId));
   }
   store.delete(LEGACY_LATEST);
  });
 });
}

/** Every stored recovery entry, newest first (metadata only). */
export async function listRecoveryRecords(){
 await inStore<void>('readwrite',(store,_set,guard)=>migrateLegacy(store,guard),undefined);
 const metas=await inStore<RecoveryMeta[]>('readonly',(store,set,guard)=>{
  const request=store.getAll(metaRange());
  request.onsuccess=guard(()=>set((request.result as unknown[]).filter(isRecoveryMeta)));
 },[]);
 return metas.sort((a,b)=>b.savedAt-a.savedAt||b.revision-a.revision);
}

/**
 * Claim the newest record that no open document (in this or another tab) owns.
 * Call setRecoveryOrigin when restoring it, or releaseRecoveryClaim when declining it.
 */
export async function loadRecovery({busyRetryMs=1500}:{busyRetryMs?:number}={}):Promise<RecoveryRecord|undefined>{
 // A page that is reloading can still hold its lease for a moment, while a live tab holds it
 // indefinitely. Records are considered strictly newest first: a busy record is retried until
 // the deadline before an older record may be offered in its place.
 const deadline=Date.now()+busyRetryMs;
 for(const meta of await listRecoveryRecords()){
  if(pendingClaims.has(meta.documentId))continue;
  let lease=await acquireLease(meta.documentId,false);
  while(!lease&&Date.now()<deadline){
   await new Promise(resolve=>setTimeout(resolve,200));
   lease=await acquireLease(meta.documentId,false);
  }
  if(!lease)continue;
  let record:unknown;
  try{
   record=await inStore<unknown>('readonly',(store,set,guard)=>{
    const request=store.get(recordKey(meta.documentId));
    request.onsuccess=guard(()=>set(request.result));
   },undefined);
  }catch(error){lease.release();throw error;}
  if(!isRecoveryRecord(record)){lease.release();continue;}
  pendingClaims.set(meta.documentId,lease);
  return record;
 }
 return undefined;
}

/** Ids whose lease another open document holds right now (probed without waiting). */
async function liveDocumentIds(ids:string[]){
 const live=new Set<string>();
 if(!lockManager())return live;
 for(const id of ids){
  if(pendingClaims.has(id)){live.add(id);continue;}
  const lease=await acquireLease(id,false);
  if(lease)lease.release();else live.add(id);
 }
 return live;
}

export async function clearRecovery(doc:DocumentModel,revision:number,isCurrent:()=>boolean=()=>true){
 const session=recoverySession(doc),reservation={revision},inherited=session.inherited;
 // The reservation also blocks writes that started before this transaction could open.
 session.pendingClears.add(reservation);
 let clearedOrigin=false;
 try{
  const cleared=await inStore<boolean>('readwrite',(store,set,guard)=>{
   if(!isCurrent())return;
   set(true);
   const own=store.get(metaKey(session.documentId));
   own.onsuccess=guard(()=>{if(isRecoveryMeta(own.result)&&own.result.revision<=revision)deleteRecord(store,session.documentId);});
   if(inherited&&!inherited.retired){
    const origin=store.get(metaKey(inherited.documentId));
    origin.onsuccess=guard(()=>{
     if(isRecoveryMeta(origin.result)&&origin.result.revision===inherited.revision){deleteRecord(store,inherited.documentId);clearedOrigin=true;}
    });
   }
  },false);
  if(cleared)session.clearedThrough=Math.max(session.clearedThrough,revision);
  if(clearedOrigin&&inherited){inherited.retired=true;inherited.lease?.release();}
  return cleared;
 }finally{session.pendingClears.delete(reservation);}
}

/** Retire every record a replaced document owns, refuse its later writes and release its leases. */
export async function retireRecovery(doc:DocumentModel){
 const session=recoverySession(doc);
 try{return await clearRecovery(doc,Number.MAX_SAFE_INTEGER);}
 finally{
  session.retired=true;
  session.lease?.release();
  session.lease=null;
  if(session.inherited){session.inherited.lease?.release();session.inherited.lease=null;}
 }
}
